---
title: Integrations
mapped_at: 2026-05-17
---

# INTEGRATIONS

## Resumo
- Integrações centrais são AI providers, sistema operacional/PTY, Git local, keychain/credenciais, updater GitHub Releases e servidores OpenAI-compatible locais/remotos.

## AI Providers
- Catálogo de provedores/modelos em `src/modules/ai/config.ts`.
- Chaves e contas por provedor em `src/modules/ai/config.ts` e `src/modules/ai/lib/keyring.ts`.
- Providers remotos suportados:
  - `OpenAI`
  - `Anthropic`
  - `Google`
  - `xAI`
  - `Cerebras`
  - `Groq`
  - `DeepSeek`
  - `OpenRouter`
- Providers locais/custom:
  - `LM Studio`
  - `OpenAI Compatible`

## Proxy HTTP para AI
- Backend expõe `lm_ping`, `ai_http_request` e `ai_http_stream` em `src-tauri/src/modules/net.rs`.
- Objetivo: contornar CORS/Mixed Content/PNA no WebView.
- `allow_private_network` existe para endpoints locais.
- Há política de host com bloqueio de metadata/cloud e de parte de endereços privados/loopback em `src-tauri/src/modules/net.rs`.

## Armazenamento de Segredos
- macOS usa Keychain e Windows usa Credential Manager via `keyring` em `src-tauri/src/modules/secrets.rs`.
- Linux faz fallback para arquivo `secrets.json` em app local data dir com permissão `0600` em `src-tauri/src/modules/secrets.rs`.
- Frontend acessa segredos por IPC em `src/modules/ai/lib/keyring.ts`.

## Integração com Sistema Operacional
- Janela/settings via APIs Tauri em `src/main.tsx`, `src/modules/settings/openSettingsWindow.ts`, `src-tauri/src/lib.rs`.
- Plugins Tauri:
  - `tauri-plugin-process`
  - `tauri-plugin-updater`
  - `tauri-plugin-window-state`
  - `tauri-plugin-autostart`
  - `tauri-plugin-store`
  - `tauri-plugin-os`
  - `tauri-plugin-log`
  - `tauri-plugin-opener`

## PTY e Shell
- Sessões pseudo-terminal via `portable-pty` em `src-tauri/src/modules/pty/*`.
- Shell commands síncronos, sessões e background jobs em `src-tauri/src/modules/shell/*`.
- Scripts de inicialização por shell em `src-tauri/src/modules/pty/scripts/*`.

## Git Local
- Integração Git inteira é local, sem API SaaS obrigatória.
- Comandos expostos por IPC em `src-tauri/src/modules/git/commands.rs`.
- Frontend usa `native.git*` em `src/modules/ai/lib/native.ts` e `src/modules/source-control/useSourceControl.ts`.
- URL remota é lida por `git_remote_url`; não há integração direta com GitHub API.

## Workspace e WSL
- Workspace roots autorizados em `src-tauri/src/modules/workspace.rs`.
- Suporte WSL no Windows com `wsl.exe`, resolução de distro e UNC path em `src-tauri/src/modules/workspace.rs`.
- Frontend troca de ambiente via `src/modules/workspace/*` e `src/app/App.tsx`.

## Atualização e Distribuição
- Updater configurado para `https://github.com/crynta/terax-ai/releases/latest/download/latest.json` em `src-tauri/tauri.conf.json`.
- Release pipeline assina bundles e publica draft releases em `.github/workflows/release.yml`.

## Observações
- Não há banco de dados relacional ou serviço backend próprio persistente.
- Não há webhook server próprio detectado.
- A maior superfície de integração externa está concentrada em AI HTTP proxy, update feed e Git remotes.
