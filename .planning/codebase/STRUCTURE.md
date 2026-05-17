---
title: Structure
mapped_at: 2026-05-17
---

# STRUCTURE

## Raiz do Repositório
- `src/`: frontend principal React/Tauri.
- `src-tauri/`: backend Rust, config Tauri, ícones e build native.
- `docs/`: imagens de produto/README.
- `.github/workflows/`: CI e release.
- `.codex/`: skills e workflows locais do agente.
- `.planning/`: artefatos de planejamento/documentação operacional.

## Frontend `src/`
- `app/`: composição principal da aplicação (`src/app/App.tsx`).
- `components/ui/`: biblioteca base de componentes.
- `components/ai-elements/`: renderização rica de mensagens/código/raciocínio/tool output.
- `lib/`: helpers transversais (`utils`, `platform`, `useZoom`, `use-mobile`).
- `modules/`: features por domínio.
- `settings/`: entrypoint e seções da janela de configurações.
- `styles/`: CSS global, tokens, fontes e tema de terminal.

## Módulos Frontend Relevantes
- `src/modules/ai/`
  - `components/`: chat, input bar, mini-window, approvals, file/snippet picker
  - `hooks/`: gravação Whisper, workspace files
  - `lib/`: transporte, keyring, segurança, sessões, snippets, todos
  - `store/`: chat, agentes, plano, snippets, todos
  - `tools/`: context, fs, shell, terminal, subagent, edit, todo, search
- `src/modules/editor/`
  - stacks/panes
  - `lib/autocomplete/*`
  - integração diff AI/Git
- `src/modules/terminal/`
  - pane tree, pty bridge, renderer pool, OSC handlers
- `src/modules/explorer/`
  - árvore, busca, ações de contexto
- `src/modules/source-control/`
  - painel e hook de status remoto/local

## Backend `src-tauri/src/`
- `lib.rs`: plugins, state global e `invoke_handler`.
- `main.rs`: bootstrap mínimo.
- `modules/mod.rs`: exporta submódulos.
- `modules/fs/`: IO de arquivos, árvore, grep, glob, search.
- `modules/git/`: operações, parser, process runner, tipos.
- `modules/pty/`: sessão pseudo-terminal e shell init scripts.
- `modules/shell/`: exec avulso, sessões persistentes e background ringbuffer.
- `modules/net.rs`: proxy HTTP/streaming com guardrails.
- `modules/secrets.rs`: key storage cross-platform.
- `modules/workspace.rs`: autorização de roots e suporte WSL.

## Configs e Arquivos-Chave
- `package.json`: scripts/deps frontend.
- `vite.config.ts`: build/alias frontend.
- `components.json`: config shadcn.
- `tsconfig.json` e `tsconfig.node.json`: TS config.
- `src-tauri/Cargo.toml`: deps Rust.
- `src-tauri/tauri.conf.json`: janela, bundle, CSP, updater.
- `src-tauri/capabilities/*.json`: capabilities Tauri.

## Convenções de Organização
- Features grandes ficam em `src/modules/<feature>/`.
- Arquivos `index.ts` reexportam APIs de módulo.
- Helpers de módulo vivem em `lib/` interno da feature.
- Stores `zustand` são separadas por área de responsabilidade.
- No Rust, domínios pequenos usam arquivo único (`net.rs`, `workspace.rs`, `secrets.rs`); domínios maiores usam pasta (`fs`, `git`, `pty`, `shell`).

## Artefatos Gerados / Não-Fonte
- `node_modules/` e `src-tauri/target/` existem no workspace e não devem ser usados como fonte de verdade arquitetural.
- `src-tauri/gen/schemas/*` são gerados.
- `docs/*.png` são assets de documentação.

## Navegação Rápida
- Quer o shell principal da UI: `src/app/App.tsx`.
- Quer a API frontend->backend: `src/modules/ai/lib/native.ts`.
- Quer os comandos Tauri expostos: `src-tauri/src/lib.rs`.
- Quer fluxo AI: `src/modules/ai/`.
- Quer PTY/shell native: `src-tauri/src/modules/pty/*` e `src-tauri/src/modules/shell/*`.
