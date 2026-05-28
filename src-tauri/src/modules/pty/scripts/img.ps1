# terax-shell-integration (img) — iTerm inline image protocol (PNG, JPEG, GIF first frame).
if (-not $global:__TERAX_MEDIA_LOADED) {
    if ($env:TERAX_TERMINAL) {
        $global:__TERAX_MEDIA_LOADED = $true
        function global:img {
            param(
                [Parameter(Mandatory = $true, Position = 0)]
                [string]$Path
            )
            $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
            if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                Write-Error "img: not found: $Path"
                return
            }
            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $b64 = [Convert]::ToBase64String($bytes)
            $esc = [char]27
            Write-Host -NoNewline "$esc]1337;File=inline=1:$b64$([char]7)"
        }
    }
}
