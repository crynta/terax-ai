# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 這個 repo 存在的目的（先讀這段）

這不是一般的「幫官方專案修 bug 再送 PR 就結束」的 repo。它的核心目的是**長期維護一份疊在官方 Terax 之上的個人客製化層**：

1. **起因**：官方 Terax 目前不打算提供、或還沒提供某些功能／修法，但使用者需要。因此在這個 repo 對官方原始碼做客製化修改（例如 patch 一個 bug、加一個官方沒有的行為）。
2. **持續性需求**：官方會持續改版（合併 PR、發新版），每次改版都可能讓這份客製化修改的基準（base commit）過期、衝突、或被覆蓋。因此**每一筆客製化修改，都必須被清楚記錄「改了什麼檔案、為什麼改、怎麼改」**，讓下次官方發新版時，能夠快速、準確地在新版原始碼上重新套用（reproduce）同一批客製化修改 —— 而不是每次都重新除錯一遍。
3. **交付需求**：這個 repo 不只是改原始碼而已，還要能快速從修改後的原始碼**編譯出可安裝的 App**（`pnpm tauri build`），方便使用者直接換掉本機安裝的官方版本。
4. **交接需求**：以上兩件事（重現客製化修改 + 編譯安裝）的關鍵資訊，必須留下讓**下一個接手的 agent**（可能是全新對話、沒有這次的上下文）能夠快速看懂現況、快速動手，不用重新問一輪或重新摸索一遍。

### Remotes

- `origin` = 官方上游 `crynta/terax-ai`（唯讀，只 fetch 追蹤新版，不 push）
- `fork` = 個人 fork `ayii0111/terax-ai`（push 客製化分支、送 PR 用）

### 客製化修改的記錄慣例

- 每一批客製化修改都建一個獨立分支（例如 `fix/option-arrow-keycode-229`），分支名即修改內容摘要。
- 每個分支的根目錄下留一份 `FIX_NOTES.md`（未進版控，純本機交接筆記），內容至少包含：
  - 一句話結論（改了什麼、解決什麼症狀）
  - 根因分析（為什麼會這樣，避免下次重新排查）
  - 怎麼證實/重現 bug 的具體步驟
  - 實際修法（改了哪個檔案、關鍵程式碼片段）
  - 官方 PR 連結（如果有送）
  - 走過的彎路（已經試過但放棄的方案，避免重踩）
  - 使用者本機環境現況（例如 `/Applications/Terax.app` 是不是已經換成自編版本、備份放哪）
- Commit message 要完整說明根因（不是只寫症狀），因為改版後可能要靠 commit log 反查當初為什麼這樣改。
- 官方發新版後的標準流程：`git fetch origin`，把客製化分支 rebase 到新的 `origin/main`，解衝突，重新走一次「Commands」段落的檢查（lint / check-types / test / clippy / nextest），確認客製化修改在新版上還是成立，再重新 `pnpm tauri build`。

`TERAX.md` at the repo root is the source of truth for upstream architecture, conventions, and the quality bar — read it before making changes. `docs/architecture/*.md` and `docs/contributing/testing.md` elaborate on specific subsystems without duplicating it.

## Commands

```bash
pnpm install
pnpm tauri dev          # run the app (dev)
pnpm tauri build        # production bundle

pnpm lint               # biome lint ./src
pnpm check-types        # tsc --noEmit
pnpm test               # vitest run
pnpm test:watch         # vitest --watch, for iterating on a single test file

cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked     # or: cargo test --locked
```

Frontend package manager is **pnpm only** — never npm/npx/yarn.
