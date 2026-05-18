/**
 * Path-safety guards for AI tool calls.
 *
 * Goals:
 *  - Block reads of files that almost always contain secrets (.env*, *.pem,
 *    id_rsa*, .aws/credentials, .ssh/, .git/, kube/azure config, etc.).
 *  - Block writes/exec into the same set, plus directories where automated
 *    mutation is dangerous (system dirs, Windows system dirs).
 *
 * This is a *defense layer*, not a sandbox. The model may still be coaxed
 * into doing something silly within allowed paths — the user-confirmation
 * UI for write/exec is the real safety net. These checks ensure that
 * read tools (which auto-approve) can never silently exfiltrate obvious
 * secrets, and that a single bad approval can't blow up the system.
 *
 * Defense-in-depth notes:
 *  - Comparison surface is lowercased *only for matching*. Original path is
 *    preserved for basename pattern checks and error messages.
 *  - Windows drive prefix (e.g. `C:`) is stripped from the comparison form so
 *    Unix-style root prefix checks behave consistently on both platforms.
 *  - Protected directories match exact-equal-or-descendant, not raw
 *    substring-with-trailing-slash. Bare names (`/Users/me/.ssh`) and
 *    case-variants (`/Users/me/.SSH/config` on macOS/Windows case-insensitive
 *    filesystems) are caught.
 *  - The caller is expected to additionally validate the *canonical* path
 *    (post symlink resolution) via `native.canonicalize` + a second
 *    `checkReadable` pass, since a symlink at an "innocent" path can point
 *    into a protected directory.
 */

const SECRET_BASENAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production, etc.
  /^.*\.pem$/i,
  /^.*\.key$/i, // private keys
  /^.*\.p12$/i,
  /^.*\.pfx$/i,
  /^.*\.asc$/i, // PGP armored keys
  /^.*\.gpg$/i,
  /^.*\.keystore$/i,
  /^.*\.jks$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^known_hosts$/i,
  /^authorized_keys$/i,
  /^htpasswd$/i,
  /^\.netrc$/i,
  /^_netrc$/i, // Windows variant
  /^credentials$/i, // .aws/credentials, gcloud, etc.
  /^\.pgpass$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^secrets?\.(json|ya?ml|toml|env)$/i,
  /^service[-_]?account.*\.json$/i, // GCP service account keys
];

/**
 * Protected directories. Matched as **exact path** OR **prefix where the next
 * char is a separator** — never raw substring. Listed without trailing slash;
 * the comparator handles separators.
 */
const PROTECTED_DIRS = [
  "/.ssh",
  "/.gnupg",
  "/.aws",
  "/.azure",
  "/.kube",
  "/.docker",
  "/.config/gh",
  "/.config/git",
  "/.config/gcloud",
  "/.config/op", // 1Password CLI
  "/.git", // git internals — refusing avoids tools mutating refs/objects
  "/.terraform.d",
  "/library/keychains",
  "/library/cookies",
  // Windows user profile equivalents (post drive-strip + lowercase).
  "/appdata/roaming/microsoft/credentials",
  "/appdata/local/microsoft/credentials",
  "/appdata/roaming/gcloud",
];

/**
 * Write-only deny prefixes (system locations). Read access is *not* universally
 * blocked — reading `/etc/hosts` is fine; writing to it isn't.
 */
const WRITE_DENY_PREFIXES = [
  "/etc/",
  "/var/db/",
  "/var/root/",
  "/system/", // case-folded from /System/
  "/library/keychains/",
  "/library/launchagents/",
  "/library/launchdaemons/",
  "/private/etc/",
  "/private/var/db/",
  "/usr/bin/",
  "/usr/sbin/",
  "/usr/local/bin/",
  "/bin/",
  "/sbin/",
  "/boot/",
  // Windows (post drive-strip + lowercase). Note: these block writes to the
  // system drive's Windows / Program Files. Drives are stripped, so any
  // /windows/... etc. matches regardless of drive letter.
  "/windows/",
  "/program files/",
  "/program files (x86)/",
  "/programdata/",
];

