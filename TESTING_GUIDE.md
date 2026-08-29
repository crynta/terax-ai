# Testing Guide

This guide helps contributors write effective tests for Terax. Testing is critical for a terminal emulator that handles PTY sessions, file operations, and AI integrations across macOS, Linux, and Windows.

## Testing Philosophy

Terax aims for **high confidence with minimal overhead**. Tests should:

- **Catch regressions** — especially security and platform-specific bugs
- **Run fast** — sub-second for unit tests, under 10s for integration
- **Be maintainable** — clear names, no brittle mocking, fail with useful messages
- **Cover hot paths** — PTY streaming, file operations, AI tool guards, terminal rendering

Not every function needs a test. Focus on:
- Security boundaries (AI tool path guards, command validation)
- Cross-platform edge cases (PTY initialization, file paths, shell detection)
- Complex logic (Git parsing, OSC sequence handling, terminal state)

## Prerequisites

### Frontend Testing
- **Node 20+** and **pnpm**
- **Vitest** — already configured in `package.json`
- Run: `pnpm test` or `pnpm test:watch`

### Backend Testing
- **Rust stable** (via `rustup`)
- Built-in test runner: `cargo test`
- From `src-tauri/`: `cargo test` (all tests) or `cargo test --lib` (unit only)

### Full Test Suite
```bash
# Frontend
pnpm test

# Backend
cd src-tauri && cargo test

# Type-check (not tests, but catches many bugs)
pnpm exec tsc --noEmit
cd src-tauri && cargo clippy
```

## Frontend Testing (TypeScript / Vitest)

### File Locations
Tests live alongside source files:
```
src/modules/ai/lib/security.ts
src/modules/ai/lib/security.test.ts
```

### Basic Structure

```typescript
import { describe, expect, it } from "vitest";
import { yourFunction } from "./your-module";

describe("yourFunction", () => {
  it("handles the happy path", () => {
    expect(yourFunction("input")).toBe("expected");
  });

  it("rejects invalid input", () => {
    expect(() => yourFunction("bad")).toThrow();
  });
});
```

### Security Function Testing

Security tests are the highest priority. See `src/modules/ai/lib/security.test.ts` for comprehensive examples.

**Key patterns:**

#### Path validation tests
```typescript
describe("checkReadable — secret basenames", () => {
  it("blocks .env files", () => {
    expect(checkReadable("/home/me/.env")).toMatchObject({ ok: false });
  });

  it("blocks SSH keys", () => {
    expect(checkReadable("/home/me/.ssh/id_rsa")).toMatchObject({ ok: false });
  });

  it("allows safe paths", () => {
    expect(checkReadable("/home/me/notes.txt")).toMatchObject({ ok: true });
  });
});
```

#### Platform-specific tests
```typescript
describe("Windows path handling", () => {
  it("normalizes UNC prefixes", () => {
    expect(checkReadable("\\\\?\\C:\\Users\\me\\.ssh\\id_rsa"))
      .toMatchObject({ ok: false });
  });

  it("handles NTFS alternate data streams", () => {
    expect(checkReadable("C:\\Users\\me\\.env::$DATA"))
      .toMatchObject({ ok: false });
  });
});
```

#### Unicode attack tests (Trojan Source defense)
```typescript
describe("checkShellCommand — bidi defense", () => {
  it("rejects right-to-left override", () => {
    const cmd = `ls${String.fromCharCode(0x202e)}; rm -rf /`;
    expect(checkShellCommand(cmd)).toMatchObject({ ok: false });
  });
});
```

### Testing React Components

Terax uses React 19 with strict mode. Minimal React Testing Library usage — most UI logic is tested via integration or left to manual QA.

**When to test:**
- Pure functions extracted from components
- Custom hooks with complex state logic
- Security-critical rendering (preview iframe sandboxing)

**When not to test:**
- Layout-only components
- Simple event handlers
- Styling and visual appearance (manual QA)

Example:
```typescript
import { renderHook } from "@testing-library/react";
import { useFileTree } from "./useFileTree";

it("expands directory on click", () => {
  const { result } = renderHook(() => useFileTree("/workspace"));
  
  act(() => {
    result.current.toggle("/workspace/src");
  });
  
  expect(result.current.expanded).toContain("/workspace/src");
});
```

### Testing Async Code

Use `async/await` with Vitest:

```typescript
it("fetches AI completion", async () => {
  const result = await getCompletion("test prompt");
  expect(result.text).toBeDefined();
});
```

For testing error cases:
```typescript
it("throws on invalid API key", async () => {
  await expect(getCompletion("test", { apiKey: "" }))
    .rejects.toThrow("Invalid API key");
});
```

