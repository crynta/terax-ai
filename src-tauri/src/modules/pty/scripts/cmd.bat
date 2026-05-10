@echo off
REM terax-shell-integration (CMD)
REM
REM CMD doesn't have proper prompt hooks like Unix shells or PowerShell.
REM We set the PROMPT to include a marker and rely on TERM for xterm compatibility.
REM
REM OSC 7 (cwd) is best-effort - CMD doesn't support it natively.
REM For full shell integration, use PowerShell or Git Bash.

REM Set prompt to include $P (full path) and $G (>)
REM The prompt is set via the PROMPT environment variable at spawn time
REM This is a minimal integration - full OSC support requires PowerShell or Git Bash

if defined TERAX_CMD_INIT (
    REM Terax-initiated CMD session
    set TERAX_CMD_INIT=
)

REM Basic xterm-compatible prompt
PROMPT $P$G