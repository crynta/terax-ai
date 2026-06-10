/**
 * Pi SDK Webview Bridge — Environment shim
 *
 * Replaces process.env, process.cwd(), os.homedir(), etc.
 * Routes through Tauri IPC for real values.
 */
import { invoke } from "@tauri-apps/api/core";

let _cwd: string | null = null;

/** Map provider names to their env var names.
 * Keys use the EXACT provider string from getModel().provider (hyphens, not underscores).
 * Aligned with @earendil-works/pi-ai/dist/env-api-keys.js
 */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  // Direct API providers (sorted alphabetically)
  anthropic: "ANTHROPIC_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
  "cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  "github-copilot": "COPILOT_GITHUB_TOKEN",
  google: "GEMINI_API_KEY",
  "google-vertex": "GOOGLE_CLOUD_API_KEY",
  groq: "GROQ_API_KEY",
  huggingface: "HF_TOKEN",
  "kimi-coding": "KIMI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  mistral: "MISTRAL_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  "moonshotai-cn": "MOONSHOT_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
  together: "TOGETHER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  xai: "XAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  zai: "ZAI_API_KEY",

  // Complex auth providers — env key alone may not be sufficient
  "amazon-bedrock": "AWS_ACCESS_KEY_ID",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",

  // Providers not in SDK's native env map (added for compatibility)
  "openai-codex": "OPENAI_API_KEY",           // Codex uses subscription auth, env key is fallback
  perplexity: "PERPLEXITY_API_KEY",
  cohere: "CO_API_KEY",
  ai21: "AI21_API_KEY",
};

export const piEnv = {
  /** Get current working directory from Tauri */
  async cwd(): Promise<string> {
    if (!_cwd) {
      _cwd = await invoke<string>("workspace_current_dir");
    }
    return _cwd;
  },

  /** Invalidate cached CWD (e.g., after workspace change) */
  invalidateCwd() {
    _cwd = null;
  },

  /**
   * Resolve an API key for a provider.
   * Tries env vars via Tauri IPC, falls back to secrets store.
   */
  async getApiKeyForProvider(provider: string): Promise<string | undefined> {
    // Try env var first
    const envName = PROVIDER_ENV_KEYS[provider];
    if (envName) {
      const value = await invoke<string | null>("pi_env_api_key", { name: envName });
      if (value) return value;
    }

    // Fall back to secrets store
    try {
      return (await invoke<string | null>("secrets_get", {
        service: "terax-pi",
        account: `${provider}-api-key`,
      })) ?? undefined;
    } catch {
      return undefined;
    }
  },

  /** Get an API key from the OS keychain via Tauri secrets */
  async getApiKey(service: string, account: string): Promise<string | null> {
    try {
      return await invoke<string | null>("secrets_get", { service, account });
    } catch {
      return null;
    }
  },

  /** Store an API key in the OS keychain */
  async setApiKey(service: string, account: string, key: string): Promise<void> {
    await invoke("secrets_set", { service, account, password: key });
  },

  /** Platform detection */
  get platform(): "darwin" | "win32" | "linux" {
    const ua = navigator.platform.toLowerCase();
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("win")) return "win32";
    return "linux";
  },

  /** Temp dir path */
  get tmpdir(): string {
    // Cache resolved value
    return this.platform === "win32" ? "C:\\temp" : "/tmp";
  },

  /** Home dir — derived from CWD or env */
  get homeDir(): string {
    // Synchronous getter: derive from cached CWD if available,
    // otherwise fall back to standard macOS/Linux structure.
    if (_cwd) {
      const match = _cwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
      if (match) return match[1];
    }
    // Final fallback
    return "/Users/terax";
  },
};