## Backend Testing (Rust)

### File Locations
Tests live in the same file as the implementation (bottom of file) or in a `tests/` directory:

```rust
// src-tauri/src/modules/shell/ringbuffer.rs

pub struct RingBuffer { /* ... */ }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_push_pop() {
        let mut buf = RingBuffer::new(10);
        buf.push(42);
        assert_eq!(buf.pop(), Some(42));
    }
}
```

### Integration Tests
Put larger tests in `src-tauri/tests/`:
```rust
// src-tauri/tests/pty_lifecycle.rs

#[test]
fn test_pty_spawn_and_close() {
    // Integration test spanning multiple modules
}
```

### PTY Testing Patterns

PTY tests are tricky because they spawn real processes. Keep them focused and fast.

#### Shell detection
```rust
#[test]
fn detects_pwsh_before_powershell_on_windows() {
    #[cfg(target_os = "windows")]
    {
        let shell = detect_shell();
        // On CI, pwsh.exe may not exist — check for fallback chain
        assert!(shell.contains("pwsh") || shell.contains("powershell"));
    }
}
```

#### Session lifecycle
```rust
#[test]
fn session_closes_cleanly() {
    let session = PtySession::spawn("echo hello");
    let output = session.read_until_exit(Duration::from_secs(2));
    assert!(output.contains("hello"));
    // Session dropped here — no leaked handles
}
```

#### Escape sequence handling
Test OSC and CSI sequence parsing without spawning PTYs:
```rust
#[test]
fn parses_osc7_cwd_update() {
    let input = b"\x1b]7;file:///home/user/project\x07";
    let cwd = parse_osc7(input);
    assert_eq!(cwd, Some("/home/user/project".into()));
}
```

### Git Module Testing

Git tests use temporary directories and real Git commands:

```rust
#[test]
fn parses_commit_graph() {
    let tmpdir = TempDir::new().unwrap();
    // Initialize a real repo with test commits
    init_test_repo(&tmpdir);
    
    let graph = parse_log(&tmpdir.path());
    assert_eq!(graph.len(), 3);
    assert_eq!(graph[0].message, "Initial commit");
}
```

### Cross-Platform Testing

Use conditional compilation for platform-specific tests:

```rust
#[test]
#[cfg(target_os = "windows")]
fn handles_windows_paths() {
    assert!(is_valid_path("C:\\Users\\me\\file.txt"));
}

#[test]
#[cfg(unix)]
fn handles_unix_paths() {
    assert!(is_valid_path("/home/me/file.txt"));
}
```

Or use runtime checks:
```rust
#[test]
fn handles_platform_path_separator() {
    #[cfg(windows)]
    let sep = '\\';
    #[cfg(not(windows))]
    let sep = '/';
    
    assert!(path_contains_separator(&format!("a{}b", sep)));
}
```

## Platform-Specific Testing

### macOS
- **Option key handling** — test Cmd vs Ctrl disambiguation
- **Shell detection** — zsh is default since macOS 10.15
- **Keychain integration** — mock `security` command for API key tests

### Linux
- **Distribution variants** — test on Ubuntu, Arch, Fedora if possible
- **Shell detection** — bash, zsh, fish
- **WebKit rendering** — Wayland vs X11 edge cases (manual QA)
- **AppImage execution** — FUSE vs `--appimage-extract-and-run`

