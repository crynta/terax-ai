# terax-shell-integration (PowerShell)
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D so the host tracks cwd and prompt
# boundaries. C comes from a PSConsoleHostReadLine wrapper (PowerShell has no
# preexec hook).

if ($global:__TERAX_HOOKS_LOADED) { return }
$global:__TERAX_HOOKS_LOADED = $true

try {
    [Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $global:OutputEncoding    = [System.Text.UTF8Encoding]::new($false)
} catch {}

if (Test-Path Function:prompt) {
    Copy-Item Function:prompt Function:__terax_user_prompt -Force -ErrorAction SilentlyContinue
}

function global:__terax_urlencode {
    param([string]$s)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
    $sb = [System.Text.StringBuilder]::new($bytes.Length)
    foreach ($b in $bytes) {
        if (($b -ge 0x30 -and $b -le 0x39) -or
            ($b -ge 0x41 -and $b -le 0x5A) -or
            ($b -ge 0x61 -and $b -le 0x7A) -or
            $b -eq 0x2F -or $b -eq 0x2E -or $b -eq 0x5F -or
            $b -eq 0x7E -or $b -eq 0x2D) {
            [void]$sb.Append([char]$b)
        } else {
            [void]$sb.AppendFormat('%{0:X2}', $b)
        }
    }
    $sb.ToString()
}

# Wrap PSConsoleHostReadLine (defined by PSReadLine) to emit OSC 133 C with
# the accepted command line just before execution. Installed lazily from
# prompt: PSReadLine may finish loading only after this profile has run.
function global:__terax_install_readline {
    if ($global:__terax_readline_done) { return }
    if (-not (Test-Path Function:PSConsoleHostReadLine)) { return }
    $global:__terax_readline_done = $true
    # global: is required -- a plain Function: copy made inside a function
    # lands in its local scope and vanishes when it returns, leaving the
    # wrapper calling a missing command on every read (empty-input loop).
    Copy-Item Function:PSConsoleHostReadLine Function:global:__terax_user_readline -Force
    function global:PSConsoleHostReadLine {
        try {
            $line = __terax_user_readline
        } catch {
            # Self-heal: restore the original reader so a broken wrapper can
            # never lock the shell out of input.
            Copy-Item Function:__terax_user_readline Function:global:PSConsoleHostReadLine -Force
            return ''
        }
        try {
            if ($line -is [string] -and $line.Trim().Length -gt 0) {
                $global:__terax_block_seen = $true
                $esc = [char]27
                $cmd = $line -replace '[\x00-\x1F\x7F]', ' '
                if ($cmd.Length -gt 256) { $cmd = $cmd.Substring(0, 256) }
                [Console]::Write("$esc]133;C;$cmd$esc\")
            }
        } catch {}
        $line
    }
}

function global:prompt {
    __terax_install_readline
    $lec = $LASTEXITCODE
    if ($null -eq $lec) { $lec = if ($?) { 0 } else { 1 } }
    $esc = [char]27

    $oscD = "$esc]133;D;$lec$esc\"
    $oscA = "$esc]133;A$esc\"
    $oscB = "$esc]133;B$esc\"

    $loc = Get-Location
    $osc7 = ''
    if ($loc.Provider.Name -eq 'FileSystem') {
        $cwd = $loc.ProviderPath -replace '\\','/'
        if ($cwd -match '^[A-Za-z]:') { $cwd = "/$cwd" }
        $cwdEnc = __terax_urlencode $cwd
        $hostName = [System.Environment]::MachineName
        $osc7 = "$esc]7;file://$hostName$cwdEnc$esc\"
    }

    # Block mode: the host renders its own input bar, so suppress the shell
    # prompt (markers only) and reserve the header/gap rows in the prompt
    # itself -- same layout contract as the zsh integration.
    if ($env:TERAX_BLOCKS) {
        $global:LASTEXITCODE = $lec
        $gap = if ($global:__terax_block_seen) { "`n`n" } else { "`n" }
        return "$oscD$oscA$osc7$gap$oscB"
    }

    $original = if (Test-Path Function:__terax_user_prompt) {
        try { & __terax_user_prompt } catch { "PS $((Get-Location).Path)> " }
    } else {
        "PS $((Get-Location).Path)> "
    }

    $global:LASTEXITCODE = $lec
    "$oscD$oscA$osc7${original}${oscB}"
}
