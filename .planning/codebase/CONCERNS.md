---
title: Concerns
mapped_at: 2026-05-17
---

# CONCERNS

## Principais Riscos

### 1. Alto acoplamento no shell principal
- `src/app/App.tsx` é muito grande e concentra layout, estado derivado, foco, atalhos, tabs, panes, AI bridge, source control e switching de workspace.
- Risco: regressões por efeito colateral, dificuldade de teste e custo alto para mudanças transversais.

### 2. Cobertura automatizada limitada no frontend
- Não achei suíte de testes frontend.
- Áreas com bastante estado e integração:
  - `src/modules/ai/*`
  - `src/modules/terminal/*`
  - `src/modules/source-control/*`
  - `src/modules/editor/*`
- Risco: bugs de UX, race conditions e regressões de integração passarem só com build/type-check.

### 3. Fronteira de segurança distribuída
- Há guardrails bons, mas espalhados:
  - `src/modules/ai/lib/security.ts`
  - `src-tauri/src/modules/workspace.rs`
  - `src-tauri/src/modules/net.rs`
  - `src-tauri/src/modules/secrets.rs`
- Risco: mudanças futuras abrirem bypass acidental entre validação frontend e backend.

### 4. Superfície AI ampla e mutável
- `src/modules/ai/config.ts` e `src/modules/ai/tools/*` mostram produto com muitos provedores, tools e políticas.
- Risco: manutenção de catálogo de modelos/preços/context windows ficar desatualizada e gerar UX errada ou comportamento inconsistente.

### 5. Dependência de coordenação imperativa
- Refs e handles imperativos são usados pesadamente em terminal, editor, preview e sidebar.
- Isso é plausível para o domínio, mas aumenta chance de bugs de foco, stale refs e timing.

## Riscos Específicos de Plataforma
- Linux usa fallback de segredos em arquivo local `0600` em `src-tauri/src/modules/secrets.rs`.
- WSL só existe no Windows e adiciona caminho UNC/resolução via `wsl.exe` em `src-tauri/src/modules/workspace.rs`.
- PTY tem branches e comportamento especial por SO em `src-tauri/src/modules/pty/*`.
- Risco: bugs específicos de plataforma não cobertos por CI homogêneo.

## Riscos Operacionais
- Workspace local contém `src-tauri/target/` e `node_modules/`; ferramentas internas precisam excluir esses diretórios para evitar ruído e custos.
- Updater depende de GitHub Releases e chaves de assinatura configuradas corretamente em `src-tauri/tauri.conf.json` e `.github/workflows/release.yml`.
- CI valida build/check/lint, mas não smoke testa o bundle gerado.

## Dívida Técnica Provável
- `App.tsx` sugere necessidade futura de extração em orchestrators/hooks menores.
- Falta de testes frontend deve virar gargalo conforme AI features crescerem.
- Backend Git/shell/PTY tem responsabilidade crítica; cobertura unitária parcial ainda é pouco para fluxos completos.

## Sinais Positivos
- Comentários em pontos delicados são bons e específicos.
- Há preocupação clara com segurança de path, secrets e rede.
- Git blocking work é enviado para `spawn_blocking`, reduzindo risco de travar a UI Tauri.

## Recomendações Imediatas
- Priorizar smoke tests de fluxos críticos antes de expandir features AI.
- Quebrar `src/app/App.tsx` por orquestradores ou hooks de domínio.
- Centralizar e documentar invariantes de segurança entre frontend/backend.
- Garantir exclusão consistente de artefatos gerados em buscas internas e features AI.