export type SafetyResult = { ok: true } | { ok: false; reason: string };

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * Build a normalized *comparison surface* — never used as a real path:
 *  - back-slashes -> forward-slashes
 *  - strip Windows drive prefix (e.g. `C:`)
 *  - strip UNC prefix `//?/`
 *  - collapse duplicate slashes
 *  - lowercase (so case variants match on case-insensitive filesystems)
 *  - drop trailing slash (except for root)
 */
function comparisonForm(p: string): string {
  let s = p.replace(/\\/g, "/");
  // UNC / extended-length prefix: \\?\C:\... or //?/C:/... → strip up to drive.
  s = s.replace(/^\/\/\?\//, "/");
  // Drive prefix: C:/foo → /foo. Important: do this BEFORE lowercasing so we
  // don't have to special-case "c:" vs "C:".
  s = s.replace(/^[a-zA-Z]:/, "");
  // Collapse duplicate slashes (//foo → /foo). Preserve a possible leading
  // single slash.
  s = s.replace(/\/{2,}/g, "/");
  s = s.toLowerCase();
  // Drop trailing slash so "/foo/" and "/foo" compare equal.
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function isUnderProtected(cmp: string, dir: string): boolean {
  // Protected dirs (`/.ssh`, `/.config/gh`, …) live under the user's home or
  // somewhere else in the tree — they are NOT root-anchored. Match the dir as
  // a path-segment substring: append `/` to both sides so we don't match
  // false positives like `/.sshx` against `/.ssh`.
  //
  //   "/users/me/.ssh/config" + "/" → contains "/.ssh/" ✓
  //   "/users/me/.ssh"        + "/" → contains "/.ssh/" ✓
  //   "/users/me/.sshx/file"  + "/" → does not contain "/.ssh/" ✓
  return (cmp + "/").includes(dir + "/");
}

function describeProtected(dir: string): string {
  // "/.ssh" -> ".ssh", "/.config/gh" -> ".config/gh"
  return dir.replace(/^\//, "");
}

export function checkReadable(path: string): SafetyResult {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, reason: "Refused: empty path." };
  }
  // Reject NUL and control bytes in paths — these are never legitimate and
  // are a classic truncation/injection vector.
  if (/[\x00-\x1f]/.test(path)) {
    return { ok: false, reason: "Refused: path contains control bytes." };
  }

  const base = basename(path);
  for (const re of SECRET_BASENAME_PATTERNS) {
    if (re.test(base)) {
      return {
        ok: false,
        reason: `Refused: "${base}" matches a sensitive-file pattern.`,
      };
    }
  }

  const cmp = comparisonForm(path);
  for (const dir of PROTECTED_DIRS) {
    if (isUnderProtected(cmp, dir)) {
      return {
        ok: false,
        reason: `Refused: path is inside a protected directory (${describeProtected(dir)}).`,
      };
    }
  }

  return { ok: true };
}

export function checkWritable(path: string): SafetyResult {
  // Writes inherit all read restrictions, plus system-directory blocks.
  const r = checkReadable(path);
  if (!r.ok) return r;

  const cmp = comparisonForm(path);
  // Ensure the comparison surface has a leading separator for prefix matching.
  const cmpForPrefix = cmp.startsWith("/") ? cmp : `/${cmp}`;
  for (const prefix of WRITE_DENY_PREFIXES) {
    if (cmpForPrefix.startsWith(prefix) || `${cmpForPrefix}/`.startsWith(prefix)) {
      return {
        ok: false,
        reason: `Refused: writes under "${prefix.replace(/\/$/, "")}" are not allowed.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Lightweight heuristic for blocking obviously destructive shell commands
 * even after the user has approved them. The approval UI shows the command
 * verbatim, so the user is the primary gate; this just catches a couple of
 * patterns that almost certainly indicate the model went off the rails.
 */
/**
 * Two-phase safety check that also defends against symlink traversal: first
 * checks the literal path, then (if it exists) canonicalizes it via the
 * native FS and re-checks the resolved path. A symlink at `./innocent.txt`
 * pointing into `~/.ssh/id_rsa` is caught on the second pass.
 *
 * Returns the canonical path on success so callers can use it for the actual
 * read — avoids TOCTOU between the safety check and the read.
 */
export async function checkReadableCanonical(
  path: string,
  canonicalize: (p: string) => Promise<string>,
): Promise<{ ok: true; canonical: string } | { ok: false; reason: string }> {
  const initial = checkReadable(path);
  if (!initial.ok) return initial;
  let canonical: string;
  try {
    canonical = await canonicalize(path);
  } catch {
    // Path doesn't exist yet — fine for the read tool to surface ENOENT.
    return { ok: true, canonical: path };
  }
  if (canonical !== path) {
    const recheck = checkReadable(canonical);
    if (!recheck.ok) return recheck;
  }
  return { ok: true, canonical };
}

/**
 * Same pattern as {@link checkReadableCanonical} but for writes. The canonical
 * path is only available if the file already exists — for new-file creates
 * we additionally canonicalize the parent directory.
 */
export async function checkWritableCanonical(
  path: string,
  canonicalize: (p: string) => Promise<string>,
): Promise<{ ok: true; canonical: string } | { ok: false; reason: string }> {
  const initial = checkWritable(path);
  if (!initial.ok) return initial;
  // Try canonicalizing the target itself first.
  try {
    const canonical = await canonicalize(path);
    if (canonical !== path) {
      const recheck = checkWritable(canonical);
      if (!recheck.ok) return recheck;
      return { ok: true, canonical };
    }
    return { ok: true, canonical };
  } catch {
    // Target doesn't exist — canonicalize the parent so we still catch a
    // symlinked parent directory (`./project -> /Users/me/.ssh`).
    const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (lastSep > 0) {
      const parent = path.slice(0, lastSep);
      const tail = path.slice(lastSep);
      try {
        const canonParent = await canonicalize(parent);
        const recheckParent = checkWritable(canonParent + tail);
        if (!recheckParent.ok) return recheckParent;
        return { ok: true, canonical: canonParent + tail };
      } catch {
        // Parent doesn't exist either — let the caller surface the actual error.
      }
    }
    return { ok: true, canonical: path };
  }
}

export function checkShellCommand(cmd: string): SafetyResult {
  const c = cmd.trim();
  if (c.length === 0) {
    return { ok: false, reason: "Refused: empty command." };
  }
  // Block NUL bytes in commands — never legitimate.
  if (/\x00/.test(c)) {
    return { ok: false, reason: "Refused: command contains NUL byte." };
  }
  // rm -rf / (and variants with quoted /, --no-preserve-root, etc.)
  if (
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive\s+--force|--force\s+--recursive)\s+(['"]?\/['"]?\s*($|;|&|\|))/.test(
      c,
    )
  ) {
    return {
      ok: false,
      reason:
        "Refused: command attempts to recursively delete the filesystem root.",
    };
  }
  // rm -rf ~ / $HOME — wiping the user's home dir
  if (
    /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(['"]?(~|\$HOME)['"]?)(\s|$|;|&|\|)/.test(
      c,
    )
  ) {
    return {
      ok: false,
      reason: "Refused: command attempts to recursively delete the home directory.",
    };
  }
  if (/--no-preserve-root/.test(c)) {
    return { ok: false, reason: "Refused: --no-preserve-root is not allowed." };
  }
  // dd to a raw disk device
  if (/\bdd\b[^|]*\bof=\/dev\/(disk|sd|nvme|hd)/i.test(c)) {
    return { ok: false, reason: "Refused: dd to a block device is not allowed." };
  }
  // mkfs / fdisk / diskutil eraseDisk / parted
  if (
    /\b(mkfs(\.[a-z0-9]+)?|fdisk|parted)\b/.test(c) ||
    /\bdiskutil\s+erase/i.test(c)
  ) {
    return {
      ok: false,
      reason: "Refused: disk-formatting commands are not allowed.",
    };
  }
  // Fork bomb
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/.test(c)) {
    return { ok: false, reason: "Refused: fork-bomb pattern detected." };
  }
  // Pipe-to-shell from network. The user already approves the command, but
  // this combo is overwhelmingly malicious-payload-shaped and worth flagging.
  if (/\b(curl|wget)\b[^|;&]*\|\s*(ba|z|k|d|fi|c)?sh\b/.test(c)) {
    return {
      ok: false,
      reason:
        "Refused: piping a network download directly into a shell is blocked. Download first, inspect, then run.",
    };
  }
  return { ok: true };
}
