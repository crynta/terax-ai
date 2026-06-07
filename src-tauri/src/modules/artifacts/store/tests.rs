use super::*;
use crate::modules::artifacts::edits::ArtifactTextEdit;
use crate::modules::artifacts::types::ArtifactKind;
use std::sync::Arc;
use std::thread;

fn store() -> (tempfile::TempDir, ArtifactStore) {
    let temp = tempfile::tempdir().unwrap();
    let store = ArtifactStore::new(temp.path().join("artifacts"));
    (temp, store)
}

#[test]
fn creates_lists_gets_and_versions_artifacts_without_loading_content_for_list() {
    let (_temp, store) = store();

    let created = store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "Hero Card".to_string(),
                title: Some("Hero Card".to_string()),
                kind: ArtifactKind::Html,
                content: "<section>Hello</section>".to_string(),
            },
        )
        .unwrap();

    assert_eq!(created.summary.slug, "hero-card");
    assert_eq!(created.summary.version, 1);
    assert_eq!(created.content, "<section>Hello</section>");
    assert_eq!(created.summary.content_bytes, 24);
    assert_eq!(created.summary.content_hash.len(), 64);

    let list = store.list("pi_session_1").unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].slug, "hero-card");
    assert_eq!(list[0].content_bytes, 24);

    let fetched = store.get("pi_session_1", "hero-card", None).unwrap();
    assert_eq!(fetched.content, "<section>Hello</section>");

    let versions = store.versions("pi_session_1", "hero-card").unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].version, 1);
}

#[test]
fn renames_artifact_title_without_changing_slug_or_content_version() {
    let (_temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "hero-card".to_string(),
                title: Some("Hero Card".to_string()),
                kind: ArtifactKind::Html,
                content: "<h1>Hero</h1>".to_string(),
            },
        )
        .unwrap();

    let renamed = store
        .rename_title("pi_session_1", "hero-card", "Marketing Hero")
        .unwrap();

    assert_eq!(renamed.summary.slug, "hero-card");
    assert_eq!(renamed.summary.title, "Marketing Hero");
    assert_eq!(renamed.summary.version, 1);
    assert_eq!(renamed.content, "<h1>Hero</h1>");
    assert_eq!(
        store.versions("pi_session_1", "hero-card").unwrap().len(),
        1
    );
    assert_eq!(
        store.list("pi_session_1").unwrap()[0].title,
        "Marketing Hero"
    );
}

#[test]
fn update_and_edit_create_new_versions_and_reject_stale_base_versions() {
    let (_temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "draft".to_string(),
                title: None,
                kind: ArtifactKind::Markdown,
                content: "# Title\n\nOld body".to_string(),
            },
        )
        .unwrap();

    let updated = store
        .update("pi_session_1", "draft", "# Title\n\nNew body", Some(1))
        .unwrap();
    assert_eq!(updated.summary.version, 2);

    let edited = store
        .edit(
            "pi_session_1",
            "draft",
            &[ArtifactTextEdit {
                old_text: "New body".to_string(),
                new_text: "Final body".to_string(),
            }],
            Some(2),
        )
        .unwrap();
    assert_eq!(edited.summary.version, 3);
    assert_eq!(edited.content, "# Title\n\nFinal body");

    assert_eq!(
        store
            .update("pi_session_1", "draft", "stale", Some(2))
            .unwrap_err()
            .code,
        "ARTIFACT_CONFLICT"
    );
}

#[test]
fn lists_all_artifact_conversations_without_loading_content() {
    let (_temp, store) = store();
    store
        .create(
            "pi_session_old",
            ArtifactCreateInput {
                slug: "old".to_string(),
                title: Some("Old".to_string()),
                kind: ArtifactKind::Markdown,
                content: "old secret body".to_string(),
            },
        )
        .unwrap();
    store
        .create(
            "pi_session_new",
            ArtifactCreateInput {
                slug: "new".to_string(),
                title: Some("New".to_string()),
                kind: ArtifactKind::Html,
                content: "new secret body".to_string(),
            },
        )
        .unwrap();

    let all = store.list_all().unwrap();

    assert_eq!(all.len(), 2);
    assert_eq!(
        all.iter().map(|entry| entry.artifact_count).sum::<usize>(),
        2
    );
    assert!(
        all.iter()
            .any(|entry| entry.conversation_id == "pi_session_old"
                && entry.artifacts[0].slug == "old")
    );
    assert!(
        all.iter()
            .any(|entry| entry.conversation_id == "pi_session_new"
                && entry.artifacts[0].slug == "new")
    );
    let serialized = serde_json::to_string(&all).unwrap();
    assert!(!serialized.contains("secret body"));
}

