---
title: Architecture
mapped_at: 2026-05-17
---

# ARCHITECTURE

## Padrão Geral
- Arquitetura de app desktop híbrido:
  - frontend SPA React para UI interativa
  - backend Rust/Tauri para IO privilegiado
  - fronteira entre ambos feita por `invoke` commands e canais Tauri

## Entradas
- Frontend principal em `src/main.tsx`.
- Componente-raiz em `src/app/App.tsx`.
- Backend binário em `src-tauri/src/main.rs`.
- Configuração de janela, bundle e segurança em `src-tauri/tauri.conf.json`.

## Orquestração da UI
- `src/app/App.tsx` concentra shell principal, tabs, panes, sidebar, status bar, AI panel e janelas auxiliares.
- O app alterna superfícies por tipo de aba:
  - terminal
  - editor
  - preview
  - ai-diff
  - git-diff
  - git-history
- O layout usa painéis redimensionáveis e refs imperativas para coordenar foco, split e reload.

## Boundary Frontend/Backend
- Tipos e wrappers de IPC centralizados em `src/modules/ai/lib/native.ts`.
- Comandos backend registrados em `src-tauri/src/lib.rs`.
- A regra prática é:
  - UI, estado e composição no TS/React
  - filesystem, shell, PTY, git, secrets, networking privilegiado no Rust

## Camadas Frontend
- `src/components/*`: blocos de UI genéricos e ai-elements.
- `src/modules/*`: features verticais por domínio.
- `src/lib/*`: helpers compartilhados leves.
- `src/settings/*`: segunda superfície React para a janela de settings.
- Stores `zustand` por domínio em `src/modules/ai/store/*` e `src/modules/settings/*`.

## Domínios Principais
- `src/modules/terminal/*`: panes de terminal, sessão e renderer.
- `src/modules/editor/*`: editor CodeMirror, diff AI, diff Git e autocomplete.
- `src/modules/explorer/*`: árvore de arquivos, busca, rename/create/delete.
- `src/modules/ai/*`: chat, agentes, tools, snippets, planos, approvals.
- `src/modules/source-control/*`: status Git, ações de stage/push/pull/fetch.
- `src/modules/git-history/*`: histórico, grafo e diffs por commit.
- `src/modules/preview/*`: web preview embutido.

## Backend Rust
- `fs`: leitura, escrita, mutação, grep, glob, search, tree.
- `git`: resolve repo, status, diff, commit, log, push/pull/fetch.
- `net`: proxy HTTP/streaming para AI e ping de endpoint local.
- `pty`: sessões terminal, resize, write, close e init de shell.
- `shell`: execução de comandos one-shot, sessões e processos em background.
- `secrets`: abstração cross-platform para chaves.
- `workspace`: autorização de roots e suporte WSL.

## Fluxos de Dados Importantes
- AI chat:
  - UI em `src/modules/ai/components/*`
  - estado em `src/modules/ai/store/chatStore.ts`
  - transporte em `src/modules/ai/lib/transport.ts`
  - tools em `src/modules/ai/tools/*`
  - proxy HTTP via `src-tauri/src/modules/net.rs`
- File editing:
  - explorer/editor chama `native.*`
  - Rust valida workspace/path
  - resposta volta para atualizar store/UI
- Source control:
  - `useSourceControl` resolve repo/status
  - ações disparam `native.git*`
  - tabs de diff/histórico renderizam resultado

## Decisões Arquiteturais Visíveis
- Preferência por módulos verticais em vez de camadas puras MVC.
- Uso pesado de handles imperativos e refs para terminal/editor, provavelmente por necessidades de foco e integrações com libs stateful.
- Segurança defensiva distribuída entre frontend (`security.ts`) e backend (`workspace.rs`, `net.rs`, `secrets.rs`).

## Pontos de Acoplamento
- `src/app/App.tsx` é o maior hub de coordenação.
- `src/modules/ai/lib/native.ts` concentra quase toda a API de backend visível ao frontend.
- `src-tauri/src/lib.rs` é o registro central de comandos/plugin wiring.
