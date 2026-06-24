use std::ffi::OsString;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::modules::git::errors::Result;
use crate::modules::git::process::run_git;
use crate::modules::git::types::{GitWorktreeNameSuggestion, DEFAULT_TIMEOUT_SECS};
use crate::modules::workspace::WorkspaceEnv;

const ADJECTIVES: &[&str] = &[
    "able", "aged", "agile", "alert", "alive", "amber", "ample", "apt", "arid", "ashen",
    "basic", "black", "bland", "blank", "bleak", "blind", "bliss", "blue", "bold", "brave",
    "brief", "bright", "broad", "brown", "calm", "cheap", "chief", "chill", "clean", "clear",
    "close", "cloudy", "cold", "cool", "crisp", "crude", "curly", "daily", "damp", "dark",
    "deep", "dense", "dim", "dizzy", "dry", "dull", "dusty", "early", "easy", "eager",
    "empty", "equal", "even", "faint", "fair", "false", "fancy", "fast", "final", "fine",
    "firm", "fixed", "flat", "fluid", "fond", "frail", "frank", "fresh", "full", "gentle",
    "giant", "glad", "grand", "gray", "great", "green", "grim", "happy", "hard", "harsh",
    "heavy", "high", "hollow", "holy", "hot", "huge", "humble", "icy", "ideal", "idle",
    "jolly", "keen", "kind", "large", "late", "lazy", "lean", "level", "light", "lively",
    "loose", "loud", "low", "loyal", "lucky", "lush", "major", "meek", "merry", "mild",
    "minor", "misty", "mixed", "modest", "murky", "mute", "narrow", "near", "neat", "new",
    "nimble", "noble", "noisy", "odd", "old", "open", "pale", "plain", "plump", "polite",
    "poor", "prime", "proud", "pure", "quick", "quiet", "rapid", "rare", "raw", "ready",
    "real", "red", "rich", "rigid", "ripe", "rough", "round", "royal", "safe", "salty",
    "sandy", "sharp", "shiny", "short", "shy", "silent", "silky", "simple", "slim", "slow",
    "small", "smart", "smoky", "smooth", "soft", "solid", "sour", "spare", "spry", "stark",
    "steep", "still", "stout", "subtle", "sunny", "sweet", "swift", "tall", "tame", "tart",
    "tidy", "tiny", "tough", "true", "vast", "vivid", "warm", "weak", "white", "wide",
    "wild", "wise", "witty", "young", "zesty",
];

const NOUNS: &[&str] = &[
    "acorn", "ant", "arc", "ash", "bay", "beach", "bear", "beast", "bee", "birch",
    "bird", "bloom", "bog", "branch", "breeze", "brook", "bud", "bush", "canyon", "cave",
    "cedar", "clay", "cliff", "cloud", "coast", "cove", "crane", "creek", "crow", "crystal",
    "dawn", "deer", "dell", "dove", "drift", "dune", "dust", "eagle", "echo", "edge",
    "elm", "ember", "falcon", "fade", "fawn", "fern", "field", "finch", "fir", "flame",
    "flint", "flood", "flora", "foam", "fog", "ford", "forest", "forge", "fox", "frog",
    "frost", "gale", "gate", "gem", "glade", "glen", "goose", "grass", "grove", "gust",
    "hawk", "haze", "hedge", "hill", "hollow", "isle", "ivy", "jade", "lake", "lark",
    "leaf", "lily", "loon", "lotus", "loom", "lunar", "lynx", "maple", "mare", "marsh",
    "meadow", "mist", "moon", "moss", "moth", "mount", "nest", "night", "nova", "oak",
    "oasis", "ocean", "opal", "orbit", "otter", "owl", "palm", "peak", "pearl", "pine",
    "plain", "pond", "prairie", "quail", "quartz", "rabbit", "rain", "raven", "reef", "ridge",
    "river", "robin", "rock", "rook", "rose", "sage", "sand", "sea", "shade", "shell",
    "shore", "sky", "slope", "snail", "snow", "sparrow", "spark", "spring", "spruce", "star",
    "stem", "stone", "storm", "stream", "summit", "sun", "surf", "swan", "thicket", "thorn",
    "tide", "trail", "tree", "tulip", "tundra", "turtle", "vale", "valley", "vine", "violet",
    "wave", "weed", "willow", "wind", "wing", "wisp", "wolf", "wood", "wren", "yield",
    "zenith",
];

static NAME_COUNTER: AtomicU64 = AtomicU64::new(0);

fn name_seed() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let n = NAME_COUNTER.fetch_add(1, Ordering::Relaxed);
    now ^ n.wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

fn word_pair() -> String {
    let seed = name_seed();
    let adjective = ADJECTIVES[(seed as usize) % ADJECTIVES.len()];
    let noun = NOUNS[((seed >> 32) as usize) % NOUNS.len()];
    format!("{adjective}-{noun}")
}

fn short_suffix() -> String {
    format!("{:04x}", name_seed() & 0xffff)
}

/// Generates a unique branch name from optional user input or a
/// random word pair. The name is guaranteed not to collide with any
/// existing branch in the repo by adding a 4 digit hex string.
pub fn suggest_branch_name(
    workspace: &WorkspaceEnv,
    repo_root: &str,
    user_input: Option<&str>,
) -> Result<GitWorktreeNameSuggestion> {
    let base = match user_input {
        Some(input) if !input.trim().is_empty() => slugify(input.trim()),
        _ => word_pair(),
    };

    let mut branch_name = base.clone();
    while branch_exists(workspace, repo_root, &branch_name)? {
        branch_name = format!("{base}-{}", short_suffix());
    }

    Ok(GitWorktreeNameSuggestion {
        display_name: branch_name.clone(),
        branch_name,
    })
}

fn branch_exists(workspace: &WorkspaceEnv, repo_root: &str, name: &str) -> Result<bool> {
    let output = run_git(
        workspace,
        Some(repo_root),
        [
            OsString::from("rev-parse"),
            OsString::from("--verify"),
            OsString::from("--quiet"),
            OsString::from(format!("refs/heads/{name}")),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    Ok(output.exit_code == Some(0))
}

fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if matches!(c, '-' | ' ' | '.' | '_' | '/' | '\\') && !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out
        .trim_start_matches('-')
        .trim_end_matches('-')
        .to_string();
    if trimmed.is_empty() {
        word_pair()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_drops_spaces_and_dots() {
        assert_eq!(slugify("my new feature"), "my-new-feature");
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("fix/button"), "fix-button");
        assert_eq!(slugify("  leading trailing  "), "leading-trailing");
        assert_eq!(slugify("already-slug"), "already-slug");
        assert_eq!(slugify("UPPERCASE"), "uppercase");
        assert_eq!(slugify("special!@#$chars"), "specialchars");
    }

    #[test]
    fn hex_has_correct_length() {
        let suffix = short_suffix();
        assert_eq!(suffix.len(), 4);
        for c in suffix.chars() {
            assert!(c.is_ascii_hexdigit());
        }
    }

    #[test]
    fn word_lists_are_populated() {
        assert!(ADJECTIVES.len() >= 50);
        assert!(NOUNS.len() >= 50);
    }

    #[test]
    fn slugify_empty_falls_back() {
        let result = slugify("");
        assert!(result.contains('-'), "expected hyphen in '{result}'");
    }
}
