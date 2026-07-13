import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

async function main() {
  const sourceRepository =
    process.env.SOURCE_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
  const releaseTag = process.env.RELEASE_TAG;
  const tapRepository = process.env.HOMEBREW_TAP_REPOSITORY;
  const githubToken =
    process.env.HOMEBREW_TAP_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

  if (!sourceRepository) {
    throw new Error("SOURCE_REPOSITORY or GITHUB_REPOSITORY is required.");
  }
  if (!releaseTag) {
    throw new Error("RELEASE_TAG is required.");
  }
  if (!tapRepository) {
    throw new Error("HOMEBREW_TAP_REPOSITORY is required.");
  }
  if (!githubToken) {
    throw new Error(
      "HOMEBREW_TAP_GITHUB_TOKEN or GITHUB_TOKEN is required to push to a tap repository.",
    );
  }

  const release = await fetchJson(
    `https://api.github.com/repos/${sourceRepository}/releases/tags/${releaseTag}`,
    githubToken,
  );
  const version = String(release.tag_name).replace(/^v/, "");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const [arm, intel] = await Promise.all([
    loadMacArtifact(assets, "arm", githubToken),
    loadMacArtifact(assets, "intel", githubToken),
  ]);

  const tempRoot = await mkdtemp(path.join(tmpdir(), "terax-homebrew-tap-"));
  const cloneUrl = `https://x-access-token:${githubToken}@github.com/${tapRepository}.git`;

  try {
    await execFile("git", ["clone", cloneUrl, tempRoot]);
    await writeCaskFile(
      tempRoot,
      renderCask({ version, sourceRepository, arm, intel }),
    );
    await execFile("git", ["config", "user.name", "github-actions[bot]"], {
      cwd: tempRoot,
    });
    await execFile(
      "git",
      [
        "config",
        "user.email",
        "41898282+github-actions[bot]@users.noreply.github.com",
      ],
      { cwd: tempRoot },
    );
    await execFile("git", ["add", "Casks/terax.rb"], { cwd: tempRoot });

    const { stdout: status } = await execFile("git", ["status", "--short"], {
      cwd: tempRoot,
    });
    if (!status.trim()) {
      console.log("Homebrew tap already up to date.");
      return;
    }

    await execFile(
      "git",
      ["commit", "-m", `chore(homebrew): update terax cask for ${releaseTag}`],
      { cwd: tempRoot },
    );
    await execFile("git", ["push", "origin", "HEAD"], { cwd: tempRoot });
    console.log(`Updated ${tapRepository} for ${releaseTag}.`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function loadMacArtifact(assets, arch, token) {
  const dmgAssets = assets.filter((asset) => /\.dmg$/i.test(asset.name ?? ""));
  const patterns =
    arch === "arm"
      ? [/aarch64/i, /arm64/i]
      : [/x86_64/i, /x64/i, /amd64/i];
  const match = dmgAssets.find((asset) =>
    patterns.some((pattern) => pattern.test(asset.name ?? "")),
  );
  if (!match) {
    throw new Error(
      `Could not find ${arch} macOS .dmg asset in release assets: ${assets
        .map((asset) => asset.name)
        .join(", ")}`,
    );
  }
  return {
    url: match.browser_download_url,
    sha256: await downloadSha256(match.browser_download_url, token),
  };
}

async function downloadSha256(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to download asset: ${url} (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${url} (${response.status})`);
  }
  return response.json();
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "terax-homebrew-sync",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function renderCask({ version, sourceRepository, arm, intel }) {
  return `cask "terax" do
  version "${version}"
  depends_on macos: ">= :catalina"
  auto_updates true

  on_arm do
    sha256 "${arm.sha256}"
    url "${arm.url}"
  end

  on_intel do
    sha256 "${intel.sha256}"
    url "${intel.url}"
  end

  name "Terax"
  desc "Open-source lightweight AI-native terminal"
  homepage "https://github.com/${sourceRepository}"

  app "Terax.app"

  zap trash: [
    "~/Library/Application Support/app.crynta.terax",
    "~/Library/Caches/app.crynta.terax",
    "~/Library/HTTPStorages/app.crynta.terax",
    "~/Library/Logs/app.crynta.terax",
    "~/Library/Preferences/app.crynta.terax.plist",
    "~/Library/Saved Application State/app.crynta.terax.savedState",
  ]
end
`;
}

async function writeCaskFile(root, cask) {
  const caskDir = path.join(root, "Casks");
  const caskPath = path.join(caskDir, "terax.rb");
  await mkdir(caskDir, { recursive: true });
  await writeFile(caskPath, cask, "utf8");
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
