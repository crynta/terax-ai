#!/bin/bash
# Exports a pristine copy of a revision plus the app-lab overlay, so a benchmark measures that
# revision (not whatever else is being edited in the working tree):
#
#   export-tree.sh DEST [REV]        REV defaults to HEAD
#
# The overlay is only the app-lab files: the bench feature in src-tauri, the TERAX_BENCH define,
# the three bench hooks in App.tsx / main.tsx and src/bench + scripts/app-lab. Everything is
# read-only on the repository (git archive / git diff); DEST must not exist yet.
set -eu
dest="${1:?usage: export-tree.sh DEST [REV]}"
rev="${2:-HEAD}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
[ -e "$dest" ] && { echo "$dest already exists" >&2; exit 1; }
mkdir -p "$dest"
git -C "$repo" archive "$rev" | tar -x -C "$dest"
ln -s "$repo/node_modules" "$dest/node_modules"
# Tracked files the overlay edits (their diff against HEAD is exactly the bench hooks).
tracked=(
  src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/modules/mod.rs
  src/app/App.tsx src/main.tsx src/vite-env.d.ts vite.config.ts
)
git -C "$repo" diff HEAD -- "${tracked[@]}" | (cd "$dest" && patch -p1 --quiet)
# The CLI sidecar is git-ignored but release builds require it.
mkdir -p "$dest/src-tauri/binaries"
cp "$repo"/src-tauri/binaries/terax-cli-* "$dest/src-tauri/binaries/"
# Untracked app-lab files.
mkdir -p "$dest/src/bench" "$dest/scripts/app-lab"
cp "$repo"/src/bench/* "$dest/src/bench/"
cp "$repo"/src-tauri/src/modules/bench.rs "$dest/src-tauri/src/modules/bench.rs"
rsync -a --exclude __pycache__ "$repo"/scripts/app-lab/ "$dest/scripts/app-lab/"
echo "exported $rev + app-lab overlay to $dest"
