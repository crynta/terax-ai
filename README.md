# Terax(個人客製化 fork)

這是 [crynta/terax-ai](https://github.com/crynta/terax-ai) 的個人客製化分支,不是要提交回官方的一次性 patch,而是**長期疊在官方版本之上、持續維護的客製化層**。這個 repo 本身也當作雲端備份用。

## 為什麼會有這個 fork

官方目前不打算提供、或還沒提供某些功能/修法,但日常使用上需要,所以在這裡對官方原始碼直接修改。官方會持續改版,所以每一筆客製化修改都必須清楚記錄「改了什麼、為什麼改、怎麼改」,下次官方發新版時才能快速、準確地在新版原始碼上重新套用,而不是每次都重新除錯一遍。

完整的架構文件、開發慣例、品質標準,見 [`TERAX.md`](TERAX.md)(官方留下的架構真理來源)。給 Claude Code 之類 AI agent 接手用的入口在 [`CLAUDE.md`](CLAUDE.md)。

## 目前的客製化修改

分支 `fix/option-arrow-keycode-229`:

- **修復 Option+方向鍵/Option+Backspace 在 macOS 上完全無反應**——macOS WKWebView 把 Option 修飾鍵誤標成 `keyCode 229`(IME 組字碼),原本的 IME 守衛把這些事件整個吞掉。已送官方 PR [#956](https://github.com/crynta/terax-ai/pull/956)。
- **新增 Option+Z:對映到 shell readline 的 undo(`Ctrl+_`)**,用來撤銷終端機輸入行還沒送出的編輯。
- **簡化 IME keyCode-229 守衛**:拿掉 Terax 自己重複、且更粗糙的 `keyCode === 229` 判斷,交還給 xterm.js 自己內建、更精確的 `CompositionHelper` 邏輯處理。

詳細根因分析、重現步驟、走過的彎路,見 [`FIX_NOTES.md`](FIX_NOTES.md)。

**已知問題(擱置,非本 fork 造成)**:CJK 輸入法直接輸入全形標點(例如 `Shift+,`)偶爾會漏掉第一個字元。根因在 `@xterm/xterm` 這個依賴套件本身的 `CompositionHelper._handleAnyTextareaChanges` 診斷邏輯,不是 Terax 或這個 fork 的程式碼問題,細節見 `FIX_NOTES.md`。

## 建置與開發

```bash
pnpm install
pnpm tauri dev          # 開發模式(有 devtools,Vite HMR)
pnpm tauri build        # 編出正式版 .app/.dmg
```

編譯出的 App 位於 `src-tauri/target/release/bundle/macos/Terax.app`,可直接拿去覆蓋 `/Applications/Terax.app`。

檢查指令(改動後務必跑過):

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked
```

## Remotes

- `origin` = 官方上游 `crynta/terax-ai`(唯讀,只 fetch 追蹤新版,不 push)
- `fork` = 這個個人 fork `ayii0111/terax-ai`(push 客製化分支、送 PR、備份用)

## 官方發新版後的重現流程

```bash
git fetch origin
git rebase origin/main   # 在客製化分支上執行
```

沒衝突就直接套用完;若官方剛好動到我們改過的那幾行,對照 `FIX_NOTES.md` 裡的根因分析手動重新推導修法,再重新走一次上面的檢查指令、重新 `pnpm tauri build`。
