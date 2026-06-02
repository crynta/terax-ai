import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createSession,
  listSessions,
  resetSessionsForTests,
  SessionProtocolError,
  sendToSession,
  stopSession,
} from "./sessions.js";

export const HOST_VERSION = "0.1.0";

export const PI_PACKAGE_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];

const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  internalError: -32603,
};

let packageProbePromise;

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function successResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function packagePathParts(packageName) {
  return packageName.split("/").filter(Boolean);
}

async function readManifest(packageName, packageRoot) {
  try {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    if (manifest.name === packageName) {
      return manifest;
    }
  } catch {
    return null;
  }
  return null;
}

function packageRootCandidates(packageName) {
  const hostDir = dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const cwdParent = dirname(cwd);
  const parts = packagePathParts(packageName);
  const nodeModuleRoots = [
    process.env.TERAX_PI_NODE_MODULES,
    join(hostDir, "node_modules"),
    join(cwd, "sidecars/pi-host/node_modules"),
    join(cwd, "node_modules"),
    join(cwdParent, "sidecars/pi-host/node_modules"),
    join(cwdParent, "node_modules"),
  ];

  return Array.from(
    new Set(
      nodeModuleRoots
        .filter((root) => typeof root === "string" && root.length > 0)
        .map((root) => join(root, ...parts)),
    ),
  );
}

async function findPackageInfo(packageName) {
  for (const root of packageRootCandidates(packageName)) {
    const manifest = await readManifest(packageName, root);
    if (manifest !== null) {
      return {
        root,
        manifest,
        version: typeof manifest.version === "string" ? manifest.version : null,
      };
    }
  }

  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(packageName)));
    for (let depth = 0; depth < 6; depth += 1) {
      const manifest = await readManifest(packageName, dir);
      if (manifest !== null) {
        return {
          root: dir,
          manifest,
          version:
            typeof manifest.version === "string" ? manifest.version : null,
        };
      }

      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  } catch {
    // The package may still be importable via an explicit file URL fallback.
  }

  return null;
}

function exportTarget(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(exportTarget).find((target) => target !== null) ?? null;
  }
  if (value !== null && typeof value === "object") {
    for (const key of ["import", "default", "module", "main"]) {
      const target = exportTarget(value[key]);
      if (target !== null) {
        return target;
      }
    }
  }
  return null;
}

function manifestEntry(manifest) {
  const rootExport =
    manifest.exports?.["."] === undefined
      ? manifest.exports
      : manifest.exports["."];
  return (
    exportTarget(rootExport) ??
    (typeof manifest.module === "string" ? manifest.module : null) ??
    (typeof manifest.main === "string" ? manifest.main : null) ??
    "index.js"
  );
}

async function importPackage(packageName, packageInfo) {
  try {
    return await import(packageName);
  } catch (bareImportError) {
    if (packageInfo === null) {
      throw bareImportError;
    }

    try {
      return await import(
        pathToFileURL(
          join(packageInfo.root, manifestEntry(packageInfo.manifest)),
        ).href
      );
    } catch (fileImportError) {
      const bareMessage =
        bareImportError instanceof Error
          ? bareImportError.message
          : String(bareImportError);
      const fileMessage =
        fileImportError instanceof Error
          ? fileImportError.message
          : String(fileImportError);
      throw new Error(
        `bare import failed: ${bareMessage}; file import failed: ${fileMessage}`,
      );
    }
  }
}

async function probePackage(packageName) {
  const packageInfo = await findPackageInfo(packageName);

  try {
    const mod = await importPackage(packageName, packageInfo);

    return {
      name: packageName,
      version: packageInfo?.version ?? null,
      loaded: true,
      exportCount: Object.keys(mod).length,
      error: null,
    };
  } catch (error) {
    return {
      name: packageName,
      version: packageInfo?.version ?? null,
      loaded: false,
      exportCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probePackages() {
  packageProbePromise ??= Promise.all(PI_PACKAGE_NAMES.map(probePackage));
  return packageProbePromise;
}

async function info() {
  const piPackages = await probePackages();

  return {
    hostVersion: HOST_VERSION,
    piSdkLoaded: piPackages.every((pkg) => pkg.loaded),
    piPackages,
  };
}

async function status() {
  return {
    phase: "ready",
    detail: "Pi host stub",
    ...(await info()),
  };
}

function sessionResponse(id, handler, params) {
  try {
    return successResponse(id, handler(params));
  } catch (error) {
    if (error instanceof SessionProtocolError) {
      return errorResponse(id, error.code, error.message);
    }
    return errorResponse(
      id,
      ERROR_CODES.internalError,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function resetProtocolForTests() {
  packageProbePromise = undefined;
  resetSessionsForTests();
}

function isRequest(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.jsonrpc === "2.0" &&
    Number.isInteger(value.id) &&
    typeof value.method === "string"
  );
}

export async function handleJsonRpcLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return {
      response: errorResponse(null, ERROR_CODES.parseError, "Parse error"),
      shutdown: false,
    };
  }

  if (!isRequest(request)) {
    return {
      response: errorResponse(
        request?.id ?? null,
        ERROR_CODES.invalidRequest,
        "Invalid request",
      ),
      shutdown: false,
    };
  }

  switch (request.method) {
    case "ping":
      return {
        response: successResponse(request.id, { pong: true }),
        shutdown: false,
      };
    case "status":
      return {
        response: successResponse(request.id, await status()),
        shutdown: false,
      };
    case "info":
      return {
        response: successResponse(request.id, await info()),
        shutdown: false,
      };
    case "sessions.list":
      return {
        response: successResponse(request.id, listSessions()),
        shutdown: false,
      };
    case "sessions.create":
      return {
        response: sessionResponse(request.id, createSession, request.params),
        shutdown: false,
      };
    case "sessions.send":
      return {
        response: sessionResponse(request.id, sendToSession, request.params),
        shutdown: false,
      };
    case "sessions.stop":
      return {
        response: sessionResponse(request.id, stopSession, request.params),
        shutdown: false,
      };
    case "shutdown":
      return {
        response: successResponse(request.id, { ok: true }),
        shutdown: true,
      };
    default:
      return {
        response: errorResponse(
          request.id,
          ERROR_CODES.methodNotFound,
          "Method not found",
        ),
        shutdown: false,
      };
  }
}
