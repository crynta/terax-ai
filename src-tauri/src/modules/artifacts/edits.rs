use serde::{Deserialize, Serialize};

use super::types::{ArtifactError, ArtifactResult};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactTextEdit {
    pub old_text: String,
    pub new_text: String,
}

pub fn apply_exact_edits(content: &str, edits: &[ArtifactTextEdit]) -> ArtifactResult<String> {
    if edits.is_empty() {
        return Err(ArtifactError::invalid_edit(
            "artifact edit list must not be empty",
        ));
    }

    let mut replacements = Vec::with_capacity(edits.len());
    for edit in edits {
        if edit.old_text.is_empty() {
            return Err(ArtifactError::invalid_edit(
                "artifact edit oldText must not be empty",
            ));
        }
        if edit.old_text == edit.new_text {
            return Err(ArtifactError::invalid_edit(
                "artifact edit replacement must change content",
            ));
        }
        let matches = content.match_indices(&edit.old_text).collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(ArtifactError::invalid_edit(format!(
                "artifact edit oldText must match exactly once, matched {} times",
                matches.len()
            )));
        }
        let start = matches[0].0;
        let end = start + edit.old_text.len();
        replacements.push((start, end, edit.new_text.as_str()));
    }

    replacements.sort_by_key(|(start, _, _)| *start);
    for pair in replacements.windows(2) {
        if pair[0].1 > pair[1].0 {
            return Err(ArtifactError::invalid_edit(
                "artifact edits must not overlap",
            ));
        }
    }

    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;
    for (start, end, replacement) in replacements {
        output.push_str(&content[cursor..start]);
        output.push_str(replacement);
        cursor = end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_multiple_exact_edits_against_original_content() {
        let edits = vec![
            ArtifactTextEdit {
                old_text: "alpha".to_string(),
                new_text: "one".to_string(),
            },
            ArtifactTextEdit {
                old_text: "gamma".to_string(),
                new_text: "three".to_string(),
            },
        ];

        let result = apply_exact_edits("alpha beta gamma", &edits).unwrap();

        assert_eq!(result, "one beta three");
    }

    #[test]
    fn rejects_missing_duplicate_overlapping_and_noop_edits() {
        assert_eq!(
            apply_exact_edits(
                "alpha beta",
                &[ArtifactTextEdit {
                    old_text: "missing".to_string(),
                    new_text: "new".to_string(),
                }],
            )
            .unwrap_err()
            .code,
            "ARTIFACT_INVALID_EDIT"
        );
        assert_eq!(
            apply_exact_edits(
                "alpha alpha",
                &[ArtifactTextEdit {
                    old_text: "alpha".to_string(),
                    new_text: "one".to_string(),
                }],
            )
            .unwrap_err()
            .code,
            "ARTIFACT_INVALID_EDIT"
        );
        assert_eq!(
            apply_exact_edits(
                "abcdef",
                &[
                    ArtifactTextEdit {
                        old_text: "abc".to_string(),
                        new_text: "one".to_string(),
                    },
                    ArtifactTextEdit {
                        old_text: "bcd".to_string(),
                        new_text: "two".to_string(),
                    },
                ],
            )
            .unwrap_err()
            .code,
            "ARTIFACT_INVALID_EDIT"
        );
        assert_eq!(
            apply_exact_edits(
                "alpha",
                &[ArtifactTextEdit {
                    old_text: "alpha".to_string(),
                    new_text: "alpha".to_string(),
                }],
            )
            .unwrap_err()
            .code,
            "ARTIFACT_INVALID_EDIT"
        );
    }
}
