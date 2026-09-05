@echo off
REM terax-shell-integration (cmd.exe)
REM Emits OSC 7 (cwd) + OSC 133 A/B/D so the host tracks cwd and prompt
REM boundaries. cmd has no preexec hook, so OSC 133 C is omitted; D/A still
REM reset in-command state and B marks the prompt as "inside a command"
REM the same way profile.ps1 does.

if defined __TERAX_HOOKS_LOADED goto :eof
set "__TERAX_HOOKS_LOADED=1"

if defined TERAX_CLI if exist "%TERAX_CLI%" doskey terax="%TERAX_CLI%" $*

if not defined PROMPT set "PROMPT=$P$G"

echo %PROMPT% | findstr /C:"133;A" >nul
if not errorlevel 1 goto :eof

if defined TERAX_BLOCKS (
  prompt $E]133;D$E\$E]133;A$E\$E]7;file://%COMPUTERNAME%/$P$E\$_$E]133;B$E\
  goto :eof
)

prompt $E]133;D$E\$E]133;A$E\$E]7;file://%COMPUTERNAME%/$P$E\%PROMPT%$E]133;B$E\