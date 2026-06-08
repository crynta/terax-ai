# Vision Image Context Implementation Plan

> For Terax fork: implement in small patches, preserve existing text workflow, keep provider calls on the current AI SDK v6 path.

Goal: Add image attachments from paste, drag and drop, and file picker so vision-capable OpenAI, Anthropic, Gemini, OpenRouter, and OpenAI-compatible models can receive images as context.

Architecture: Keep the current composer-owned attachment model and Chat transport. Image files stay in memory as data URLs and are stripped before session persistence, so no permanent image storage is introduced. Provider-specific handling is isolated behind a small TypeScript adapter module that validates model vision capability and normalizes message parts before `convertToModelMessages`.

Tech stack: Tauri 2, Rust IPC command for reading dropped image paths, React 19, TypeScript, AI SDK v6 file parts.

## Existing code map

- AI model/provider registry: `src/modules/ai/config.ts`
- Model construction and stream call: `src/modules/ai/lib/agent.ts`
- Context-aware transport: `src/modules/ai/lib/transport.ts`
- Composer state and submit path: `src/modules/ai/lib/composer.tsx`
- Composer textarea: `src/modules/ai/components/AiComposerInput.tsx`
- Attachment chips: `src/modules/ai/components/ChipsRow.tsx`
- Status bar file input: `src/modules/ai/components/AiStatusBarControls.tsx`
- Chat persistence bridge: `src/modules/ai/components/AgentRunBridge.tsx`
- Session persistence store: `src/modules/ai/store/chatStore.ts`
- Rust file IPC commands: `src-tauri/src/modules/fs/file.rs`
- Command registration: `src-tauri/src/lib.rs`

## File tree to change

- Create: `src/modules/ai/lib/imageAttachments.ts`
- Create: `src/modules/ai/lib/visionAdapters.ts`
- Create: `src/modules/ai/components/AttachedImages.tsx`
- Modify: `src/modules/ai/lib/composer.tsx`
- Modify: `src/modules/ai/components/AiComposerInput.tsx`
- Modify: `src/modules/ai/components/AiStatusBarControls.tsx`
- Modify: `src/modules/ai/components/AiChat.tsx`
- Modify: `src/modules/ai/store/chatStore.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/modules/fs/file.rs`
- Modify: `src-tauri/src/lib.rs`

## New components

- `AttachedImages`: preview-before-send section with thumbnail, filename, formatted size, and remove button.
- Drag overlay inside `AiComposerInput`: shown only when supported image files are dragged over composer.

## New TypeScript types

- `ImageAttachmentLimits`
- `ImageAttachmentInput`
- `ImageAttachmentErrorCode`
- `ImageAttachmentResult`
- `ImageDropPathPayload`
- `VisionProviderAdapter`

## Rust changes

- Add lightweight `base64` dependency.
- Add `fs_read_image_attachment(path, workspace)` command.
- Validate regular file, size limit, and MIME from magic bytes plus extension fallback for png, jpg, jpeg, webp.
- Return `{ name, media_type, size, data_url }`.

## Safe limits

- Accepted MIME: `image/png`, `image/jpeg`, `image/webp`.
- Max images per message: 5.
- Max single image: 10 MB.
- Max total image bytes: 20 MB.

## Implementation steps

1. Add pure image validation/helpers and vision provider adapter tests by typecheck.
2. Harden composer attachment ingestion: paste, browser drop, Tauri path drop, count and size limits.
3. Add UI previews: Attached Images section, paste hint, drag overlay, image-only file picker label.
4. Add Rust IPC for OS-dropped image paths with MIME sniffing.
5. Strip image file parts from persisted sessions while keeping them in the active in-memory run.
6. Run `pnpm check-types`, targeted Rust tests, then full frontend tests if dependencies are present.
