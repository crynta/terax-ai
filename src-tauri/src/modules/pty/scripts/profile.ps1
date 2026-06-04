# terax-shell-integration (PowerShell)
# Emits OSC 7 (cwd) + OSC 133 A/B/D so the host tracks cwd and prompt boundaries.

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

function global:__terax_emit_preexec {
    param([string]$line)
    if ([string]::IsNullOrWhiteSpace($line)) { return $true }
    $esc = [char]27
    $cmd = $line -replace '[\x00-\x1f\x7f]', ' '
    if ($cmd.Length -gt 256) { $cmd = $cmd.Substring(0, 256) }
    try {
        [Console]::Write("$esc]133;C;$cmd$esc\")
    } catch {}
    return $true
}

try {
    if (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) {
        $global:__TERAX_USER_ADD_TO_HISTORY_HANDLER = (Get-PSReadLineOption).AddToHistoryHandler
        Set-PSReadLineOption -AddToHistoryHandler {
            param([string]$line)
            __terax_emit_preexec $line | Out-Null
            $handler = $global:__TERAX_USER_ADD_TO_HISTORY_HANDLER
            if ($null -ne $handler) {
                try { return [bool](& $handler $line) } catch { return $true }
            }
            return $true
        }
    }
} catch {}

function global:prompt {
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

    $original = if (Test-Path Function:__terax_user_prompt) {
        try { & __terax_user_prompt } catch { "PS $((Get-Location).Path)> " }
    } else {
        "PS $((Get-Location).Path)> "
    }

    $global:LASTEXITCODE = $lec
    "$oscD$oscA$osc7${original}${oscB}"
}
