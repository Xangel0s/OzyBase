param(
  [string]$ApiPort = "8090",
  [string]$UiPort = "5342",
  [string]$EmbeddedPort = "5543",
  [string]$AdminEmail = "admin@ozybase.local",
  [string]$AdminPassword = "OzyBase123!"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      try {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      } catch {
      }
    }
  }
}

function Wait-HttpHealthy {
  param(
    [string]$Url,
    [int]$Attempts = 120
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -UseBasicParsing $Url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
    }
  }

  throw "Timeout waiting for $Url"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendDir = Join-Path $repoRoot "frontend"
$runId = Get-Date -Format "yyyyMMddHHmmss"
$embeddedRootName = "ozybase-local-persist"
$embeddedRoot = Join-Path $env:TEMP $embeddedRootName
$embeddedDataPath = Join-Path $embeddedRoot "pg_data_live"
$embeddedBinPath = Join-Path $embeddedRoot "bin"
$apiBinary = Join-Path $env:TEMP "ozybase-live-$runId.exe"
$apiLog = Join-Path $env:TEMP "ozybase-live-api-$runId.out.log"
$apiErrLog = Join-Path $env:TEMP "ozybase-live-api-$runId.err.log"
$uiLog = Join-Path $env:TEMP "ozybase-live-ui-$runId.out.log"
$uiErrLog = Join-Path $env:TEMP "ozybase-live-ui-$runId.err.log"

Stop-PortListeners -Ports @([int]$ApiPort, [int]$UiPort, [int]$EmbeddedPort)
New-Item -ItemType Directory -Force -Path $embeddedBinPath | Out-Null

go build -o $apiBinary ./cmd/OzyBase

$env:PORT = $ApiPort
$env:SITE_URL = "http://127.0.0.1:$ApiPort"
$env:APP_DOMAIN = "localhost"
$env:ALLOWED_ORIGINS = "http://127.0.0.1:$UiPort,http://localhost:$UiPort"
$env:OZY_EMBEDDED_ROOT = $embeddedRoot
$env:OZY_EMBEDDED_DATA_PATH = $embeddedDataPath
$env:OZY_EMBEDDED_BIN_PATH = $embeddedBinPath
$env:OZY_EMBEDDED_PORT = $EmbeddedPort
$env:OZY_AUTO_BOOTSTRAP_ADMIN = "true"
$env:INITIAL_ADMIN_EMAIL = $AdminEmail
$env:INITIAL_ADMIN_PASSWORD = $AdminPassword
$env:E2E_ADMIN_EMAIL = $AdminEmail
$env:E2E_ADMIN_PASSWORD = $AdminPassword
$env:DEBUG = "false"
$env:OZY_SKIP_DOTENV = "true"
$env:RATE_LIMIT_RPS = "120"
$env:RATE_LIMIT_BURST = "240"

$apiProc = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health"

$uiProc = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", $UiPort, "--strictPort") -WorkingDirectory $frontendDir -PassThru -RedirectStandardOutput $uiLog -RedirectStandardError $uiErrLog
Wait-HttpHealthy -Url "http://127.0.0.1:$UiPort"

[pscustomobject]@{
  repo_root = $repoRoot
  backend_workdir = $repoRoot
  frontend_workdir = $frontendDir
  ui_url = "http://127.0.0.1:$UiPort"
  api_url = "http://127.0.0.1:$ApiPort"
  admin_email = $AdminEmail
  admin_password = $AdminPassword
  api_pid = $apiProc.Id
  ui_pid = $uiProc.Id
  api_log = $apiLog
  api_err = $apiErrLog
  ui_log = $uiLog
  ui_err = $uiErrLog
  api_binary = $apiBinary
  embedded_root = $embeddedRoot
} | ConvertTo-Json -Depth 4
