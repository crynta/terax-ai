---
title: Conventions
mapped_at: 2026-05-17
---

# CONVENTIONS

## Estilo Geral
- TypeScript com tipagem explícita em boundaries importantes.
- React funcional com hooks; sem classes.
- Rust organizado por comandos Tauri e módulos por domínio.
- Comentários existem quando explicam risco, ordem de execução ou comportamento de plataforma, não como ruído.

## Convenções Frontend
- Alias de import `@/` usado amplamente, por exemplo em `src/app/App.tsx`.
- Componentes React em `PascalCase.tsx`.
- Hooks em `camelCase` com prefixo `use`, por exemplo `useSourceControl.ts`.
- Helpers/utilitários em `camelCase.ts`.
- Reexports por `index.ts` em módulos como `src/modules/ai/index.ts`.

## Gestão de Estado
- `zustand` é o padrão para estado global/local persistente.
- Stores são pequenas e separadas por domínio:
  - `chatStore`
  - `agentsStore`
  - `planStore`
  - `snippetsStore`
  - `todoStore`
- Persistência e hidratação são tratadas dentro das stores ou libs associadas, como `src/modules/ai/lib/sessions.ts`.

## IPC e Tipos
- O frontend não invoca comandos Tauri espalhados pela base; a convenção dominante é encapsular chamadas em `src/modules/ai/lib/native.ts`.
- Tipos de payload/resposta também ficam perto desse wrapper.
- No backend, cada comando `#[tauri::command]` retorna `Result<..., String>` na maior parte dos casos.

## Segurança e Guardrails
- Leitura/escrita de paths sensíveis é filtrada no frontend por `src/modules/ai/lib/security.ts`.
- Workspace authorization e canonicalização ficam no backend (`src-tauri/src/modules/workspace.rs`, `src-tauri/src/modules/fs/file.rs`).
- Proxy HTTP bloqueia hosts/header patterns inseguros em `src-tauri/src/modules/net.rs`.

## Tratamento de Erros
- Frontend frequentemente usa `try/catch` curto com fallback pragmático.
- Hooks retornam estado derivado (`error`, `isLoading`, etc.) em vez de lançar para cima.
- Backend converte erros internos para `String` nas bordas de IPC.
- Logging Rust com `log::{info,warn,error,debug}` aparece em PTY e outros módulos.

## Persistência e Performance
- Há debounce para persistência de mensagens em `src/modules/ai/store/chatStore.ts`.
- Há caching local/LRU em áreas como chat sessions e source control.
- Foco em evitar round-trips desnecessários entre UI e backend.

## Convenções Rust
- Submódulos exportados por `mod.rs` ou por arquivo raiz (`workspace.rs`, `net.rs`).
- Commands públicos nomeados por domínio: `git_*`, `fs_*`, `pty_*`, `shell_*`, `workspace_*`, `secrets_*`.
- Trabalhos bloqueantes do Git são empacotados com `spawn_blocking` em `src-tauri/src/modules/git/commands.rs`.

## UX e Comportamento
- App tenta esconder detalhes de plataforma quando possível:
  - settings window desacoplada
  - keyring unificado
  - suporte WSL tratado no backend
- Tabs/panes/sidebars usam APIs imperativas para foco e coordenação fina.

## O que Não Vi
- Não achei ESLint/Prettier explícitos no repositório raiz.
- Não achei framework frontend de testes ativo.
- Não achei arquitetura baseada em server components, Redux ou backend HTTP próprio.
