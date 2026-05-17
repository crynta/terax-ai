---
title: Stack
mapped_at: 2026-05-17
---

# STACK

## Resumo
- App desktop construída com `Tauri 2` + backend `Rust` + frontend `React 19`/`TypeScript`.
- Build frontend via `Vite 7` e tipagem com `TypeScript 5.8`.
- UI baseada em `Tailwind CSS v4`, componentes `Radix UI`/`shadcn`, `motion`, `xterm.js` e `CodeMirror 6`.
- Camada AI usa `Vercel AI SDK` (`ai`, `@ai-sdk/*`) com múltiplos provedores.

## Evidências Principais
- Dependências JS em `package.json`.
- Dependências Rust em `src-tauri/Cargo.toml`.
- Entradas de build em `vite.config.ts` e `src-tauri/tauri.conf.json`.
- Boot frontend em `src/main.tsx`.
- Boot backend em `src-tauri/src/lib.rs` e `src-tauri/src/main.rs`.

## Frontend
- `React 19.1` e `react-dom 19.1` em `package.json`.
- Alias `@/` e configuração Vite em `vite.config.ts`.
- Fonte e estilos globais carregados em `src/main.tsx` e `src/styles/globals.css`.
- Estado cliente com `zustand` em `src/modules/ai/store/*.ts`, `src/modules/settings/*.ts`.

## UI e Edição
- Terminal renderizado com `@xterm/xterm` e addons em `package.json` e `src/modules/terminal/*`.
- Editor com `@uiw/react-codemirror`, linguagens `@codemirror/lang-*`, merge/diff e Vim mode em `src/modules/editor/*`.
- Layout multi-painel com `react-resizable-panels` em `src/app/App.tsx`.
- Componentes utilitários em `src/components/ui/*`.

## AI e Modelos
- SDK principal: `ai` + `@ai-sdk/react`.
- Provedores suportados no frontend: `OpenAI`, `Anthropic`, `Google`, `xAI`, `Cerebras`, `Groq`, `DeepSeek`, `OpenRouter`, `OpenAI-compatible`, `LM Studio` em `src/modules/ai/config.ts`.
- Prompt de sistema e limites de steps em `src/modules/ai/config.ts`.
- Transporte e tools AI organizados em `src/modules/ai/lib/*` e `src/modules/ai/tools/*`.

## Backend Rust
- `tauri`, `portable-pty`, `reqwest`, `tokio`, `ignore`, `globset`, `grep-*`, `shared_child`, `serde` em `src-tauri/Cargo.toml`.
- Plugins Tauri ativos: `process`, `updater`, `window-state`, `autostart`, `store`, `os`, `log`, `opener` em `src-tauri/src/lib.rs`.
- Módulos backend: `fs`, `git`, `net`, `pty`, `secrets`, `shell`, `workspace` em `src-tauri/src/modules/mod.rs`.

## Configuração e Empacotamento
- `src-tauri/tauri.conf.json` define `beforeDevCommand`, `beforeBuildCommand`, `frontendDist` e CSP.
- Builds desktop para macOS, Linux e Windows com update artifacts em `src-tauri/tauri.conf.json`.
- Pipeline de release multi-plataforma em `.github/workflows/release.yml`.

## Ambientes e Pré-requisitos
- Node `20+` documentado em `README.md` e `CONTRIBUTING.md`.
- CI usa `Node 24` e `pnpm 10` em `.github/workflows/ci.yml`.
- Backend depende de toolchain Rust estável e bibliotecas WebKit/GTK no Linux em `.github/workflows/ci.yml`.

## Observações
- Há `node_modules/` e `src-tauri/target/` no workspace local, então qualquer tooling de scan precisa excluir artefatos gerados.
- O produto atual é desktop-first; não há evidência de app web standalone além do frontend empacotado pelo Tauri.
