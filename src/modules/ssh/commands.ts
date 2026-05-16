import { invoke } from "@tauri-apps/api/core";
import type { SshProfile } from "./types";

export const sshProfileList = () =>
  invoke<SshProfile[]>("ssh_profile_list");

export const sshProfileSave = (profile: SshProfile) =>
  invoke<SshProfile>("ssh_profile_save", { profile });

export const sshProfileDelete = (id: string) =>
  invoke<void>("ssh_profile_delete", { id });

export const sshConnect = (profileId: string) =>
  invoke<void>("ssh_connect", { profileId });

export const sshDisconnect = (profileId: string) =>
  invoke<void>("ssh_disconnect", { profileId });

export const sshFingerprintGet = (profileId: string) =>
  invoke<string | null>("ssh_fingerprint_get", { profileId });

export const sshHome = (profileId: string) =>
  invoke<string>("ssh_home", { profileId });
