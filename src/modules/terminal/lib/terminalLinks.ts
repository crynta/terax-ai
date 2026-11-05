import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { hostname } from "@tauri-apps/plugin-os";
import { toast } from "sonner";
import { openExternalUrl } from "@/lib/external-link";
import {
  isLocalFileHost,
  type LinkConfirmReason,
  type LinkPlan,
  pathCandidates,
  planLinkActivation,
  resolveLinkPath,
} from "@/modules/terminal/ghostty/core/terminalLinkTargets";
import type { TerminalLinkHit } from "@/modules/terminal/ghostty/core/terminalLinks";
import { getLspNavigator } from "@/modules/lsp/lib/navigator";
import { currentWorkspaceEnv, getWslHome } from "@/modules/workspace";

export type LinkActivationContext = {
  /** The pane's last reported working directory, canonical form. */
  readonly cwd: string | null;
  readonly focus: () => void;
};

type StatKind = "file" | "dir" | "symlink";

export type LinkActivationDeps = {
  openUrl(url: string, focus: () => void): Promise<void>;
  stat(path: string): Promise<StatKind | null>;
  canonicalize(path: string): Promise<string | null>;
  home(): Promise<string | null>;
  hostname(): Promise<string | null>;
  openInEditor(path: string, line: number): void;
  reveal(path: string): Promise<void>;
  inform(title: string, description?: string): void;
  confirm(prompt: {
    title: string;
    description: string;
    onConfirm: () => void;
  }): void;
};

const CONFIRM_REASONS: Record<LinkConfirmReason, string> = {
  userinfo: "This link carries a username or password.",
  punycode: "This link uses an international domain name.",
  mismatch: "The text shown for this link is not its address.",
  scheme: "This opens another app.",
};

/** Cmd/Ctrl-click on a terminal link: open it, or say why it was not opened. */
export async function activateTerminalLink(
  hit: TerminalLinkHit,
  context: LinkActivationContext,
  deps: LinkActivationDeps = defaultDeps,
): Promise<void> {
  const plan = planLinkActivation(hit);
  try {
    await runPlan(plan, context, deps);
  } catch (error) {
    console.error("[terax] terminal link failed:", error);
    context.focus();
  }
}

async function runPlan(
  plan: LinkPlan,
  context: LinkActivationContext,
  deps: LinkActivationDeps,
): Promise<void> {
  switch (plan.type) {
    case "open-url":
      await deps.openUrl(plan.url, context.focus);
      return;
    case "confirm-url":
      deps.confirm({
        title: `Open ${plan.destination}?`,
        description: `${CONFIRM_REASONS[plan.reason]} ${truncate(plan.url)}`,
        onConfirm: () => void deps.openUrl(plan.url, context.focus),
      });
      return;
    case "block":
      deps.inform(
        plan.scheme ? `Blocked ${plan.scheme}: link` : "Blocked link",
        plan.reason === "length" ? "The address is too long." : undefined,
      );
      return;
    case "file-uri": {
      const local = isLocalFileHost(
        plan.host,
        plan.host ? await deps.hostname() : null,
      );
      if (!local) {
        deps.inform("Remote file link ignored", plan.host);
        return;
      }
      await openLocalPath([plan.path], undefined, deps);
      return;
    }
    case "path": {
      const home = plan.path.startsWith("~") ? await deps.home() : null;
      const candidates = pathCandidates(plan.path)
        .map((candidate) =>
          resolveLinkPath(candidate, { cwd: context.cwd, home }),
        )
        .filter((candidate): candidate is string => candidate !== null);
      if (candidates.length === 0) return;
      const opened = await openLocalPath(candidates, plan.line, deps);
      if (!opened) deps.inform("File not found", truncate(plan.path));
      return;
    }
  }
}

async function openLocalPath(
  candidates: readonly string[],
  line: number | undefined,
  deps: LinkActivationDeps,
): Promise<boolean> {
  for (const candidate of candidates) {
    const target = await existingTarget(candidate, deps);
    if (!target) continue;
    if (target.kind === "dir") await deps.reveal(target.path);
    else deps.openInEditor(target.path, line ?? 1);
    return true;
  }
  return false;
}

async function existingTarget(
  path: string,
  deps: LinkActivationDeps,
): Promise<{ path: string; kind: "file" | "dir" } | null> {
  const kind = await deps.stat(path);
  if (kind === null) return null;
  if (kind !== "symlink") return { path, kind };
  const canonical = await deps.canonicalize(path);
  const resolved = canonical ? await deps.stat(canonical) : null;
  return { path, kind: resolved === "dir" ? "dir" : "file" };
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

const defaultDeps: LinkActivationDeps = {
  openUrl: (url, focus) => openExternalUrl(url, focus),
  stat: async (path) => {
    const stat = await invoke<{ kind: StatKind }>("fs_stat", {
      path,
      workspace: currentWorkspaceEnv(),
    }).catch(() => null);
    return stat?.kind ?? null;
  },
  canonicalize: (path) =>
    invoke<string>("fs_canonicalize", {
      path,
      workspace: currentWorkspaceEnv(),
    }).catch(() => null),
  home: async () => {
    const env = currentWorkspaceEnv();
    try {
      return env.kind === "wsl" ? await getWslHome(env.distro) : await homeDir();
    } catch {
      return null;
    }
  },
  hostname: () => hostname().catch(() => null),
  openInEditor: (path, line) => getLspNavigator()?.openFile(path, line),
  reveal: async (path) => {
    if (currentWorkspaceEnv().kind !== "local") return;
    await revealItemInDir(
      /^[A-Za-z]:/.test(path) ? path.replace(/\//g, "\\") : path,
    );
  },
  inform: (title, description) => toast(title, { description }),
  confirm: ({ title, description, onConfirm }) =>
    toast(title, {
      description,
      duration: 15_000,
      action: { label: "Open", onClick: onConfirm },
    }),
};
