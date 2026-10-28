import { cn } from "@/lib/utils";
import { type ImgHTMLAttributes, useState, useSyncExternalStore } from "react";
import {
  peekFileIconUrl,
  peekFolderIconUrl,
  subscribeFileIcons,
} from "./lib/iconResolver";

type IconImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">;

const serverSnapshot = () => "";

/**
 * Renders an icon URL, or - while the lazily loaded icon set is still on its
 * way - an empty slot with the exact same box, so nothing shifts when it lands.
 * A slot that was blank at mount fades the icon in instead of popping it.
 */
function IconSlot({
  url,
  className,
  width,
  height,
  onError,
  ...rest
}: IconImgProps & { url: string }) {
  const [arrivedLate] = useState(url === "");
  if (!url) {
    return (
      <span
        aria-hidden
        className={cn("block", className)}
        style={{ width, height }}
      />
    );
  }
  return (
    <img
      {...rest}
      src={url}
      alt=""
      width={width}
      height={height}
      className={cn(className, arrivedLate && "terax-icon-in")}
      onError={onError}
    />
  );
}

/** Icon for a file name (extension / well-known name aware). */
export function FileIcon({
  name,
  onError,
  ...props
}: IconImgProps & {
  name: string;
}) {
  const url = useSyncExternalStore(
    subscribeFileIcons,
    () => peekFileIconUrl(name),
    serverSnapshot,
  );
  return (
    <IconSlot
      {...props}
      url={url}
      onError={(e) => {
        // A decode failure must not leave a broken-image glyph in the chrome.
        const img = e.currentTarget;
        if (!img.dataset.fallback) {
          img.dataset.fallback = "1";
          img.src = peekFileIconUrl("dummy.txt");
        }
        onError?.(e);
      }}
    />
  );
}

/** Icon for a folder name, open or closed. */
export function FolderIcon({
  name,
  expanded = false,
  ...props
}: IconImgProps & { name: string; expanded?: boolean }) {
  const url = useSyncExternalStore(
    subscribeFileIcons,
    () => peekFolderIconUrl(name, expanded),
    serverSnapshot,
  );
  return <IconSlot {...props} url={url} />;
}
