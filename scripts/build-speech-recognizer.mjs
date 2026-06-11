import { execSync } from "child_process";
import { existsSync, mkdirSync, cpSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const swiftDir = join(root, "src-tauri", "sidecars", "speech-recognizer");
const outDir = join(root, "src-tauri", "resources", "sidecars", "speech-recognizer");

if (process.platform !== "darwin") {
  console.log("[speech-recognizer] Skipping: not macOS");
  process.exit(0);
}

if (!existsSync(join(swiftDir, "Package.swift"))) {
  console.log("[speech-recognizer] Skipping: Package.swift not found");
  process.exit(0);
}

try {
  console.log("[speech-recognizer] Building Swift package...");
  execSync("swift build -c release --arch arm64", {
    cwd: swiftDir,
    stdio: "inherit",
  });
} catch {
  console.log("[speech-recognizer] Skipping: Swift build failed (non-fatal)");
}

mkdirSync(outDir, { recursive: true });

const binary = join(swiftDir, ".build", "apple", "arm64-apple-macosx", "release", "SpeechRecognizer");
const fallback = join(swiftDir, ".build", "release", "SpeechRecognizer");
const source = [binary, fallback].find(existsSync);

if (source) {
  cpSync(source, join(outDir, "SpeechRecognizer"));
  console.log("[speech-recognizer] Copied to resources");
} else {
  console.log("[speech-recognizer] No binary found, local STT will be unavailable");
}