#[test]
fn delete_moves_artifact_to_recoverable_trash_and_restore_reinserts_it() {
    let (temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "draft".to_string(),
                title: Some("Draft".to_string()),
                kind: ArtifactKind::Markdown,
                content: "# Draft".to_string(),
            },
        )
        .unwrap();
    store
        .update("pi_session_1", "draft", "# Draft\n\nSecond", None)
        .unwrap();

    let deleted = store.delete("pi_session_1", "draft").unwrap();

    assert!(deleted.deleted);
    assert_eq!(deleted.deleted_count, 1);
    assert!(deleted.undo_token.is_some());
    assert!(store.list("pi_session_1").unwrap().is_empty());
    assert_eq!(
        store.get("pi_session_1", "draft", None).unwrap_err().code,
        "ARTIFACT_NOT_FOUND"
    );
    let trash_dir = temp.path().join("artifacts/trash");
    assert!(trash_dir.exists());

    let restored = store
        .restore_deleted("pi_session_1", "draft", deleted.undo_token.as_deref())
        .unwrap();

    assert_eq!(restored.summary.slug, "draft");
    assert_eq!(restored.summary.version, 2);
    assert_eq!(restored.content, "# Draft\n\nSecond");
    assert_eq!(store.versions("pi_session_1", "draft").unwrap().len(), 2);
}

#[test]
fn failed_delete_physical_move_leaves_manifest_and_cleans_trash_record() {
    let (_temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "draft".to_string(),
                title: Some("Draft".to_string()),
                kind: ArtifactKind::Markdown,
                content: "# Draft".to_string(),
            },
        )
        .unwrap();
    let key = conversation_key("pi_session_1").unwrap();
    std::fs::remove_dir_all(store.artifact_dir(&key, "draft")).unwrap();

    let error = store.delete("pi_session_1", "draft").unwrap_err();

    assert_eq!(error.code, "ARTIFACT_STORE_UNAVAILABLE");
    assert_eq!(store.list("pi_session_1").unwrap()[0].slug, "draft");
    assert!(store.list_deleted().unwrap().is_empty());
}

#[test]
fn lists_deleted_artifacts_as_metadata_without_content() {
    let (_temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "secret-draft".to_string(),
                title: Some("Secret Draft".to_string()),
                kind: ArtifactKind::Markdown,
                content: "# Secret\n\nDo not leak this body".to_string(),
            },
        )
        .unwrap();
    let deleted = store.delete("pi_session_1", "secret-draft").unwrap();

    let deleted_artifacts = store.list_deleted().unwrap();

    assert_eq!(deleted_artifacts.len(), 1);
    let summary = &deleted_artifacts[0];
    assert_eq!(summary.conversation_id, "pi_session_1");
    assert_eq!(summary.slug, "secret-draft");
    assert_eq!(summary.title, "Secret Draft");
    assert_eq!(summary.kind, ArtifactKind::Markdown);
    assert_eq!(summary.version, 1);
    assert_eq!(summary.undo_token, deleted.undo_token.unwrap());
    assert_eq!(summary.content_hash.len(), 64);
    assert!(summary.deleted_at.ends_with('Z'));
    let serialized = serde_json::to_string(&deleted_artifacts).unwrap();
    assert!(!serialized.contains("Do not leak"));
}

#[test]
fn purges_deleted_artifact_by_undo_token_without_touching_active_artifacts() {
    let (_temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "draft".to_string(),
                title: Some("Draft".to_string()),
                kind: ArtifactKind::Text,
                content: "deleted".to_string(),
            },
        )
        .unwrap();
    let deleted = store.delete("pi_session_1", "draft").unwrap();
    let undo_token = deleted.undo_token.unwrap();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "active".to_string(),
                title: Some("Active".to_string()),
                kind: ArtifactKind::Text,
                content: "active".to_string(),
            },
        )
        .unwrap();

    let purged = store
        .purge_deleted("pi_session_1", "draft", &undo_token)
        .unwrap();

    assert!(purged.deleted);
    assert_eq!(purged.deleted_count, 1);
    assert!(purged.undo_token.is_none());
    assert!(store.list_deleted().unwrap().is_empty());
    assert_eq!(
        store.get("pi_session_1", "active", None).unwrap().content,
        "active"
    );
    assert_eq!(
        store
            .restore_deleted("pi_session_1", "draft", Some(&undo_token))
            .unwrap_err()
            .code,
        "ARTIFACT_NOT_FOUND"
    );
}

