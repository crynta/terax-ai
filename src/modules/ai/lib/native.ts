import { invoke } from "@tauri-apps/api/core";

export type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

export type GrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

export type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

export type GlobHit = { path: string; rel: string };
export type GlobResponse = { hits: GlobHit[]; truncated: boolean };

export type HacktricksSearchResult = {
  results: { file: string; title: string; excerpt: string; line: number; score: number }[];
};

export type SshExecResult = { stdout: string; stderr: string; exit_code: number };
export type FileTransferResult = { ok: boolean; bytes_written: number };
export type FtpConnectResult = { handle: number; banner: string };
export type FtpEntry = { name: string; size: number; kind: string };
export type FtpListResult = { entries: FtpEntry[] };
export type FtpTransferResult = { ok: boolean; bytes: number };
export type SmbListResult = { entries: { name: string; kind: string; size: number }[]; shares?: string[] };
export type SmbTransferResult = { ok: boolean; bytes: number };
export type HttpResponse = { status: number; headers: Record<string, string>; body: string; elapsed_ms: number };
export type FuzzHit = { word: string; status: number; length: number; elapsed_ms: number };
export type FuzzResult = { hits: FuzzHit[]; total_tested: number };

export const native = {
  readFile: (path: string) => invoke<ReadResult>("fs_read_file", { path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("fs_write_file", { path, content }),
  createFile: (path: string) => invoke<void>("fs_create_file", { path }),
  createDir: (path: string) => invoke<void>("fs_create_dir", { path }),
  readDir: (path: string) => invoke<DirEntry[]>("fs_read_dir", { path }),
  grep: (params: {
    pattern: string;
    root: string;
    glob?: string[];
    caseInsensitive?: boolean;
    maxResults?: number;
  }) =>
    invoke<GrepResponse>("fs_grep", {
      pattern: params.pattern,
      root: params.root,
      glob: params.glob ?? null,
      caseInsensitive: params.caseInsensitive ?? null,
      maxResults: params.maxResults ?? null,
    }),
  glob: (params: { pattern: string; root: string; maxResults?: number }) =>
    invoke<GlobResponse>("fs_glob", {
      pattern: params.pattern,
      root: params.root,
      maxResults: params.maxResults ?? null,
    }),
  runCommand: (
    command: string,
    cwd?: string | null,
    timeoutSecs?: number,
  ) =>
    invoke<CommandOutput>("shell_run_command", {
      command,
      cwd: cwd ?? null,
      timeoutSecs: timeoutSecs ?? null,
    }),

  shellSessionOpen: (cwd?: string | null) =>
    invoke<number>("shell_session_open", { cwd: cwd ?? null }),
  shellSessionRun: (
    id: number,
    command: string,
    cwd?: string | null,
    timeoutSecs?: number,
  ) =>
    invoke<{
      stdout: string;
      stderr: string;
      exit_code: number | null;
      timed_out: boolean;
      truncated: boolean;
      cwd_after: string;
    }>("shell_session_run", {
      id,
      command,
      cwd: cwd ?? null,
      timeoutSecs: timeoutSecs ?? null,
    }),
  shellSessionClose: (id: number) =>
    invoke<void>("shell_session_close", { id }),
  shellBgSpawn: (command: string, cwd?: string | null) =>
    invoke<number>("shell_bg_spawn", { command, cwd: cwd ?? null }),
  shellBgLogs: (handle: number, sinceOffset?: number) =>
    invoke<{
      bytes: string;
      next_offset: number;
      dropped: number;
      exited: boolean;
      exit_code: number | null;
    }>("shell_bg_logs", { handle, sinceOffset: sinceOffset ?? null }),
  shellBgKill: (handle: number) => invoke<void>("shell_bg_kill", { handle }),
  shellBgList: () =>
    invoke<
      {
        handle: number;
        command: string;
        cwd: string | null;
        started_at_ms: number;
        exited: boolean;
        exit_code: number | null;
      }[]
    >("shell_bg_list"),

  // HackTricks
  hacktricksSearch: (query: string, maxResults?: number) =>
    invoke<HacktricksSearchResult>("hacktricks_search", { query, maxResults: maxResults ?? null }),
  hacktricksIndex: () => invoke<{ ok: boolean; files_indexed: number }>("hacktricks_index"),

  // SSH
  sshExec: (host: string, port: number | null, user: string, password: string | null, keyPath: string | null, command: string) =>
    invoke<SshExecResult>("ssh_exec", { host, port, user, password, key_path: keyPath, command }),
  sshUpload: (host: string, port: number | null, user: string, password: string | null, keyPath: string | null, localPath: string, remotePath: string) =>
    invoke<FileTransferResult>("ssh_upload", { host, port, user, password, key_path: keyPath, local_path: localPath, remote_path: remotePath }),
  sshDownload: (host: string, port: number | null, user: string, password: string | null, keyPath: string | null, remotePath: string, localPath: string) =>
    invoke<FileTransferResult>("ssh_download", { host, port, user, password, key_path: keyPath, remote_path: remotePath, local_path: localPath }),

  // FTP
  ftpConnect: (host: string, port: number | null, user: string | null, password: string | null) =>
    invoke<FtpConnectResult>("ftp_connect", { host, port, user, password }),
  ftpList: (handle: number, path: string | null) =>
    invoke<FtpListResult>("ftp_list", { handle, path }),
  ftpGet: (handle: number, remotePath: string, localPath: string) =>
    invoke<FtpTransferResult>("ftp_get", { handle, remote_path: remotePath, local_path: localPath }),
  ftpPut: (handle: number, localPath: string, remotePath: string) =>
    invoke<FtpTransferResult>("ftp_put", { handle, local_path: localPath, remote_path: remotePath }),
  ftpDisconnect: (handle: number) =>
    invoke<boolean>("ftp_disconnect", { handle }),

  // SMB
  smbList: (host: string, share: string | null, user: string | null, password: string | null, domain: string | null) =>
    invoke<SmbListResult>("smb_list", { host, share, user, password, domain }),
  smbGet: (host: string, share: string, remotePath: string, localPath: string, user: string | null, password: string | null, domain: string | null) =>
    invoke<SmbTransferResult>("smb_get", { host, share, remote_path: remotePath, local_path: localPath, user, password, domain }),
  smbPut: (host: string, share: string, remotePath: string, localPath: string, user: string | null, password: string | null, domain: string | null) =>
    invoke<SmbTransferResult>("smb_put", { host, share, remote_path: remotePath, local_path: localPath, user, password, domain }),

  // HTTP
  httpRequest: (method: string, url: string, headers: Record<string, string> | null, body: string | null, followRedirects: boolean | null) =>
    invoke<HttpResponse>("http_request", { method, url, headers, body, follow_redirects: followRedirects }),
  httpFuzz: (url: string, wordlistPath: string, method: string | null, headers: Record<string, string> | null, matchCodes: number[] | null, filterCodes: number[] | null, threads: number | null) =>
    invoke<FuzzResult>("http_fuzz", { url, wordlist_path: wordlistPath, method, headers, match_codes: matchCodes, filter_codes: filterCodes, threads }),
};
