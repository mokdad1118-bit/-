#Requires -Version 5.1
<#
  استخدام:
    1) أنشئ Personal Access Token من GitHub: Settings → Developer settings → Fine-grained أو classic (صلاحية repo).
    2) في PowerShell:
         $env:GH_TOKEN = "ghp_...."
         .\scripts\push-to-github.ps1
    أو:
         .\scripts\push-to-github.ps1 -Token "ghp_...."
#>
param(
  [string]$RepoName = "adora-ecommerce",
  [string]$Token = "",
  [switch]$Private
)

$ErrorActionPreference = "Stop"
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$git = "C:\Program Files\Git\bin\git.exe"

if (-not (Test-Path $gh)) { throw "GitHub CLI not found: $gh" }
if (-not (Test-Path $git)) { throw "Git not found: $git" }

$t = $Token
if (-not $t) { $t = [Environment]::GetEnvironmentVariable("GH_TOKEN", "Process") }
if (-not $t) { $t = [Environment]::GetEnvironmentVariable("GH_TOKEN", "User") }
if (-not $t) { $t = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "Process") }
if (-not $t) { $t = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "User") }

if (-not $t) {
  Write-Host @"

GH_TOKEN not set. Create a token: https://github.com/settings/tokens (repo scope)
Then run:
  `$env:GH_TOKEN = 'ghp_xxxxxxxx'
  .\scripts\push-to-github.ps1

"@ -ForegroundColor Yellow
  exit 1
}

$t | & $gh auth login --with-token 2>&1 | Out-Host
& $gh auth status

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

& $git branch -M main 2>$null

# إن وُجد remote قديم
$remotes = & $git remote 2>$null
if ($remotes -match "origin") {
  & $git remote remove origin
}

$desc = "Adora: Node Express + SQLite + static frontend"
if ($Private) {
  & $gh repo create $RepoName --private --source=. --remote=origin --push --description $desc
} else {
  & $gh repo create $RepoName --public --source=. --remote=origin --push --description $desc
}

Write-Host "`nDone. Repository URL:" -ForegroundColor Green
& $gh repo view --json url -q .url
