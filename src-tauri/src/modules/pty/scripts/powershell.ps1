# terax-shell-integration (PowerShell)
#
# Provides OSC 7 (cwd) and OSC 133 (prompt markers) for shell integration.

if (-not $env:TERAX_HOOKS_LOADED) {
  $env:TERAX_HOOKS_LOADED = '1'

  function _terax_urlencode {
    param([string]$Text)
    $encoded = ''
    foreach ($c in $Text.ToCharArray()) {
      if ($c -match '[a-zA-Z0-9/._~-]') {
        $encoded += $c
      } else {
        $encoded += ('%%%02X' -f [int]$c)
      }
    }
    return $encoded
  }

  # Override prompt function to emit OSC 7 with cwd
  if (Test-Path function:prompt) {
    $script:TERAX_ORIG_PROMPT = (Get-Command prompt).ScriptBlock
  }

  function global:prompt {
    $cwd = (Get-Location).Path
    $hostName = $env:COMPUTERNAME
    $esc = [char]27

    # OSC 7 - current working directory
    $cwd_osc = "$esc]7;file://$hostName$($cwd -replace '\\', '/')$esc\"

    # OSC 133 D - command done with exit code
    $exit_osc = "$esc]133;D;$LASTEXITCODE$esc\"

    # OSC 133 A - prompt start
    $start_osc = "$esc]133;A$esc\"

    # OSC 133 B - shell integration start (replaces PS1)
    $ps1_prefix = "$esc]133;B$esc\"

    # Build the prompt with markers
    $prompt_text = & $script:TERAX_ORIG_PROMPT 2>$null
    if (-not $prompt_text) {
      $prompt_text = "$pwd> "
    }

    return "$exit_osc$cwd_osc$start_osc$ps1_prefix$prompt_text"
  }

  # Also emit OSC 133 C (pre-exec) via Invoke-PSCommand
  # PowerShell doesn't have a perfect pre-exec hook like zsh, but we can
  # use the prompt to emit the markers.
}