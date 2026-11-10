import { cn } from "@/lib/utils";
import { useCallback } from "react";
import { bindMediaPlayback } from "./lib/mediaPreview";

type Props = {
  kind: "video" | "audio";
  src: string;
  active: boolean;
};

export function MediaPreview({ kind, src, active }: Props) {
  const bindMedia = useCallback(
    (media: HTMLMediaElement | null) => {
      if (media) return bindMediaPlayback(media, active);
    },
    [active],
  );
  const Media = kind;
  return (
    <Media
      ref={bindMedia}
      controls
      preload="metadata"
      className={cn(
        kind === "video" ? "max-w-full max-h-full" : "w-full max-w-md",
        !active && "hidden",
      )}
      src={src}
    />
  );
}
