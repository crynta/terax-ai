# Terax Reader for Claude Code (VS Code)

Terax's chat view for Claude Code, running beside a Claude session in the VS Code terminal. It shows cards for prompts, replies, thinking, tools and diffs. It also has permission and question cards you can click, and a prompt box with `/` and `@` suggestions, queueing, Stop, and mode and model pickers. There's also session info, the Changes panel, file diffs, history, resume, fork and rewind.

## Use it

1. Install the `.vsix`: drag it onto VS Code's Extensions view, or run **Extensions: Install from VSIX…**.
2. Open a **new** terminal. Terminals opened before the install don't report Claude's session.
3. Run `claude`. The Reader opens beside the terminal. You can also open it with **Claude Reader: Open Reader for Active Terminal** from the terminal tab's right-click menu or the status bar item.

## How it works

- **Chat history:** the Reader reads Claude's session file, `~/.claude/projects/<folder>/<session>.jsonl`.
- **Session and status:**
  - The Terax Claude hooks print a session marker into the terminal. The extension sets `TERAX_TERMINAL=1` in VS Code terminals so they fire.
  - VS Code shell integration passes the terminal's output to the extension, which reads that marker.
- **Cards and footer:** the same output stream feeds an invisible copy of the screen. The Reader parses Claude's dialogs, footer and activity line from it.
- **Typing:** the prompt box, Stop, modes and card answers are typed into the terminal through `terminal.sendText`.

## Limits

- **Needs shell integration.** It's on by default for zsh and bash. Without it, the cards and status don't appear, but the chat history and typing still work.
- **No microphone in VS Code panels.** Use macOS Dictation (press Fn twice) in the prompt box.
- **Needs the Terax hooks.** Without them in `~/.claude/settings.json`, the Reader finds the session by folder and start time.

## Build

From the Terax repo root:

```sh
cd vscode-extension
npm install
npm run package   # → terax-claude-reader.vsix
npm test
```
