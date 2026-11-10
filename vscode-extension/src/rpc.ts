/**
 * The webview's `invoke(cmd, args)` calls, routed to the Node ports of the
 * Terax backend commands. Only the commands listed here exist; anything else
 * is rejected.
 */
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import * as commands from "./commands";
import * as git from "./git";
import type { SessionTracker } from "./sessions";
import * as transcript from "./transcript";

export type RpcContext = {
  tracker: SessionTracker;
  leafId: number;
  state: vscode.Memento;
  downloads: string;
};

type Args = Record<string, unknown>;

const s = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string") throw new Error(`missing argument ${k}`);
  return v;
};
const n = (a: Args, k: string): number | null =>
  typeof a[k] === "number" ? (a[k] as number) : null;

/** Folders the review dialog may save into: workspace folders and Claude cwds. */
function writableRoots(ctx: RpcContext): string[] {
  return [
    ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    ...ctx.tracker.all().map((l) => l.cwd).filter((c): c is string => !!c),
  ];
}

/** A repo may be used when it holds an open workspace folder or a Claude cwd. */
function authority(ctx: RpcContext): git.RepoAuthority {
  return (root) => {
    const roots = [
      ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      ...ctx.tracker.all().map((l) => l.cwd).filter((c): c is string => !!c),
    ];
    return roots.some((r) => r === root || r.startsWith(root + path.sep) || root.startsWith(r + path.sep));
  };
}

const UNSUPPORTED = "unsupported";

export async function handleRpc(ctx: RpcContext, cmd: string, args: Args): Promise<unknown> {
  switch (cmd) {
    case "agent_transcript_open":
      return transcript.transcriptOpen(s(args, "sessionId"));
    case "agent_transcript_read":
      return transcript.transcriptRead(s(args, "sessionId"), n(args, "offset"), n(args, "before"));
    case "agent_transcript_find":
      return transcript.transcriptFind(
        s(args, "cwd"),
        n(args, "sinceMs") ?? 0,
        Array.isArray(args.exclude) ? args.exclude.filter((x): x is string => typeof x === "string") : [],
      );
    case "agent_transcript_image":
      return transcript.transcriptImage(
        s(args, "sessionId"),
        n(args, "offset") ?? 0,
        n(args, "index") ?? 0,
      );
    case "agent_transcript_list":
      return transcript.transcriptList(s(args, "cwd"), n(args, "limit") ?? undefined);
    case "agent_transcript_search":
      return transcript.transcriptSearch(s(args, "cwd"), s(args, "query"), n(args, "limit") ?? undefined);
    case "agent_transcript_prompts":
      return transcript.transcriptPrompts(s(args, "sessionId"));
    case "agent_save_pasted_image":
      return transcript.savePastedImage(s(args, "type"), Buffer.from(s(args, "bytes"), "base64"));
    case "agent_save_pasted_image_from_path":
      return transcript.savePastedImageFromPath(s(args, "path"));
    case "agent_save_context":
      return transcript.saveContext(s(args, "text"));
    case "agent_list_commands":
      return commands.listCommands(s(args, "cwd"));
    case "agent_hooks_status":
      return true;

    case "git_resolve_repo":
      return git.resolveRepo(s(args, "cwd"));
    case "git_context_diff":
      return git.contextDiff(s(args, "repoRoot"), s(args, "kind"), authority(ctx));
    case "git_head_file_changes":
      return git.headFileChanges(
        s(args, "repoRoot"),
        Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string") : [],
        authority(ctx),
      );
    case "git_file_versions":
      return git.fileVersions(s(args, "repoRoot"), s(args, "path"), authority(ctx));
    case "git_revert_file":
      return git.revertFile(s(args, "repoRoot"), s(args, "path"), args.deleteNew === true, authority(ctx));

    case "fs_stat":
      return commands.fsStat(s(args, "path"));
    case "fs_read_file":
      return commands.fsReadFile(s(args, "path"), args.force === true);
    case "fs_write_file":
      // Two writers: the Markdown export (Downloads only) and the file review.
      if (args.source === "review") {
        const file = s(args, "path");
        const roots = writableRoots(ctx);
        // Claude also edits files outside the open folders (a sibling repo):
        // those may be saved when this chat's transcript shows it edited them.
        const sessionId = typeof args.sessionId === "string" ? args.sessionId : null;
        if (sessionId && (await transcript.editedInSession(sessionId, file))) {
          roots.push(path.dirname(file));
        }
        return commands.fsWriteReviewed(file, s(args, "content"), roots);
      }
      return commands.fsWriteExport(s(args, "path"), s(args, "content"), ctx.downloads);
    case "fs_search":
      return commands.fsSearch(s(args, "root"), s(args, "query"), n(args, "limit") ?? 40);

    case "speech_permission_status":
    case "speech_request_permission":
      return { speech: UNSUPPORTED, microphone: UNSUPPORTED };
    case "speech_start":
      throw new Error(UNSUPPORTED);
    case "speech_stop":
    case "speech_open_settings":
      return null;
    case "app_start_dictation":
      return false;

    // ---- host actions (not Terax commands)
    case "host_terminal_tail":
      return ctx.tracker.tail(n(args, "leafId") ?? ctx.leafId, n(args, "lines") ?? 200);
    case "host_show_terminal": {
      ctx.tracker.byId(n(args, "leafId") ?? ctx.leafId)?.terminal.show(false);
      return null;
    }
    case "host_open_file": {
      const file = s(args, "path");
      const line = n(args, "line");
      const pos = line && line > 0 ? new vscode.Position(line - 1, 0) : undefined;
      await vscode.window.showTextDocument(vscode.Uri.file(file), {
        preview: false,
        viewColumn: vscode.ViewColumn.One,
        selection: pos ? new vscode.Range(pos, pos) : undefined,
      });
      return null;
    }
    case "host_open_url": {
      const url = s(args, "url");
      if (!/^(https?|mailto):/iu.test(url)) throw new Error("only web links open externally");
      return vscode.env.openExternal(vscode.Uri.parse(url));
    }
    case "host_reveal":
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(s(args, "path")));
      return null;
    case "host_launch": {
      const cwd = typeof args.cwd === "string" ? args.cwd : undefined;
      const terminal = vscode.window.createTerminal({ name: s(args, "title"), cwd });
      terminal.show(false);
      const command = s(args, "command");
      // Wait for shell integration so the run is tracked (Reader cards, status).
      const ready = await waitForShellIntegration(terminal, 4000);
      if (ready) ready.executeCommand(command);
      else terminal.sendText(command, true);
      return ctx.tracker.leafFor(terminal).leafId;
    }
    case "host_store_get":
      return ctx.state.get(`store:${s(args, "key")}`, null);
    case "host_store_set":
      await ctx.state.update(`store:${s(args, "key")}`, args.value ?? null);
      return null;
    case "host_paths":
      return { home: os.homedir(), downloads: ctx.downloads };
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | null> {
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(null);
    }, timeoutMs);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal !== terminal) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(e.shellIntegration);
    });
  });
}
