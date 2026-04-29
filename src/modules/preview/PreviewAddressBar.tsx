import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ArrowReloadHorizontalIcon,
  Globe02Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type PortPreset = {
  port: number;
  label: string;
  hint: string;
};

// Curated dev-server ports. Ordered by frontend frequency, then backend.
const PORT_PRESETS: readonly PortPreset[] = [
  { port: 5173, label: "Vite", hint: "vite, sveltekit" },
  { port: 3000, label: "Next.js", hint: "next, express, rails" },
  { port: 4321, label: "Astro", hint: "astro" },
  { port: 6006, label: "Storybook", hint: "storybook" },
  { port: 8080, label: "Webpack", hint: "webpack, vue cli" },
  { port: 8000, label: "Django / FastAPI", hint: "django, fastapi" },
  { port: 5000, label: "Flask", hint: "flask" },
];

export type PreviewAddressBarHandle = {
  focus: () => void;
};

type Props = {
  url: string;
  onSubmit: (url: string) => void;
  onReload: () => void;
};

export const PreviewAddressBar = forwardRef<PreviewAddressBarHandle, Props>(
  function PreviewAddressBar({ url, onSubmit, onReload }, ref) {
    const [draft, setDraft] = useState(url);
    const inputRef = useRef<HTMLInputElement>(null);

    // Keep draft in sync when the parent updates the URL externally
    // (AI tool, detected localhost chip, etc.).
    useEffect(() => {
      setDraft(url);
    }, [url]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.select();
        },
      }),
      [],
    );

    const submit = () => {
      const next = normalizeUrl(draft);
      if (!next) return;
      if (next !== url) onSubmit(next);
      else onReload();
    };

    return (
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-card/40 px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onReload}
          title="Reload"
          className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ArrowReloadHorizontalIcon}
            size={14}
            strokeWidth={1.75}
          />
        </Button>
        <div className="relative flex min-w-0 flex-1 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Common dev-server ports"
                className="absolute top-1/2 left-1 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Globe02Icon}
                  size={13}
                  strokeWidth={1.75}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {PORT_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.port}
                  onSelect={() => {
                    const next = `http://localhost:${p.port}`;
                    setDraft(next);
                    onSubmit(next);
                  }}
                >
                  <span className="flex-1">{p.label}</span>
                  <span className="text-xs text-muted-foreground">
                    :{p.port}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Input
            ref={inputRef}
            value={draft}
            placeholder="http://localhost:3000"
            spellCheck={false}
            autoComplete="off"
            className="h-7 w-full bg-muted/60 pr-2 pl-7 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(url);
                inputRef.current?.blur();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            if (url) void openUrl(url).catch(console.error);
          }}
          title="Open in system browser"
          className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={!url}
        >
          <HugeiconsIcon
            icon={LinkSquare02Icon}
            size={14}
            strokeWidth={1.75}
          />
        </Button>
      </div>
    );
  },
);

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}