### Windows
- **PowerShell versions** — pwsh (7+) vs powershell (5.1)
- **Path handling** — UNC, extended-length (`\\?\`), case-insensitivity
- **Process lifecycle** — Job Object cleanup on pty_close
- **WSL integration** — test WSL distro detection and workspace mounting

### WSL
- **Workspace environment** — test cwd reporting across Windows/WSL boundary
- **Git integration** — test repo detection in mounted Windows drives
- **Shell initialization** — test bash/zsh inside WSL from Windows host

## Security Function Testing

Security tests are **non-negotiable**. Every path guard, command validator, and trust boundary needs explicit test coverage.

### Path Traversal Defense

Test all variations:
```typescript
describe("Path traversal defense", () => {
  it("blocks ../ escapes", () => {
    expect(checkReadable("/home/me/../.ssh/id_rsa")).toMatchObject({ ok: false });
  });

  it("blocks absolute path injections", () => {
    expect(checkReadable("/tmp/project/../../../etc/passwd")).toMatchObject({ ok: false });
  });

  it("blocks Windows device names", () => {
    expect(checkReadable("C:\\Users\\me\\..\\..\\..\\Windows\\System32")).toMatchObject({ ok: false });
  });
});
```

### Symlink Resolution

Test canonical path checking:
```typescript
it("catches symlink to protected directory", async () => {
  const resolve = async (p: string) =>
    p === "/home/me/link" ? "/home/me/.ssh/id_rsa" : p;
  
  const result = await checkReadableCanonical("/home/me/link", resolve);
  expect(result.ok).toBe(false);
});
```

### Command Injection Defense

Test shell escaping:
```typescript
describe("Shell injection defense", () => {
  it("blocks newline injection", () => {
    expect(checkShellCommand("echo safe\nrm -rf /")).toMatchObject({ ok: false });
  });

  it("blocks pipe to shell", () => {
    expect(checkShellCommand("curl x | sh")).toMatchObject({ ok: false });
  });
});
```

### SSRF Protection

Test network request validation:
```typescript
describe("SSRF defense", () => {
  it("blocks private IP ranges", () => {
    expect(checkUrl("http://192.168.1.1")).toMatchObject({ ok: false });
  });

  it("blocks localhost variations", () => {
    expect(checkUrl("http://127.0.0.1")).toMatchObject({ ok: false });
    expect(checkUrl("http://[::1]")).toMatchObject({ ok: false });
  });

  it("blocks DNS rebinding targets", () => {
    expect(checkUrl("http://169.254.169.254/metadata")).toMatchObject({ ok: false });
  });
});
```

## AI Tool Testing

AI tool approval flow and tool execution need careful testing.

### Tool Approval

```typescript
describe("Tool approval flow", () => {
  it("requires approval for file writes", async () => {
    const tool = { type: "file_write", path: "/workspace/new.txt" };
    const approved = await requestApproval(tool);
    // In tests, auto-reject or use mock approver
    expect(approved).toBe(false);
  });
});
```

### Tool Execution

```typescript
describe("File write tool", () => {
  it("writes to allowed paths", async () => {
    const result = await executeTool({
      type: "file_write",
      path: "/tmp/test.txt",
      content: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects writes to protected paths", async () => {
    const result = await executeTool({
      type: "file_write",
      path: "/etc/passwd",
      content: "malicious",
    });
    expect(result.success).toBe(false);
  });
});
```

## Testing Terminal Features

### xterm.js Integration

Most xterm.js behavior is tested upstream. Focus on Terax-specific integrations:

```typescript
describe("Terminal session", () => {
  it("applies correct WebGL renderer options", () => {
    const term = createTerminal({ rendererType: "webgl" });
    expect(term.options.rendererType).toBe("webgl");
  });

  it("handles resize correctly", () => {
    const term = createTerminal();
    term.resize(100, 30);
    expect(term.cols).toBe(100);
    expect(term.rows).toBe(30);
  });
});
```

### OSC Sequence Handling

Test escape sequence parsing:
```typescript
describe("OSC 7 (cwd reporting)", () => {
  it("extracts cwd from OSC 7 sequence", () => {
    const input = "\x1b]7;file:///home/user/project\x07";
    const cwd = parseOsc7(input);
    expect(cwd).toBe("/home/user/project");
  });

  it("handles URL-encoded paths", () => {
    const input = "\x1b]7;file:///home/user/my%20project\x07";
    const cwd = parseOsc7(input);
    expect(cwd).toBe("/home/user/my project");
  });
});
```

## CI/CD Integration

### GitHub Actions

Terax uses GitHub Actions for CI. Tests run on:
- Ubuntu (Linux)
- macOS (latest)
- Windows (latest)

**.github/workflows/test.yml** (example structure):
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test-frontend:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm test

  test-backend:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd src-tauri && cargo test
```

### Local CI Simulation

Run the same checks locally before pushing:

```bash
# Full test suite
pnpm test
cd src-tauri && cargo test && cd ..

# Type checks
pnpm exec tsc --noEmit
cd src-tauri && cargo clippy && cd ..

# Formatting
cd src-tauri && cargo fmt --check && cd ..
```

## Performance Testing

### Profiling Tests

Not formalized yet, but useful patterns:

```typescript
import { performance } from "node:perf_hooks";

it("parses large log file in <100ms", async () => {
  const start = performance.now();
  const commits = await parseGitLog("/path/to/large/repo");
  const elapsed = performance.now() - start;
  
  expect(elapsed).toBeLessThan(100);
  expect(commits.length).toBeGreaterThan(1000);
});
```

For Rust:
```rust
use std::time::Instant;

#[test]
fn parses_log_quickly() {
    let start = Instant::now();
    let commits = parse_log("large-repo");
    let elapsed = start.elapsed();
    
    assert!(elapsed.as_millis() < 100);
}
```

### Memory Testing

Watch for memory leaks in PTY sessions:

```rust
#[test]
fn pty_session_cleanup() {
    let initial = get_process_count();
    
    for _ in 0..100 {
        let session = PtySession::spawn("echo hello");
        drop(session);
    }
    
    // Allow a few stragglers, but should be close
    let final_count = get_process_count();
    assert!((final_count - initial).abs() < 5);
}
```

## Troubleshooting Test Failures

### Common Issues

#### "Port already in use" (dev server tests)
```bash
# Kill hanging processes
pkill -f "vite"
pkill -f "pnpm"
```

#### "PTY spawn timeout" (CI)
- Shells may be slower on CI runners
- Increase timeout: `session.wait(Duration::from_secs(5))`

#### "Type errors in tests" (after refactor)
```bash
# Regenerate types
pnpm exec tsc --noEmit
```

#### "Rust test failures on Windows"
- Path separator issues — use `std::path::MAIN_SEPARATOR`
- Line endings — use `strip()` not exact string match

#### "Flaky tests" (timing-dependent)
- Avoid `setTimeout` — use `waitFor` with conditions
- Add retries for network-dependent tests
- Mock external services where possible

### Debugging Failed Tests

#### Vitest
```bash
# Run single test file
pnpm test src/modules/ai/lib/security.test.ts

# Run tests matching pattern
pnpm test -t "blocks .env"

# Debug mode (inspect with Chrome DevTools)
node --inspect-brk ./node_modules/.bin/vitest
```

#### Cargo
```bash
# Run single test
cargo test test_pty_spawn -- --nocapture

# Show output even on success
cargo test -- --nocapture

# Run ignored tests (if marked #[ignore])
cargo test -- --ignored
```

## Test Coverage Goals

Terax doesn't have a hard coverage percentage requirement, but prioritizes:

1. **Security functions**: 100% coverage (path guards, command validation)
2. **PTY lifecycle**: 90%+ coverage (spawn, read, write, close)
3. **Git operations**: 80%+ coverage (parse, stage, commit)
4. **AI tool execution**: 90%+ coverage (approval, execution, guards)
5. **Platform-specific code**: Manual testing on all platforms

Lower priority:
- UI components (manual QA)
- Settings persistence (manual QA)
- Visual rendering (manual QA)

## Contributing Test Improvements

### Adding New Tests

1. **Identify the gap**: Security fix? New feature? Regression?
2. **Choose the right test type**: Unit, integration, or manual QA?
3. **Follow existing patterns**: Look at similar tests in the same module
4. **Keep it focused**: One test = one behavior
5. **Name it clearly**: `it("blocks path traversal via ../")` not `it("test1")`

### PR Checklist for Tests

When adding tests in a PR:

- [ ] Tests pass locally (`pnpm test && cd src-tauri && cargo test`)
- [ ] Tests cover the stated bug/feature
- [ ] Tests follow existing naming and structure patterns
- [ ] No excessive mocking (prefer real implementations where reasonable)
- [ ] Platform-specific tests use `#[cfg]` or conditional logic
- [ ] Security tests verify both allow and deny cases
- [ ] CI will run tests on all platforms (checked via GitHub Actions)

### Test Quality Bar

Good tests are:
- **Fast**: <10ms unit tests, <1s integration tests
- **Reliable**: No flaky timing-dependent logic
- **Readable**: Clear names, obvious assertions
- **Isolated**: No shared state between tests
- **Maintainable**: Update easily when implementation changes

Bad tests:
- Snapshot tests of generated HTML (brittle)
- Tests that rely on external services
- Tests that require specific hardware/OS
- Tests with complex mocking that mirror implementation

## Resources

### Documentation
- **Vitest**: https://vitest.dev/
- **Rust testing**: https://doc.rust-lang.org/book/ch11-00-testing.html
- **React Testing Library**: https://testing-library.com/react

### Terax-Specific
- **TERAX.md**: Architecture overview
- **CONTRIBUTING.md**: Code standards and PR process
- **SECURITY.md**: Security reporting guidelines

### Example Tests to Learn From
- `src/modules/ai/lib/security.test.ts` — Security function testing
- `src/modules/terminal/lib/osc-handlers.test.ts` — OSC parsing
- `src-tauri/src/modules/shell/ringbuffer.rs` — Rust unit tests
- `src-tauri/src/modules/git/parser.rs` — Git parsing tests

---

**Questions or improvements?** Open an issue or discuss in [Discord](https://discord.gg/tyveTUyEp7).
