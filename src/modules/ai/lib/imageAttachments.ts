import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { FileAttachment } from "./composer";

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const IMAGE_ATTACHMENT_LIMITS = {
  maxImages: 5,
  maxSingleBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export type ImageAttachmentErrorCode =
  | "unsupported-type"
  | "too-large"
  | "too-many"
  | "total-too-large"
  | "read-failed";

export type ImageAttachmentResult =
  | { ok: true; attachment: FileAttachment }
  | { ok: false; code: ImageAttachmentErrorCode; message: string };

type NativeImageAttachment = {
  name: string;
  mediaType: string;
  size: number;
  dataUrl: string;
};

export function isAcceptedImageType(type: string): boolean {
  return IMAGE_MIME_TYPES.includes(type.toLowerCase() as (typeof IMAGE_MIME_TYPES)[number]);
}

export function isAcceptedImageName(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function validateImageBudget(
  existing: readonly FileAttachment[],
  incoming: { size: number },
): ImageAttachmentResult | null {
  const images = existing.filter((f) => f.kind === "image");
  if (images.length >= IMAGE_ATTACHMENT_LIMITS.maxImages) {
    return {
      ok: false,
      code: "too-many",
      message: `Attach up to ${IMAGE_ATTACHMENT_LIMITS.maxImages} images.`,
    };
  }
  if (incoming.size > IMAGE_ATTACHMENT_LIMITS.maxSingleBytes) {
    return {
      ok: false,
      code: "too-large",
      message: `Image is larger than ${formatBytes(IMAGE_ATTACHMENT_LIMITS.maxSingleBytes)}.`,
    };
  }
  const total = images.reduce((sum, f) => sum + f.size, 0) + incoming.size;
  if (total > IMAGE_ATTACHMENT_LIMITS.maxTotalBytes) {
    return {
      ok: false,
      code: "total-too-large",
      message: `Attached images exceed ${formatBytes(IMAGE_ATTACHMENT_LIMITS.maxTotalBytes)} total.`,
    };
  }
  return null;
}

export async function imageAttachmentFromFile(
  file: File,
  existing: readonly FileAttachment[],
): Promise<ImageAttachmentResult> {
  const mediaType = normalizeImageType(file.type, file.name);
  if (!mediaType) {
    return {
      ok: false,
      code: "unsupported-type",
      message: "Only PNG, JPG, JPEG, and WebP images are supported.",
    };
  }
  const budget = validateImageBudget(existing, file);
  if (budget) return budget;
  try {
    const url = await readAsDataURL(file);
    return {
      ok: true,
      attachment: {
        id: `img-${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        name: file.name,
        kind: "image",
        mediaType,
        url,
        size: file.size,
      },
    };
  } catch {
    return { ok: false, code: "read-failed", message: "Could not read image." };
  }
}

export async function imageAttachmentFromPath(
  path: string,
  existing: readonly FileAttachment[],
): Promise<ImageAttachmentResult> {
  try {
    const r = await invoke<NativeImageAttachment>("fs_read_image_attachment", {
      path,
      workspace: currentWorkspaceEnv(),
    });
    const budget = validateImageBudget(existing, r);
    if (budget) return budget;
    return {
      ok: true,
      attachment: {
        id: `img-path-${path}-${r.size}-${crypto.randomUUID()}`,
        name: r.name,
        kind: "image",
        mediaType: r.mediaType,
        url: r.dataUrl,
        size: r.size,
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: "read-failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function normalizeImageType(type: string, name: string): string | null {
  const lower = type.toLowerCase();
  if (isAcceptedImageType(lower)) return lower;
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  return null;
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
