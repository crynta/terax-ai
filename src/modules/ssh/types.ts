export type AuthMethod = "key" | "agent";

export type SshProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: AuthMethod;
  keyPath?: string;
  knownFingerprint?: string;
};
