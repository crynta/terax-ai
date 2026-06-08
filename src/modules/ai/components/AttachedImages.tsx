import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatBytes } from "../lib/imageAttachments";
import type { FileAttachment } from "../lib/composer";

type Props = {
  files: FileAttachment[];
  onRemove: (id: string) => void;
};

export function AttachedImages({ files, onRemove }: Props) {
  const images = files.filter((f) => f.kind === "image" && f.url);
  if (images.length === 0) return null;
  return (
    <section className="rounded-xl border border-border/50 bg-muted/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-foreground">Attached Images</div>
        <div className="text-[10px] text-muted-foreground">Preview before send</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {images.map((image) => (
          <div
            key={image.id}
            className={cn(
              "group flex min-w-0 items-center gap-2 rounded-lg border border-border/45 bg-card/70 p-1.5",
              "shadow-sm shadow-black/5",
            )}
          >
            <img
              src={image.url}
              alt=""
              className="size-12 shrink-0 rounded-md object-cover ring-1 ring-border/60"
              draggable={false}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-foreground" title={image.name}>
                {image.name}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {formatBytes(image.size)} · {image.mediaType.replace("image/", "")}
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 opacity-80 hover:opacity-100"
              onClick={() => onRemove(image.id)}
              aria-label={`Remove ${image.name}`}
              title="Remove image"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
