import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

export function buildProtocolTools(_ctx: ToolContext) {
  return {
    // SSH tools
    ssh_exec: tool({
      description: "Execute a command on a remote host over SSH",
      inputSchema: z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string(),
        password: z.string().optional(),
        key_path: z.string().optional(),
        command: z.string(),
      }),
      execute: async ({ host, port, user, password, key_path, command }) => {
        return native.sshExec(host, port ?? null, user, password ?? null, key_path ?? null, command);
      },
    }),

    ssh_upload: tool({
      description: "Upload a file to a remote host via SCP",
      inputSchema: z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string(),
        password: z.string().optional(),
        key_path: z.string().optional(),
        local_path: z.string(),
        remote_path: z.string(),
      }),
      execute: async ({ host, port, user, password, key_path, local_path, remote_path }) => {
        return native.sshUpload(host, port ?? null, user, password ?? null, key_path ?? null, local_path, remote_path);
      },
    }),

    ssh_download: tool({
      description: "Download a file from a remote host via SCP",
      inputSchema: z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string(),
        password: z.string().optional(),
        key_path: z.string().optional(),
        remote_path: z.string(),
        local_path: z.string(),
      }),
      execute: async ({ host, port, user, password, key_path, remote_path, local_path }) => {
        return native.sshDownload(host, port ?? null, user, password ?? null, key_path ?? null, remote_path, local_path);
      },
    }),

    // FTP tools
    ftp_connect: tool({
      description: "Connect to an FTP server",
      inputSchema: z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string().optional(),
        password: z.string().optional(),
      }),
      execute: async ({ host, port, user, password }) => {
        return native.ftpConnect(host, port ?? null, user ?? null, password ?? null);
      },
    }),

    ftp_list: tool({
      description: "List directory contents on FTP server",
      inputSchema: z.object({
        handle: z.number().int(),
        path: z.string().optional(),
      }),
      execute: async ({ handle, path }) => {
        return native.ftpList(handle, path ?? null);
      },
    }),

    ftp_get: tool({
      description: "Download a file from FTP server",
      inputSchema: z.object({
        handle: z.number().int(),
        remote_path: z.string(),
        local_path: z.string(),
      }),
      execute: async ({ handle, remote_path, local_path }) => {
        return native.ftpGet(handle, remote_path, local_path);
      },
    }),

    ftp_put: tool({
      description: "Upload a file to FTP server",
      inputSchema: z.object({
        handle: z.number().int(),
        local_path: z.string(),
        remote_path: z.string(),
      }),
      execute: async ({ handle, local_path, remote_path }) => {
        return native.ftpPut(handle, local_path, remote_path);
      },
    }),

    ftp_disconnect: tool({
      description: "Disconnect from FTP server",
      inputSchema: z.object({
        handle: z.number().int(),
      }),
      execute: async ({ handle }) => {
        return native.ftpDisconnect(handle);
      },
    }),

    // SMB tools
    smb_list: tool({
      description: "List SMB shares or directory contents",
      inputSchema: z.object({
        host: z.string(),
        share: z.string().optional(),
        user: z.string().optional(),
        password: z.string().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ host, share, user, password, domain }) => {
        return native.smbList(host, share ?? null, user ?? null, password ?? null, domain ?? null);
      },
    }),

    smb_get: tool({
      description: "Download a file from SMB share",
      inputSchema: z.object({
        host: z.string(),
        share: z.string(),
        remote_path: z.string(),
        local_path: z.string(),
        user: z.string().optional(),
        password: z.string().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ host, share, remote_path, local_path, user, password, domain }) => {
        return native.smbGet(host, share, remote_path, local_path, user ?? null, password ?? null, domain ?? null);
      },
    }),

    smb_put: tool({
      description: "Upload a file to SMB share",
      inputSchema: z.object({
        host: z.string(),
        share: z.string(),
        remote_path: z.string(),
        local_path: z.string(),
        user: z.string().optional(),
        password: z.string().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ host, share, remote_path, local_path, user, password, domain }) => {
        return native.smbPut(host, share, remote_path, local_path, user ?? null, password ?? null, domain ?? null);
      },
    }),

    // HTTP tools
    http_request: tool({
      description: "Make a raw HTTP request",
      inputSchema: z.object({
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        follow_redirects: z.boolean().optional(),
      }),
      execute: async ({ method, url, headers, body, follow_redirects }) => {
        return native.httpRequest(method, url, headers ?? null, body ?? null, follow_redirects ?? null);
      },
    }),

    http_fuzz: tool({
      description: "Fuzz a URL using a wordlist. Use FUZZ as the payload marker in the URL.",
      inputSchema: z.object({
        url: z.string(),
        wordlist: z.string(),
        method: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        match_codes: z.array(z.number()).optional(),
        filter_codes: z.array(z.number()).optional(),
        threads: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ url, wordlist, method, headers, match_codes, filter_codes, threads }) => {
        return native.httpFuzz(url, wordlist, method ?? null, headers ?? null, match_codes ?? null, filter_codes ?? null, threads ?? null);
      },
    }),
  } as const;
}