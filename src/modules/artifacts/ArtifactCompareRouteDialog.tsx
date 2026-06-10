import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizeCompareRoute } from "@/modules/artifacts/lib/compareRoutes";

export type ArtifactCompareRouteRequest = {
  conversationId: string;
  slug: string;
  title?: string;
};

type ArtifactCompareRouteDialogProps = {
  request: ArtifactCompareRouteRequest | null;
  defaultUrl: string;
  recentUrls: readonly string[];
  onCancel: () => void;
  onConfirm: (request: ArtifactCompareRouteRequest, url: string) => void;
};

export function ArtifactCompareRouteDialog({
  request,
  defaultUrl,
  recentUrls,
  onCancel,
  onConfirm,
}: ArtifactCompareRouteDialogProps) {
  const [draft, setDraft] = useState(defaultUrl);

  useEffect(() => {
    if (request) setDraft(defaultUrl);
  }, [defaultUrl, request]);

  const normalized = useMemo(() => normalizeCompareRoute(draft), [draft]);
  const error = draft.trim() && !normalized ? "Enter a valid http(s) URL." : null;

  const submit = () => {
    if (!request || !normalized) return;
    onConfirm(request, normalized);
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compare artifact to browser route</DialogTitle>
          <DialogDescription>
            Open a side-by-side tab with the artifact preview and the real app
            route. Use your local dev server or any embeddable http(s) page.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="artifact-compare-url">
              Browser route URL
            </label>
            <Input
              id="artifact-compare-url"
              value={draft}
              autoFocus
              placeholder="http://localhost:5173/"
              aria-invalid={error ? true : undefined}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            <div
              className={cn(
                "min-h-4 text-[11px]",
                error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {error ?? "Artifact previews stay sandboxed; browser routes use the normal preview iframe."}
            </div>
          </div>

          {recentUrls.length > 0 ? (
            <div className="grid gap-1.5">
              <div className="text-xs font-medium">Recent routes</div>
              <div className="flex flex-wrap gap-1.5">
                {recentUrls.map((url) => (
                  <Button
                    key={url}
                    type="button"
                    size="xs"
                    variant="outline"
                    className="max-w-full truncate"
                    onClick={() => setDraft(url)}
                  >
                    {url}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={!normalized} onClick={submit}>
            Open compare
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
