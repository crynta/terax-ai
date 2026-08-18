<div align="center">
  <img src="../../public/logo.png" width="144" height="144" alt="Terax" />
  <h1>Terax</h1>

  <p><strong>轻量、终端优先的 AI 原生开发工作区。</strong></p>

  <p>
    <a href="https://terax.app">网站</a>
    ·
    <a href="https://terax.app/docs">文档</a>
    ·
    <a href="https://github.com/crynta/Terax-website">网站源代码</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/crynta/terax-ai?label=version&color=blue" alt="版本" />
    <img src="https://img.shields.io/github/downloads/crynta/terax-ai/total?label=downloads&color=blue" alt="下载量" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="平台" />
    <a href="https://discord.gg/tyveTUyEp7"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
    <a href="https://www.youtube.com/@crynta"><img src="https://img.shields.io/badge/Youtube-FF0000?logo=youtube&logoColor=white" alt="YouTube" /></a>
  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.de.md">Deutsch</a> |
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

Terax 是一个轻量、开源、终端优先的 AI 原生开发环境（ADE），基于 Tauri 2 + Rust 和 React 19 构建。它内置原生 PTY 后端与 WebGL 渲染器、使用你自己的密钥或完全本地模型运行的智能体 AI 侧边栏，以及代码编辑器、文件浏览器、带 Git 图的源代码管理和网页预览面板。磁盘占用约 7-8 MB。无遥测。无需账户。

## 截图

<table>
  <tr>
    <td align="center"><img src="../web-preview.png" alt="网页预览" /><br/><sub>本地开发服务器网页预览</sub></td>
    <td align="center"><img src="../ai-workflow.png" alt="AI 窗口" /><br/><sub>在代码编辑器中显示编辑差异的智能体 AI 工作流</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="../themes.png" alt="主题和背景图" style="margin-top: 12px;"/><br/><sub>自定义主题、预设和背景图</sub></td>
    <td align="center"><img src="../source-control.png" alt="源代码管理和 Git 图" style="margin-top: 12px;"/><br/><sub>带历史 Git 图的源代码管理面板</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="../terminal.png" alt="终端" style="border-radius: 4px; margin-top: 12px;" /><br/><sub>基于块的 WebGL 终端，配有类似编辑器的输入面板</sub></td>
  </tr>
</table>

## 功能

### 终端

- 使用 WebGL 渲染器的 xterm.js，支持多标签和后台流式输出
- GPU 加速的块式终端，提供类似编辑器的命令输入
- 通过 `portable-pty` 提供原生 PTY 后端（zsh、bash、pwsh、fish、cmd）
- 水平和垂直拆分面板
- 内联搜索、链接检测和真彩色
- 将文件从浏览器或桌面拖入终端，自动转换为适合 Shell 的安全引用路径
- Windows 上的逐标签工作区环境（本地或任意已安装的 WSL 发行版）
- Spaces 可跨启动恢复标签、工作目录和拆分布局

### 代码编辑器

- CodeMirror 6（支持所有常用语言，包括 TS/JS、Rust、Python、Go、C/C++、Java、HTML/CSS、JSON、Markdown 等）
- 支持本地模型的内联 AI 自动补全
- AI 编辑差异，可逐块接受或拒绝
- 可选语言服务器支持，提供诊断、导航、补全、格式化和自定义服务器
- 渲染 Markdown，并可查看图片、视频、音频和 PDF
- Vim 模式
- 内置编辑器主题，包括 Kanagawa、Catppuccin、Rosé Pine、Everforest、Dracula、Solarized、Nord、Tokyo Night、GitHub 和 Xcode

### 源代码管理

- 暂存或取消暂存代码块、提交（Cmd+Enter / Ctrl+Enter）、支持感知上游分支的推送
- 分支显示，包括分离 HEAD 状态
- 带真实提交图的 Git 历史面板（为合并和分支渲染轨道）
- 提交搜索与筛选，可点击跳转到远程提交页面

### 文件浏览器

- Catppuccin 图标主题
- 模糊搜索、键盘导航、内联重命名和上下文操作
- 磁盘文件变更时实时更新
- 将文件和选区直接附加到 AI 侧边栏

### 网页预览

- 自动检测本地开发服务器并在预览标签中打开
- 通过原生子 WebView 预览外部 URL

