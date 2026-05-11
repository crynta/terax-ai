# terax-shell-integration (PowerShell)
# Emits OSC 7 (cwd) + OSC 133 A/B/D so the host tracks cwd and prompt boundaries.

if ($global:__TERAX_HOOKS_LOADED) { return }
$global:__TERAX_HOOKS_LOADED = $true

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

function global:terax-preview {
    param([Parameter(Mandatory=$true)][string]$Url)
    $esc = [char]27
    $enc = __terax_urlencode $Url
    Write-Host -NoNewline "$esc]8888;url=$enc;target=preview$esc\"
}

function global:terax-open {
    param([Parameter(Mandatory=$true)][string]$Url)
    terax-preview $Url
}

function global:terax-open-browser {
    param([Parameter(Mandatory=$true)][string]$Url)
    $esc = [char]27
    $enc = __terax_urlencode $Url
    Write-Host -NoNewline "$esc]8888;url=$enc;target=browser$esc\"
}

function global:terax-remote-cwd {
    param([Parameter(Mandatory=$true)][string]$Cwd)
    if (-not $Cwd.StartsWith('ssh://')) {
        Write-Error 'usage: terax-remote-cwd ssh://host/path'
        return
    }
    $esc = [char]27
    $enc = __terax_urlencode $Cwd
    Write-Host -NoNewline "$esc]8888;remote-cwd=$enc$esc\"
}
