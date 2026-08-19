# deadtime installer for Windows -- wires a status line into Claude Code that
# shows useful tips and occasional disclosed sponsor lines. Nothing about
# your machine is patched; this uses Claude Code's own supported statusLine
# setting. Same real mechanism as the macOS/Linux installer, just PowerShell
# instead of bash and Windows paths instead of Unix ones.
$ErrorActionPreference = "Stop"

$Server = "https://deadtime-server.bean-picker.workers.dev"
$InstallDir = Join-Path $HOME ".deadtime-client"
$StateDir = Join-Path $HOME ".deadtime"

Write-Host "deadtime: installing to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Generate the real install ID right here, on the device, the moment an
# install actually happens -- not guessed ahead of time by the website.
# Only if one doesn't already exist, so re-running this script never
# clobbers an existing install's history with a fresh random ID.
$stateIdPath = Join-Path $StateDir "install_id"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
if (-not (Test-Path $stateIdPath)) {
    ([guid]::NewGuid().ToString()) | Set-Content -Path $stateIdPath -NoNewline -Encoding utf8
}
$InstallId = (Get-Content -Path $stateIdPath -Raw).Trim()

Invoke-WebRequest -Uri "$Server/statusline.py" -OutFile (Join-Path $InstallDir "statusline.py") -UseBasicParsing

# Find a real, working Python on PATH. Windows installs vary --
# python.org's installer usually gives you "python", the Microsoft Store
# version and some setups give "py", plenty of people still have "python3"
# from WSL-adjacent tooling. Try all three rather than assuming one.
$PythonCmd = $null
foreach ($candidate in @("python", "py", "python3")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $PythonCmd = $candidate
        break
    }
}
if (-not $PythonCmd) {
    Write-Host "deadtime: couldn't find Python on your PATH."
    Write-Host "deadtime: install it from https://python.org (check 'Add to PATH' during setup), then run this installer again."
    exit 1
}

# certifi is a nice-to-have, not a hard requirement -- statusline.py falls
# back to Windows's own certificate store if it's missing. Never let a
# failed pip install here take down the rest of the setup.
$certifiCheck = & $PythonCmd -c "import certifi" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "deadtime: installing certifi (helps with HTTPS, not required)..."
    & $PythonCmd -m pip install --quiet certifi 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "deadtime: couldn't install certifi, continuing without it (statusline.py falls back automatically)"
    }
}

# Wire the statusLine setting into Claude Code's real settings.json --
# same file, same setting, same mechanism as every other platform. Built
# natively in PowerShell (no python JSON round-trip needed) so this stays
# readable even if someone's Python is in a weird state.
$SettingsDir = Join-Path $HOME ".claude"
$SettingsPath = Join-Path $SettingsDir "settings.json"
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null

$settings = [ordered]@{}
if (Test-Path $SettingsPath) {
    $raw = Get-Content $SettingsPath -Raw
    if ($raw.Trim()) {
        $parsed = $raw | ConvertFrom-Json
        $parsed.PSObject.Properties | ForEach-Object { $settings[$_.Name] = $_.Value }
    }
}

$scriptPath = Join-Path $InstallDir "statusline.py"
$settings["statusLine"] = [ordered]@{
    type    = "command"
    command = "$PythonCmd `"$scriptPath`""
}

($settings | ConvertTo-Json -Depth 10) | Set-Content -Path $SettingsPath -Encoding utf8

Write-Host "deadtime: wired into $SettingsPath"
Write-Host "deadtime: installed. Restart Claude Code (close and reopen your terminal) to see it live."
Write-Host "deadtime: to check earnings or register a payout email later, run:"
Write-Host "  $PythonCmd `"$scriptPath`" --claim"

# Open the browser straight to the claim page -- same pattern as
# `gh auth login` / `vercel login` / `wrangler login`. This is the only
# honest way for the website to know an install actually happened: it
# fires because this script really did just write a real install ID,
# not because someone merely copied a command. Never let a headless/
# remote (RDP without a session, CI) environment fail the install over this.
$ClaimUrl = "$Server/claim.html?id=$InstallId"
try {
    Start-Process $ClaimUrl | Out-Null
} catch {
    Write-Host "deadtime: open this to see your live balance: $ClaimUrl"
}
