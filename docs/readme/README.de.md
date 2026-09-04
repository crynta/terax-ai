<div align="center">
  <img src="../../public/logo.png" width="144" height="144" alt="Terax" />
  <h1>Terax</h1>

  <p><strong>Leichtgewichtiger, terminalorientierter und KI-nativer Entwicklungsarbeitsbereich.</strong></p>

  <p>
    <a href="https://terax.app">Website</a> ·
    <a href="https://terax.app/docs">Dokumentation</a> ·
    <a href="https://github.com/crynta/Terax-website">Quellcode der Website</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/crynta/terax-ai?label=version&color=blue" alt="Version" />
    <img src="https://img.shields.io/github/downloads/crynta/terax-ai/total?label=downloads&color=blue" alt="Downloads" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="Plattform" />
    <a href="https://discord.gg/tyveTUyEp7"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
    <a href="https://www.youtube.com/@crynta"><img src="https://img.shields.io/badge/Youtube-FF0000?logo=youtube&logoColor=white" alt="YouTube" /></a>
  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt-BR.md">Português</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.id.md">Bahasa Indonesia</a> |
  <a href="README.hi.md">हिन्दी</a>
</p>

---

Terax ist eine leichtgewichtige, quelloffene, terminalorientierte und KI-native Entwicklungsumgebung (ADE), die auf Tauri 2 + Rust und React 19 basiert. Sie bietet ein natives PTY-Backend mit WebGL-Renderer, eine agentische KI-Seitenleiste für eigene Schlüssel oder vollständig lokale Modelle sowie einen Code-Editor, Datei-Explorer, Quellcodeverwaltung mit Git-Graph und eine integrierte Webvorschau. Etwa 7-8 MB auf der Festplatte. Keine Telemetrie. Kein Konto.

## Screenshots

<table>
  <tr>
    <td align="center"><img src="../web-preview.png" alt="Webvorschau" /><br/><sub>Webvorschau lokaler Entwicklungsserver</sub></td>
    <td align="center"><img src="../ai-workflow.png" alt="KI-Fenster" /><br/><sub>Agentischer KI-Workflow mit Bearbeitungs-Diffs im Code-Editor</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="../themes.png" alt="Themes und Hintergrundbild" style="margin-top: 12px;"/><br/><sub>Eigene Themes, Voreinstellungen und Hintergrundbilder</sub></td>
    <td align="center"><img src="../source-control.png" alt="Quellcodeverwaltung und Git-Graph" style="margin-top: 12px;"/><br/><sub>Quellcodeverwaltung mit Git-Graph im Verlauf</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="../terminal.png" alt="Terminal" style="border-radius: 4px; margin-top: 12px;" /><br/><sub>Blockbasiertes WebGL-Terminal mit editorähnlichem Eingabebereich</sub></td>
  </tr>
</table>

## Funktionen

### Terminal

- xterm.js mit WebGL-Renderer, mehreren Tabs und Hintergrund-Streaming
- GPU-beschleunigtes blockbasiertes Terminal mit editorähnlicher Befehlseingabe
- Natives PTY-Backend über `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Horizontal und vertikal geteilte Bereiche
- Integrierte Suche, Linkerkennung und True Color
- Dateien aus Explorer oder Desktop als Shell-sicher quotierte Pfade in ein Terminal ziehen
- Arbeitsumgebungen pro Tab unter Windows (Lokal oder jede installierte WSL-Distribution)
- Spaces stellt Tabs, Arbeitsverzeichnisse und geteilte Layouts nach einem Neustart wieder her

### Code-Editor

- CodeMirror 6 (unterstützt alle verbreiteten Sprachen wie TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown usw.)
- Integrierte KI-Vervollständigung mit Unterstützung lokaler Modelle
- KI-Bearbeitungs-Diffs, abschnittsweise annehmbar oder ablehnbar
- Optionale Language-Server-Unterstützung mit Diagnosen, Navigation, Vervollständigung, Formatierung und eigenen Servern
- Gerendertes Markdown sowie Anzeige von Bildern, Videos, Audio und PDF
- Vim-Modus
- Integrierte Editor-Themes wie Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub und Xcode

### Quellcodeverwaltung

- Abschnitte stagen oder unstagen, committen (Cmd+Enter / Ctrl+Enter) und mit Upstream-Erkennung pushen
- Branch-Anzeige einschließlich Detached-HEAD-Zustand
- Git-Verlauf mit echtem Commit-Graphen und Spuren für Merges und Branches
- Commits suchen und filtern sowie die Remote-Commit-Seite öffnen

### Datei-Explorer

- Catppuccin-Icon-Theme
- Unscharfe Suche, Tastaturnavigation, direktes Umbenennen und Kontextaktionen
- Live-Aktualisierung bei Dateiänderungen auf der Festplatte
- Dateien und Auswahl direkt an die KI-Seitenleiste anhängen

### Webvorschau

- Erkennt lokale Entwicklungsserver automatisch und öffnet sie in einem Vorschau-Tab
- Vorschau externer URLs über eine native untergeordnete Webview

### Themes und Anpassung

- Eigene Themes in der App erstellen und zwischen integrierten Vorgaben und eigenen Themes wechseln
- Themes teilen oder aus der Community importieren
- Hintergrundbilder mit einstellbarer Deckkraft und Unschärfe
- Das Editor-Theme ist unabhängig vom App-Theme

### KI

- **Anbieter mit eigenem Schlüssel:** OpenAI, Anthropic, Google (Gemini), Groq, xAI (Grok), Cerebras, OpenRouter, DeepSeek, Mistral sowie jeder OpenAI-kompatible Endpunkt
- **Lokal / offline:** LM Studio, MLX, Ollama
- **Agentischer Workflow:** Pläne, Sub-Agenten, Projektgedächtnis über `TERAX.md`, Lesen / Schreiben / Bearbeiten / Mehrfachbearbeitung / grep / glob, Bash mit Freigabe und Hintergrundprozesse
- **Orchestrierung von Coding-Agenten:** Claude Code in einem Terminal starten, Ausgabe prüfen und Folgeaufgaben über freigabepflichtige Tools senden
- **Composer:** Prompt-Snippets über `#handle`, Dateien über `@path`, Spracheingabe und Anhängen aus Explorer oder Auswahl
- **Eigene Agenten** mit eigenem System-Prompt und Tool-Teilsatz
- **Planungsmodus**, der vor der Ausführung einen Plan erstellt und bestätigen lässt