#[test]
fn bulk_delete_restore_and_export_return_per_item_metadata_without_content() {
    let (temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "alpha".to_string(),
                title: Some("Alpha".to_string()),
                kind: ArtifactKind::Html,
                content: "<h1>alpha secret</h1>".to_string(),
            },
        )
        .unwrap();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "beta".to_string(),
                title: Some("Beta".to_string()),
                kind: ArtifactKind::Markdown,
                content: "# beta secret".to_string(),
            },
        )
        .unwrap();

    let deleted = store
        .delete_many(&[
            ArtifactBulkTarget::active("pi_session_1", "alpha"),
            ArtifactBulkTarget::active("pi_session_1", "missing"),
        ])
        .unwrap();

    assert_eq!(deleted.requested_count, 2);
    assert_eq!(deleted.success_count, 1);
    assert_eq!(deleted.failure_count, 1);
    let alpha_delete = deleted
        .items
        .iter()
        .find(|item| item.slug == "alpha")
        .unwrap();
    assert!(alpha_delete.success);
    let undo_token = alpha_delete.undo_token.clone().unwrap();
    assert!(deleted
        .items
        .iter()
        .any(|item| item.slug == "missing" && !item.success));

    let restored = store
        .restore_deleted_many(&[ArtifactBulkTarget::deleted(
            "pi_session_1",
            "alpha",
            &undo_token,
        )])
        .unwrap();

    assert_eq!(restored.success_count, 1);
    assert_eq!(
        store.get("pi_session_1", "alpha", None).unwrap().content,
        "<h1>alpha secret</h1>"
    );

    let exported = store
        .export_many(
            &[
                ArtifactBulkTarget::active("pi_session_1", "alpha"),
                ArtifactBulkTarget::active("pi_session_1", "beta"),
            ],
            &temp.path().join("exports"),
        )
        .unwrap();

    assert_eq!(exported.success_count, 2);
    assert_eq!(exported.failure_count, 0);
    for item in &exported.items {
        assert!(item.path.as_ref().is_some_and(|path| path.exists()));
        assert!(item
            .content_hash
            .as_ref()
            .is_some_and(|hash| hash.len() == 64));
        assert!(item.content_bytes.unwrap_or_default() > 0);
    }
    let serialized = serde_json::to_string(&exported).unwrap();
    assert!(!serialized.contains("alpha secret"));
    assert!(!serialized.contains("beta secret"));
}

#[test]
fn artifacts_are_isolated_by_conversation_and_use_safe_paths() {
    let (temp, store) = store();
    store
        .create(
            "pi/session:one",
            ArtifactCreateInput {
                slug: "shared".to_string(),
                title: None,
                kind: ArtifactKind::Text,
                content: "one".to_string(),
            },
        )
        .unwrap();
    store
        .create(
            "pi/session:two",
            ArtifactCreateInput {
                slug: "shared".to_string(),
                title: None,
                kind: ArtifactKind::Text,
                content: "two".to_string(),
            },
        )
        .unwrap();

    assert_eq!(
        store.get("pi/session:one", "shared", None).unwrap().content,
        "one"
    );
    assert_eq!(
        store.get("pi/session:two", "shared", None).unwrap().content,
        "two"
    );
    assert!(temp
        .path()
        .join("artifacts/conversations/c_70692f73657373696f6e3a6f6e65/manifest.json")
        .exists());
}

#[test]
fn exports_artifact_versions_to_matching_extension_without_returning_content() {
    let (temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "draft".to_string(),
                title: None,
                kind: ArtifactKind::Markdown,
                content: "# Draft\n\nFirst".to_string(),
            },
        )
        .unwrap();
    store
        .update("pi_session_1", "draft", "# Draft\n\nSecond", None)
        .unwrap();

    let destination = temp.path().join("exports/draft.md");
    let result = store
        .export_to("pi_session_1", "draft", Some(1), &destination)
        .unwrap();

    assert_eq!(
        std::fs::read_to_string(&destination).unwrap(),
        "# Draft\n\nFirst"
    );
    assert_eq!(result.version, 1);
    assert_eq!(result.content_bytes, 14);
    assert_eq!(result.path, destination);
    let serialized = serde_json::to_string(&result).unwrap();
    assert!(!serialized.contains("First"));
    assert!(!serialized.contains("Second"));
}

