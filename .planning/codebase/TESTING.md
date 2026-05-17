---
title: Testing
mapped_at: 2026-05-17
---

# TESTING

## Resumo
- A base tem validação automatizada em CI, mas cobertura de testes está concentrada no backend Rust.
- Não encontrei suíte frontend ativa com `Vitest`, `Jest`, `Playwright` ou `Cypress`.

## CI Atual
- `.github/workflows/ci.yml` roda:
  - `pnpm install --frozen-lockfile`
  - `pnpm exec tsc --noEmit`
  - `pnpm build`
  - `cargo check --all-targets --locked`
  - `cargo clippy --all-targets --locked -- -D warnings`

## Testes Rust Encontrados
- `src-tauri/src/modules/git/parser.rs`
  - possui `#[cfg(test)] mod tests`
- `src-tauri/src/modules/git/process.rs`
  - possui `#[cfg(test)] mod tests`
- `src-tauri/src/modules/pty/da_filter.rs`
  - possui `#[cfg(test)] mod tests`

## Natureza da Cobertura Atual
- Parsing Git e helpers de processo têm cobertura unitária local.
- Há teste localizado de filtro/normalização ligado ao PTY.
- O restante depende mais de type-check, build e lint do que de testes funcionais.

## O que Não Foi Encontrado
- Sem `vitest.config.*`.
- Sem `jest.config.*`.
- Sem `playwright.config.*`.
- Sem diretórios `__tests__`, `tests/` frontend ou specs de componentes.
- Sem teste end-to-end explícito do fluxo Tauri/UI.

## Riscos de Teste
- `src/app/App.tsx` é altamente orquestrador e hoje parece depender sobretudo de validação manual.
- Fluxos AI, approvals, panes e WSL têm muita coordenação de estado/efeitos, com pouca evidência de harness automatizado.
- Source control e terminal integram backend e UI; sem E2E, regressões de foco/sincronização podem passar.

## Comandos de Verificação Relevantes
- Frontend types: `pnpm exec tsc --noEmit`
- Build: `pnpm build`
- Rust lint/check: `cd src-tauri && cargo check --all-targets --locked`
- Rust clippy: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`

## Prioridades Naturais para Próximos Testes
- Hook `useSourceControl` e reducers/stores críticos.
- Fluxos de sessão AI em `src/modules/ai/store/chatStore.ts`.
- Operações de explorer/editor com mocks de `native`.
- Smoke E2E para abrir terminal, abrir arquivo, salvar, diff Git e abrir settings.