## Installation

Die neuesten Installationspakete stehen auf der Seite [Releases](https://github.com/crynta/terax-ai/releases/latest). Terax aktualisiert sich von dort automatisch.

### Hinweise für Windows

- Standardmäßige Shell-Erkennung: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL ist eine vollwertige Arbeitsumgebung und kein umschlossener Unterprozess.

### Hinweise für Linux

- **Arch / AUR:** `yay -S terax-bin` (oder `paru` usw.). Folgt der neuesten Version.
- **NixOS / Nix:** Nutze den offiziellen Flake: `nix profile install github:crynta/terax-ai` außerhalb von NixOS. Unter NixOS importierst du den Flake und fügst `inputs.terax.packages.${pkgs.system}.terax` zu `environment.systemPackages` hinzu. Für eine einfachere Einrichtung ist auch `nixosModules.terax` verfügbar.
- **AppImage:** Benötigt FUSE. Ohne FUSE: `./Terax_*.AppImage --appimage-extract-and-run`. Bei Darstellungsfehlern unter Wayland hilft möglicherweise `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Die `.deb`- / `.rpm`-Pakete binden stattdessen den GTK-Stack des Systems ein und laufen meist flüssiger.

## KI konfigurieren

1. Öffne **Einstellungen -> KI**.
2. Wähle einen Anbieter und füge deinen API-Schlüssel ein. Für lokale Inferenz verweist du Terax auf deinen LM Studio- / MLX- / Ollama-Endpunkt.
3. Schlüssel werden über `keyring` im Schlüsselbund des Betriebssystems gespeichert. Sie werden niemals auf die Festplatte oder in localStorage geschrieben.

## Aus dem Quellcode bauen

**Voraussetzungen**

- Rust (stable), https://rustup.rs
- Node 20+ und [pnpm](https://pnpm.io)
- Tauri-Voraussetzungen für deine Plattform, https://tauri.app/start/prerequisites/

**Ausführen**

```bash
pnpm install
pnpm tauri dev          # Entwicklung
pnpm tauri build        # Produktionspaket
```

**Prüfungen**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # Rust-Lint wie in CI
cd src-tauri && cargo nextest run --locked                           # oder: cargo test --locked
```

## Technologie-Stack

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui und Zustand.

## Mitwirken

Issues und PRs sind willkommen. Melde Probleme, schlage Funktionen vor oder reiche Pull Requests ein. Weitere Informationen findest du in [CONTRIBUTING.md](../../CONTRIBUTING.md) und der [Architekturdokumentation](../README.md).

## Codesignierung

<a href="https://signpath.org"><img src="https://avatars.githubusercontent.com/u/34448643?s=200&v=4" width="80" alt="SignPath" align="left" /></a>

Windows-Builds werden mit einem kostenlosen Codesignaturzertifikat von [SignPath.io](https://signpath.io) signiert, das von der [SignPath Foundation](https://signpath.org) ausgestellt wird.

<br clear="left" />

## Lizenz

Terax steht unter der Apache-2.0-Lizenz. Weitere Informationen zu unseren Abhängigkeiten findest du in der [Apache License 2.0](../../LICENSE).
