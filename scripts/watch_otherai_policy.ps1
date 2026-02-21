param(
  [string]$Branch = "otherai-live",
  [int]$PollSeconds = 8,
  [int]$Games = 200
)

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not (Test-Path ".git")) {
  Write-Host "Not a git repo: $repo" -ForegroundColor Red
  exit 1
}

function Get-PolicyHash {
  if (Test-Path "policies/otherai.js") {
    return (Get-FileHash "policies/otherai.js" -Algorithm SHA256).Hash
  }
  return "missing"
}

Write-Host "[watcher] repo=$repo branch=$Branch poll=${PollSeconds}s games=$Games" -ForegroundColor Yellow

git checkout $Branch | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed to checkout branch '$Branch'" -ForegroundColor Red
  exit 1
}

$lastHash = Get-PolicyHash
Write-Host "[watcher] initial policy hash: $lastHash" -ForegroundColor DarkGray
Write-Host "[watcher] running initial benchmark..." -ForegroundColor Yellow
& "$PSScriptRoot\run_otherai_bench.ps1" -Games $Games

while ($true) {
  Start-Sleep -Seconds $PollSeconds

  git fetch origin $Branch | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[watcher] fetch failed; retrying..." -ForegroundColor DarkYellow
    continue
  }

  $before = (git rev-parse HEAD).Trim()
  git pull --rebase origin $Branch | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[watcher] pull failed; attempting rebase abort..." -ForegroundColor DarkYellow
    git rebase --abort | Out-Null
    continue
  }
  $after = (git rev-parse HEAD).Trim()

  $newHash = Get-PolicyHash
  $changed = ($newHash -ne $lastHash)

  if ($before -ne $after) {
    Write-Host "[watcher] new commit: $after" -ForegroundColor Green
  }

  if ($changed) {
    Write-Host "[watcher] policy changed -> benchmarking" -ForegroundColor Green
    $lastHash = $newHash
    & "$PSScriptRoot\run_otherai_bench.ps1" -Games $Games
  }
}