### 主题和自定义

- 在应用内创建自定义主题，可在内置预设和自己的主题之间切换
- 创建并分享自己的主题，或从社区导入
- 背景图支持调整不透明度和模糊度
- 编辑器主题独立于应用主题

### AI

- **自带密钥提供商：** OpenAI、Anthropic、Google（Gemini）、Groq、xAI（Grok）、Cerebras、OpenRouter、DeepSeek、Mistral，以及任意兼容 OpenAI 的端点
- **本地 / 离线：** LM Studio、MLX、Ollama
- **智能体工作流：** 计划、子智能体、通过 `TERAX.md` 实现的项目记忆、文件读取 / 写入 / 编辑 / 多处编辑 / grep / glob、需要批准的 bash、后台进程
- **编码智能体编排：** 在终端中启动 Claude Code、检查其输出，并通过需要批准的工具发送后续工作
- **输入区：** 通过 `#handle` 使用提示片段、通过 `@path` 添加文件、语音输入，以及从文件浏览器或选区附加到智能体
- **自定义智能体**，拥有各自的系统提示和工具子集
- **计划模式**，在执行前生成计划并请求确认

## 安装

最新安装程序位于 [Releases](https://github.com/crynta/terax-ai/releases/latest) 页面。Terax 会从该页面自动更新。

### Windows 说明

- 默认 Shell 检测：`pwsh.exe`（PowerShell 7+）-> `powershell.exe`（Windows PowerShell 5.1）-> `cmd.exe`。
- WSL 是一等工作区环境，而不是封装的子进程。

### Linux 说明

- **Arch / AUR：** `yay -S terax-bin`（也可使用 `paru` 等）。它会跟随最新版本。
- **NixOS / Nix：** 使用官方 flake。非 NixOS 运行 `nix profile install github:crynta/terax-ai`；NixOS 可导入 flake，并将 `inputs.terax.packages.${pkgs.system}.terax` 添加到 `environment.systemPackages`。也可以使用 `nixosModules.terax` 输出进行更简单的配置。
- **AppImage：** 需要 FUSE。没有 FUSE 时运行 `./Terax_*.AppImage --appimage-extract-and-run`。如果在 Wayland 上出现渲染问题，请尝试 `WEBKIT_DISABLE_DMABUF_RENDERER=1`。否则，`.deb` / `.rpm` 包会链接系统 GTK 栈，通常更流畅。

## 配置 AI

1. 打开**设置 -> AI**。
2. 选择提供商并粘贴 API 密钥。对于本地推理，将 Terax 指向你的 LM Studio / MLX / Ollama 端点。
3. 密钥通过 `keyring` 写入操作系统钥匙串。密钥绝不会写入磁盘或 localStorage。

## 从源代码构建

**前置要求**

- Rust（stable），https://rustup.rs
- Node 20+ 和 [pnpm](https://pnpm.io)
- 适用于你平台的 Tauri 前置要求，https://tauri.app/start/prerequisites/

**运行**

```bash
pnpm install
pnpm tauri dev          # 开发
pnpm tauri build        # 生产构建包
```

**检查**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # Rust 检查（与 CI 一致）
cd src-tauri && cargo nextest run --locked                           # 或：cargo test --locked
```

## 技术栈

Tauri 2、Rust、`portable-pty`、React 19、TypeScript、Vite、xterm.js、CodeMirror 6、Vercel AI SDK v6、Tailwind v4、shadcn/ui、Zustand。

## 贡献

欢迎提交 Issue 和 PR！你可以提出问题、建议功能或提交拉取请求。更多信息请参阅 [CONTRIBUTING.md](../../CONTRIBUTING.md) 和[架构文档](../README.md)。

## 代码签名

<a href="https://signpath.org"><img src="https://avatars.githubusercontent.com/u/34448643?s=200&v=4" width="80" alt="SignPath" align="left" /></a>

Windows 构建使用 [SignPath.io](https://signpath.io) 提供的免费代码签名证书，证书由 [SignPath Foundation](https://signpath.org) 颁发。

<br clear="left" />

## 许可证

Terax 使用 Apache-2.0 许可证。有关依赖项的更多信息，请参阅 [Apache License 2.0](../../LICENSE)。
