import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "@/modules/ai/config";

const SSH_PASSWORD_PREFIX = "ssh-password";

function accountFor(profileId: string): string {
  return `${SSH_PASSWORD_PREFIX}:${profileId}`;
}

export async function getSshPassword(
  profileId: string,
): Promise<string | null> {
  try {
    const value = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: accountFor(profileId),
    });
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function setSshPassword(
  profileId: string,
  password: string,
): Promise<void> {
  if (password.length === 0) return;
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: accountFor(profileId),
    password,
  });
}

export async function clearSshPassword(profileId: string): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: accountFor(profileId),
    });
  } catch {
    // already absent
  }
}