#[test]
fn exports_react_as_compiled_html_without_returning_source() {
    let (temp, store) = store();
    let source = r#"
export default function Widget() {
  return <section className="hero"><h1>Hello</h1></section>;
}
"#;
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "widget".to_string(),
                title: None,
                kind: ArtifactKind::React,
                content: source.to_string(),
            },
        )
        .unwrap();

    let destination = temp.path().join("exports/widget.html");
    let result = store
        .export_to("pi_session_1", "widget", None, &destination)
        .unwrap();
    let exported = std::fs::read_to_string(&destination).unwrap();

    assert!(exported.contains("terax-react-preview-root"));
    assert!(exported.contains("Hello"));
    assert!(exported.contains("hero"));
    assert!(!exported.contains("export default function"));
    assert_eq!(result.version, 1);
    assert_eq!(result.content_bytes, exported.len());
    assert_eq!(result.content_hash, sha256_hex(&exported));
    let serialized = serde_json::to_string(&result).unwrap();
    assert!(!serialized.contains("Hello"));
    assert!(!serialized.contains("export default"));
}

#[test]
fn export_rejects_mismatched_extensions() {
    let (temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "page".to_string(),
                title: None,
                kind: ArtifactKind::Html,
                content: "<h1>Page</h1>".to_string(),
            },
        )
        .unwrap();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "widget".to_string(),
                title: None,
                kind: ArtifactKind::React,
                content: "export default function Widget() { return <div /> }".to_string(),
            },
        )
        .unwrap();

    assert_eq!(
        store
            .export_to("pi_session_1", "page", None, &temp.path().join("page.txt"))
            .unwrap_err()
            .code,
        "ARTIFACT_EXPORT_DENIED"
    );
    assert_eq!(
        store
            .export_to(
                "pi_session_1",
                "widget",
                None,
                &temp.path().join("widget.jsx")
            )
            .unwrap_err()
            .code,
        "ARTIFACT_EXPORT_DENIED"
    );
}

#[test]
fn artifact_lifecycle_smoke_covers_preview_export_versions_and_cleanup() {
    let (temp, store) = store();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "page".to_string(),
                title: Some("Page".to_string()),
                kind: ArtifactKind::Html,
                content: "<h1>Page</h1>".to_string(),
            },
        )
        .unwrap();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "notes".to_string(),
                title: Some("Notes".to_string()),
                kind: ArtifactKind::Markdown,
                content: "# Notes".to_string(),
            },
        )
        .unwrap();
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "widget".to_string(),
                title: Some("Widget".to_string()),
                kind: ArtifactKind::React,
                content: r#"export default function Widget() { return <section className="hero">Hello</section>; }"#
                    .to_string(),
            },
        )
        .unwrap();

    store
        .update("pi_session_1", "notes", "# Notes\n\nSecond", None)
        .unwrap();
    let versions = store.versions("pi_session_1", "notes").unwrap();
    assert_eq!(
        versions
            .iter()
            .map(|version| version.version)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(
        store.get("pi_session_1", "notes", Some(1)).unwrap().content,
        "# Notes"
    );

    let react_destination = temp.path().join("exports/widget.html");
    let react_export = store
        .export_to("pi_session_1", "widget", None, &react_destination)
        .unwrap();
    let exported_react = std::fs::read_to_string(&react_destination).unwrap();
    assert!(exported_react.contains("terax-react-preview-root"));
    assert!(exported_react.contains("Hello"));
    assert!(!exported_react.contains("export default function"));
    assert_eq!(react_export.content_bytes, exported_react.len());

    assert_eq!(store.list("pi_session_1").unwrap().len(), 3);
    let cleanup = store.delete_conversation("pi_session_1").unwrap();
    assert_eq!(cleanup.deleted_count, 3);
    assert!(store.list("pi_session_1").unwrap().is_empty());
    assert!(react_destination.exists());
}

#[test]
fn serializes_concurrent_updates_without_lost_versions() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(ArtifactStore::new(temp.path().join("artifacts")));
    store
        .create(
            "pi_session_1",
            ArtifactCreateInput {
                slug: "counter".to_string(),
                title: None,
                kind: ArtifactKind::Text,
                content: "0".to_string(),
            },
        )
        .unwrap();

    let handles = (0..8)
        .map(|index| {
            let store = Arc::clone(&store);
            thread::spawn(move || {
                store
                    .update("pi_session_1", "counter", &format!("value {index}"), None)
                    .unwrap();
            })
        })
        .collect::<Vec<_>>();

    for handle in handles {
        handle.join().unwrap();
    }

    let current = store.get("pi_session_1", "counter", None).unwrap();
    assert_eq!(current.summary.version, 9);
    assert_eq!(store.versions("pi_session_1", "counter").unwrap().len(), 9);
}
