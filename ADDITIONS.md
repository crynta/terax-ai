## What problem does this solve?

Modern development workflows are heavily centered around Linux-based tooling and terminal environments. Developers frequently rely on Bash-compatible shells and remote environments for daily work, including tools such as Git, Docker, Node.js, Python, SSH, Kubernetes, cloud CLIs, and various package managers.

Currently, Terax-AI Terminal mainly supports Windows-native shells such as:

* PowerShell
* Command Prompt

However, it lacks integrated support for Linux-style environments and multi-session workflows. Developers therefore often switch between Terax-AI and external tools such as:

* Windows Terminal
* WSL (Windows Subsystem for Linux)
* Git Bash
* VS Code integrated terminal
* SSH clients (e.g., remote servers or development machines)

This breaks workflow continuity, reduces productivity, and prevents Terax-AI Terminal from serving as a primary development terminal on Windows and other platforms.

Additionally, developers who work with multiple environments simultaneously (local, WSL, and remote SSH systems) cannot easily distinguish or manage active terminal contexts.

---

## Proposed solution

Introduce a **Unified Terminal & Session System** that adds Linux shell support, remote sessions, and multi-terminal management similar to modern terminal applications while remaining deeply integrated into Terax-AI.

### Supported terminal environments

* PowerShell
* Command Prompt
* Developer PowerShell
* Developer Command Prompt
* Git Bash
* Native Bash
* WSL distributions (Ubuntu, Debian, etc.)
* SSH sessions (cross-platform)

### Session System

Add a first-class **Session Model**:

* Each terminal runs as an identifiable session
* Custom session name and icon
* Easy recognition when multiple sessions are open
* Persistent sessions between app restarts
* Quick switching between environments

Example sessions:

* Local PowerShell
* WSL Ubuntu
* SSH: production server
* SSH: VPS
* Git Bash workspace

### Core features

* Terminal selection dropdown when creating a session
* Automatic detection of installed shells and WSL distributions
* Built-in SSH session creation
* Multiple terminal tabs and sessions
* Session persistence between launches
* Environment-aware UI indicators (icon + label)
* Full Linux command support through WSL/Bash

### Environment-aware workspace integration

When switching sessions, the application context should follow the active environment:

* **WSL sessions** should reflect the WSL filesystem (e.g., `~/` inside WSL)
* **SSH sessions** should display remote files relative to the connected host
* Sidebar file explorer updates automatically based on the active session directory

This enables a seamless workflow where terminal, filesystem navigation, and project context stay synchronized.

With SSH session support integrated directly into Terax-AI Terminal, developers could manage remote machines without requiring separate tools such as external SSH clients.

---

## Alternatives considered

Current workarounds include:

* Using Windows Terminal
* Running WSL separately
* Using Git Bash independently
* Using VS Code integrated terminal
* Using external SSH clients

While these tools work well individually, switching between applications creates fragmented workflows and reduces efficiency.
