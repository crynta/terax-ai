import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type PaneLoadingFallbackProps = {
  label: string;
  className?: string;
};

export function PaneLoadingFallback({
  label,
  className,
}: PaneLoadingFallbackProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex h-full min-h-24 w-full items-center justify-center gap-2 rounded-md border border-border/60 bg-background text-[11px] text-muted-foreground",
        className,
      )}
    >
      <Spinner className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
