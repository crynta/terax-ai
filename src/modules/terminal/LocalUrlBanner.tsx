import { Button } from "@/components/ui/button";
import { Cancel01Icon, Key01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

type Props = {
  url: string;
  isOauth: boolean;
  onOpen: () => void;
  onDismiss: () => void;
};

const AUTO_DISMISS_MS = 30_000;

export function LocalUrlBanner({ url, isOauth, onOpen, onDismiss }: Props) {
  useEffect(() => {
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [url, onDismiss]);

  const shortUrl = url.length > 52 ? `${url.slice(0, 49)}…` : url;

  return (
    <div className="absolute bottom-2 left-2 right-2 z-50 flex items-center gap-2 rounded-md border border-border/70 bg-card/95 px-3 py-2 text-[11.5px] shadow-md backdrop-blur-sm">
      <HugeiconsIcon
        icon={isOauth ? Key01Icon : Link01Icon}
        size={13}
        strokeWidth={2}
        className={isOauth ? "shrink-0 text-amber-400" : "shrink-0 text-blue-400"}
      />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        <span className="mr-1.5 font-medium text-foreground">
          {isOauth ? "OAuth redirect" : "Local server"}
        </span>
        <button
          type="button"
          className="font-mono hover:underline focus:outline-none"
          onClick={onOpen}
          title={url}
        >
          {shortUrl}
        </button>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 px-2 text-[11px]"
        onClick={onOpen}
      >
        Open in Preview
      </Button>
      <button
        type="button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
