#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_UPDATER_FEED_URL =
  "https://github.com/crynta/terax-ai/releases/latest/download/latest.json";

function normalizeKeyId(keyId) {
  return keyId.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function base64Decode(value, label) {
  try {
    return Buffer.from(value, "base64");
  } catch (error) {
    throw new Error(`${label} is not valid base64: ${error.message}`);
  }
}

export function signatureKeyIdFromTauriSignature(signature) {
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("signature is missing");
  }

  const signatureText = base64Decode(signature, "feed signature").toString("utf8");
  const lines = signatureText.split(/\r?\n/).filter(Boolean);
  const untrustedCommentIndex = lines.findIndex((line) => line.startsWith("untrusted comment:"));
  const signatureLine = lines[untrustedCommentIndex + 1];
  if (!signatureLine) {
    throw new Error("feed signature does not contain a minisign signature line");
  }

  const rawSignature = base64Decode(signatureLine, "minisign signature line");
  if (rawSignature.length < 10) {
    throw new Error("minisign signature line is too short to contain a key id");
  }

  const algorithm = rawSignature.subarray(0, 2).toString("ascii");
  const keyId = [...rawSignature.subarray(2, 10)]
    .reverse()
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return { algorithm, keyId };
}

export function inspectUpdaterFeed(feed, options = {}) {
  const expectedKeyId = options.expectedKeyId ? normalizeKeyId(options.expectedKeyId) : null;
  const platforms = feed?.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    return { ok: false, entries: [], uniqueKeyIds: [], errors: ["feed is missing a platforms object"] };
  }

  const entries = [];
  const errors = [];
  for (const [platform, payload] of Object.entries(platforms)) {
    try {
      const parsed = signatureKeyIdFromTauriSignature(payload?.signature);
      const entry = { platform, url: payload?.url ?? "", ...parsed };
      entries.push(entry);
      if (expectedKeyId && entry.keyId !== expectedKeyId) {
        errors.push(`${platform} is signed by ${entry.keyId}, expected ${expectedKeyId}`);
      }
    } catch (error) {
      errors.push(`${platform}: ${error.message}`);
    }
  }

  const uniqueKeyIds = [...new Set(entries.map((entry) => entry.keyId))].sort();
  return { ok: errors.length === 0, entries, uniqueKeyIds, errors };
}

export function inspectUpdaterFeedText(text, options = {}) {
  let feed;
  try {
    feed = JSON.parse(text);
  } catch (error) {
    return { ok: false, entries: [], uniqueKeyIds: [], errors: [`feed JSON could not be parsed: ${error.message}`] };
  }
  return inspectUpdaterFeed(feed, options);
}

async function readFeedSource(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`${source} returned HTTP ${response.status}`);
    }
    return response.text();
  }
  return readFile(resolve(source), "utf8");
}

function parseArgs(argv) {
  const args = [...argv];
  let source = DEFAULT_UPDATER_FEED_URL;
  let expectedKeyId = null;
  let json = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--") {
      continue;
    } else if (arg === "--expect-key") {
      expectedKeyId = args.shift();
      if (!expectedKeyId) throw new Error("--expect-key requires a key id");
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (!arg?.startsWith("--")) {
      source = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return { source, expectedKeyId, json, help: false };
}

function printHelp() {
  console.log(`Usage: node scripts/inspect-updater-feed.mjs [latest.json|url] [--expect-key KEY] [--json]

Decodes Tauri updater feed signatures and prints the minisign key id per platform.
Defaults to ${DEFAULT_UPDATER_FEED_URL}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      process.exit(0);
    }

    const text = await readFeedSource(args.source);
    const result = inspectUpdaterFeedText(text, { expectedKeyId: args.expectedKeyId });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Updater feed: ${args.source}`);
      for (const entry of result.entries) {
        console.log(`${entry.platform}\t${entry.keyId}\t${entry.algorithm}\t${entry.url}`);
      }
      console.log(`Unique key ids: ${result.uniqueKeyIds.join(", ") || "none"}`);
      if (result.errors.length > 0) {
        console.error("Updater feed inspection failed:");
        for (const error of result.errors) console.error(`- ${error}`);
      }
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`Updater feed inspection failed: ${error.message}`);
    process.exit(1);
  }
}
