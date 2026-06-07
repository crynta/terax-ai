import ArrowReloadHorizontalIcon from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { statusBorderSurfaceClass } from "@/lib/statusTone";
import { cn } from "@/lib/utils";

type PortPreset = {
  port: number;
  label: string;
  hint: string;
};

// Curated dev-server ports. Ordered by frontend frequency, then backend.
const PORT_PRESETS: readonly PortPreset[] = [
  { port: 5173, label: "Vite", hint: "vite, sveltekit" },
  { port: 5174, label: "Vite (alt)", hint: "second vite instance" },
  { port: 3000, label: "Next.js", hint: "next, express, rails" },
  { port: 3001, label: "Next.js (alt)", hint: "second next instance" },
  { port: 4173, label: "Vite preview", hint: "vite preview" },
  { port: 4200, label: "Angular", hint: "angular cli" },
  { port: 4321, label: "Astro", hint: "astro" },
  { port: 5500, label: "Live Server", hint: "vscode live server" },
  { port: 6006, label: "Storybook", hint: "storybook" },
  { port: 8080, label: "Webpack", hint: "webpack, vue cli" },
  { port: 8081, label: "Metro", hint: "react native metro" },
  { port: 8000, label: "Django / FastAPI", hint: "django, fastapi" },
  { port: 8888, label: "Jupyter", hint: "jupyter notebook" },
  { port: 5000, label: "Flask", hint: "flask" },
  { port: 7860, label: "Gradio", hint: "gradio" },
  { port: 11434, label: "Ollama", hint: "ollama api" },
];

export type PreviewAddressBarHandle = {
  focus: () => void;
};

type Props = {
  url: string;
  onSubmit: (url: string) => void;
  onReload: () => void;
  ref?: Ref<PreviewAddressBarHandle>;
};

export function PreviewAddressBar({ url, onSubmit, onReload, ref }: Props) {
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

  const [notice, setNotice] = useState<string | null>(null);
  const [checkingPort, setCheckingPort] = useState<number | null>(null);

  const submit = () => {
    const next = normalizeUrl(draft);
    if (!next) {
      setNotice("Enter a URL or pick a port preset.");
      return;
    }
    setNotice(null);
    if (next !== url) onSubmit(next);
    else onReload();
  };

  const tryPort = async (port: number) => {
    setNotice(null);
    setCheckingPort(port);
    const url = `http://localhost:${port}`;
    const ok = await probeUrl(url);
    setCheckingPort(null);
    if (!ok) {
      setNotice(`No server listening on :${port}.`);
      return;
    }
    setDraft(url);
    onSubmit(url);
  };

  return (
    <div className="shrink-0 border-b border-border/60">
      <div className="flex h-9 items-center gap-1 bg-card/40 px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onReload}
          aria-label="Reload preview"
          title="Reload"
          className="size-8 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={ArrowReloadHorizontalIcon}
            strokeWidth={1.75}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Common dev-server ports"
              title="Common dev-server ports"
              className="h-8 shrink-0 gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                data-icon="inline-start"
                icon={Globe02Icon}
                strokeWidth={1.75}
              />
              <span className="hidden sm:inline">Ports</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-80 min-w-56 overflow-y-auto"
          >
            <DropdownMenuGroup>
              {PORT_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.port}
                  onSelect={(e) => {
                    e.preventDefault();
                    void tryPort(p.port);
                  }}
                >
                  <span className="flex-1">{p.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {checkingPort === p.port ? "checking…" : `:${p.port}`}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex min-w-0 flex-1 items-center">
          <Input
            ref={inputRef}
            value={draft}
            placeholder="http://localhost:3000"
            aria-label="Preview URL"
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-full bg-muted/60 px-2 text-xs placeholder:text-muted-foreground focus-visible:ring-0"
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
          aria-label="Open preview in system browser"
          title="Open in system browser"
          className="size-8 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={!url}
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={LinkSquare02Icon}
            strokeWidth={1.75}
          />
        </Button>
      </div>
      {notice ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 text-[11px]",
            statusBorderSurfaceClass("warning"),
          )}
        >
          <span className="truncate">{notice}</span>
          <button
            type="button"
            aria-label="Dismiss preview notice"
            onClick={() => setNotice(null)}
            className="ml-auto min-h-6 rounded px-1.5 text-[10px] opacity-80 hover:bg-accent hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(900),
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed))
    return `http://${trimmed}`;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}
