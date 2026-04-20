param(
  [string]$ApiPort = "8090",
  [string]$AdminEmail = "",
  [string]$AdminPassword = "",
  [string]$SummaryPath = "",
  [int]$BenchRows = 50000,
  [int]$BenchIterations = 20,
  [int]$BenchWorkers = 20,
  [int]$ConcurrentWriters = 10,
  [int]$RowsPerWriter = 100,
  [int]$StorageObjects = 200,
  [int]$StorageObjectSizeKB = 8,
  [int]$UploadConcurrency = 5,
  [switch]$SkipBenchmark,
  [switch]$SkipCleanup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $requestParams = @{
    Method      = $Method
    Uri         = $Url
    Headers     = $Headers
    ErrorAction = "Stop"
  }

  if ($null -ne $Body) {
    $requestParams["ContentType"] = "application/json"
    $requestParams["Body"] = ($Body | ConvertTo-Json -Depth 12)
  }

  return Invoke-RestMethod @requestParams
}

function Try-Login {
  param([string]$BaseUrl)

  $candidateEmails = @()
  if (-not [string]::IsNullOrWhiteSpace($AdminEmail)) {
    $candidateEmails += $AdminEmail
  }
  $candidateEmails += @("admin@ozybase.local", "system@ozybase.local")
  $candidateEmails = $candidateEmails | Select-Object -Unique

  $candidatePasswords = @()
  if (-not [string]::IsNullOrWhiteSpace($AdminPassword)) {
    $candidatePasswords += $AdminPassword
  }
  $candidatePasswords += @("OzyBase123!", "OzyBase1234!")
  $candidatePasswords = $candidatePasswords | Select-Object -Unique

  foreach ($email in $candidateEmails) {
    foreach ($password in $candidatePasswords) {
      try {
        $response = Invoke-Api -Method "POST" -Url "$BaseUrl/api/auth/login" -Body @{
          email    = $email
          password = $password
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$response.token)) {
          return [pscustomobject]@{
            Email    = $email
            Password = $password
            Token    = [string]$response.token
          }
        }
      } catch {
      }
    }
  }

  throw "failed to login with known local credentials"
}

function Resolve-Workspace {
  param(
    [string]$BaseUrl,
    [string]$Token
  )

  $authHeaders = @{ Authorization = "Bearer $Token" }
  $workspaces = Invoke-Api -Method "GET" -Url "$BaseUrl/api/workspaces" -Headers $authHeaders
  if ($workspaces -is [System.Array] -and $workspaces.Count -gt 0 -and $workspaces[0].id) {
    return [string]$workspaces[0].id
  }

  $bootstrap = Invoke-Api -Method "POST" -Url "$BaseUrl/api/workspaces/bootstrap" -Headers $authHeaders
  if (-not [string]::IsNullOrWhiteSpace([string]$bootstrap.workspace_id)) {
    return [string]$bootstrap.workspace_id
  }

  throw "failed to resolve workspace id"
}

function Write-RandomFile {
  param(
    [string]$Path,
    [int]$SizeBytes,
    [System.Security.Cryptography.RandomNumberGenerator]$Random
  )

  $bytes = New-Object byte[]($SizeBytes)
  $Random.GetBytes($bytes)
  [System.IO.File]::WriteAllBytes($Path, $bytes)
}

function Start-CurlJob {
  param(
    [string]$Label,
    [string[]]$Arguments,
    [string[]]$ExpectedStatuses
  )

  $safeLabel = ($Label -replace '[^A-Za-z0-9_.-]', '_')
  $stdout = Join-Path $env:TEMP "$safeLabel.stdout.log"
  $stderr = Join-Path $env:TEMP "$safeLabel.stderr.log"
  $escapedArguments = @($Arguments | ForEach-Object {
    if ($_ -match '\s' -and $_ -notmatch '^".*"$') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  })
  $process = Start-Process -FilePath "curl.exe" -ArgumentList $escapedArguments -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  return [pscustomobject]@{
    Label            = $Label
    Process          = $process
    StdOut           = $stdout
    StdErr           = $stderr
    ExpectedStatuses = $ExpectedStatuses
  }
}

function Wait-CurlJobs {
  param([object[]]$Jobs)

  foreach ($job in $Jobs) {
    if ($null -eq $job) {
      continue
    }
    $job.Process.WaitForExit()
    $stdoutRaw = if (Test-Path $job.StdOut) { Get-Content $job.StdOut -Raw -ErrorAction SilentlyContinue } else { "" }
    $stderrRaw = if (Test-Path $job.StdErr) { Get-Content $job.StdErr -Raw -ErrorAction SilentlyContinue } else { "" }
    $stdout = if ($null -eq $stdoutRaw) { "" } else { ([string]$stdoutRaw).Trim() }
    $stderr = if ($null -eq $stderrRaw) { "" } else { ([string]$stderrRaw).Trim() }

    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      throw "curl job '$($job.Label)' failed: $stderr"
    }
    if ($job.ExpectedStatuses.Count -gt 0 -and $stdout -notin $job.ExpectedStatuses) {
      throw "curl job '$($job.Label)' returned unexpected HTTP status '$stdout'"
    }
  }
}

function New-UploadSession {
  param(
    [string]$BaseUrl,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$BucketName,
    [string]$FileName,
    [int64]$FileSize
  )

  return Invoke-Api -Method "POST" -Url "$BaseUrl/api/files/uploads/session" -Headers @{
    Authorization    = "Bearer $Token"
    "X-Workspace-Id" = $WorkspaceId
  } -Body @{
    bucket       = $BucketName
    filename     = $FileName
    size         = $FileSize
    content_type = "application/octet-stream"
  }
}

function Start-UploadJob {
  param(
    [string]$Label,
    [string]$BaseUrl,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$UploadPath,
    [string]$UploadToken,
    [string]$FilePath
  )

  $uploadUrl = "$BaseUrl$UploadPath"
  return Start-CurlJob -Label $Label -ExpectedStatuses @("200", "201") -Arguments @(
    "-sS",
    "-o", "NUL",
    "-w", "%{http_code}",
    "-X", "PUT",
    $uploadUrl,
    "-H", "Authorization: Bearer $Token",
    "-H", "X-Workspace-Id: $WorkspaceId",
    "-H", "X-Ozy-Upload-Token: $UploadToken",
    "--data-binary", "@$FilePath"
  )
}

function Start-SqlJob {
  param(
    [string]$Label,
    [string]$BaseUrl,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$Query,
    [string]$PayloadPath
  )

  $payload = @{ query = $Query } | ConvertTo-Json -Depth 6
  Set-Content -Path $PayloadPath -Value $payload -Encoding ASCII
  return Start-CurlJob -Label $Label -ExpectedStatuses @("200") -Arguments @(
    "-sS",
    "-o", "NUL",
    "-w", "%{http_code}",
    "-X", "POST",
    "$BaseUrl/api/sql",
    "-H", "Authorization: Bearer $Token",
    "-H", "X-Workspace-Id: $WorkspaceId",
    "-H", "Content-Type: application/json",
    "--data-binary", "@$PayloadPath"
  )
}

$baseUrl = "http://127.0.0.1:$ApiPort"
$suffix = (Get-Date).ToString("HHmmss")
$tableName = "qa_local_real_$suffix"
$bucketName = "qa_local_bucket_$suffix"
$workspaceRoot = Join-Path $env:TEMP "ozybase-local-real-app-$suffix"
$storageRoot = Join-Path $workspaceRoot "storage"
$payloadRoot = Join-Path $workspaceRoot "payloads"
$rng = $null

try {
  Write-Step "Check local system"
  $status = Invoke-Api -Method "GET" -Url "$baseUrl/api/system/status"
  if (-not $status.initialized) {
    throw "local system is not initialized on $baseUrl"
  }

  Write-Step "Login and workspace"
  $login = Try-Login -BaseUrl $baseUrl
  $token = $login.Token
  $workspaceId = Resolve-Workspace -BaseUrl $baseUrl -Token $token
  $authHeaders = @{
    Authorization    = "Bearer $token"
    "X-Workspace-Id" = $workspaceId
  }

  Write-Step "Realtime status"
  $realtimeStatus = Invoke-Api -Method "GET" -Url "$baseUrl/api/project/realtime/status" -Headers $authHeaders
  if ([string]::IsNullOrWhiteSpace([string]$realtimeStatus.node_id)) {
    throw "realtime status did not return node_id"
  }

  if (-not $SkipBenchmark) {
    Write-Step "50k benchmark with 20 concurrent readers"
    & go run ./cmd/ozybase-bench -base-url $baseUrl -email $login.Email -password $login.Password -rows $BenchRows -iterations $BenchIterations -workers $BenchWorkers
    if ($LASTEXITCODE -ne 0) {
      throw "cmd/ozybase-bench failed"
    }
  }

  Write-Step "Create wide real-app table"
  $schema = @(
    @{ name = "title"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "amount"; type = "int8"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "status"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "owner"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "notes"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c01"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c02"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c03"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c04"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c05"; type = "int4"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c06"; type = "int4"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c07"; type = "bool"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c08"; type = "bool"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c09"; type = "timestamp"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c10"; type = "timestamp"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c11"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c12"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c13"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c14"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null },
    @{ name = "c15"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null }
  )

  $collection = Invoke-Api -Method "POST" -Url "$baseUrl/api/collections" -Headers $authHeaders -Body @{
    name             = $tableName
    display_name     = $tableName
    schema           = $schema
    rls_enabled      = $false
    rls_rule         = ""
    rls_policies     = @{}
    realtime_enabled = $true
  }
  if ([string]::IsNullOrWhiteSpace([string]$collection.name)) {
    throw "failed to create wide test table"
  }

  Write-Step "10 concurrent writers"
  New-Item -ItemType Directory -Force -Path $workspaceRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null

  $writerJobs = @()
  $payloadFiles = @()
  for ($i = 1; $i -le $ConcurrentWriters; $i++) {
    $start = (($i - 1) * $RowsPerWriter) + 1
    $end = $i * $RowsPerWriter
    $payloadPath = Join-Path $payloadRoot ("writer-$i.json")
    $payloadFiles += $payloadPath
    $query = @"
INSERT INTO "$tableName" (title, amount, status, owner, notes, c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11, c12, c13, c14, c15)
SELECT
  'writer-$i-' || gs::text,
  gs,
  CASE WHEN gs % 2 = 0 THEN 'active' ELSE 'queued' END,
  'worker-$i',
  'local hardening',
  md5(gs::text),
  md5((gs + 1)::text),
  md5((gs + 2)::text),
  md5((gs + 3)::text),
  gs,
  gs + 1000,
  (gs % 2 = 0),
  (gs % 3 = 0),
  NOW(),
  NOW() + INTERVAL '1 minute',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon'
FROM generate_series($start, $end) AS gs;
"@
    $writerJobs += Start-SqlJob -Label "writer-$i" -BaseUrl $baseUrl -Token $token -WorkspaceId $workspaceId -Query $query -PayloadPath $payloadPath
  }
  Wait-CurlJobs -Jobs $writerJobs

  $rowCountResponse = Invoke-Api -Method "POST" -Url "$baseUrl/api/sql" -Headers $authHeaders -Body @{
    query = "SELECT COUNT(*)::int AS total FROM ""$tableName"""
  }
  $writtenRows = [int]($rowCountResponse.rows[0][0])
  if ($writtenRows -lt ($ConcurrentWriters * $RowsPerWriter)) {
    throw "concurrent writes inserted fewer rows than expected: $writtenRows"
  }

  Write-Step "Storage bucket with 200 objects and 5 concurrent uploads"
  Invoke-Api -Method "POST" -Url "$baseUrl/api/files/buckets" -Headers $authHeaders -Body @{
    name                        = $bucketName
    public                      = $true
    rls_enabled                 = $false
    rls_rule                    = ""
    max_file_size_bytes         = 0
    max_total_size_bytes        = 0
    lifecycle_delete_after_days = 0
  } | Out-Null

  New-Item -ItemType Directory -Force -Path $storageRoot | Out-Null
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $uploadPaths = @()
  $objectSizeBytes = $StorageObjectSizeKB * 1024
  for ($i = 1; $i -le $StorageObjects; $i++) {
    $path = Join-Path $storageRoot ("obj-{0:D4}.bin" -f $i)
    Write-RandomFile -Path $path -SizeBytes $objectSizeBytes -Random $rng
    $uploadPaths += $path
  }

  $uploaded = 0
  for ($offset = 0; $offset -lt $uploadPaths.Count; $offset += $UploadConcurrency) {
    $jobs = @()
    $upperBound = [Math]::Min($offset + $UploadConcurrency - 1, $uploadPaths.Count - 1)
    for ($index = $offset; $index -le $upperBound; $index++) {
      $path = $uploadPaths[$index]
      $fileInfo = Get-Item $path
      $session = New-UploadSession -BaseUrl $baseUrl -Token $token -WorkspaceId $workspaceId -BucketName $bucketName -FileName $fileInfo.Name -FileSize $fileInfo.Length
      $jobs += Start-UploadJob -Label "upload-$($fileInfo.BaseName)" -BaseUrl $baseUrl -Token $token -WorkspaceId $workspaceId -UploadPath ([string]$session.upload_url) -UploadToken ([string]$session.upload_token) -FilePath $path
    }
    Wait-CurlJobs -Jobs $jobs
    $uploaded += ($upperBound - $offset + 1)
  }

  $bucketObjects = Invoke-Api -Method "GET" -Url "$baseUrl/api/files?bucket=$bucketName" -Headers $authHeaders
  $bucketObjectCount = if ($bucketObjects -is [System.Array]) { $bucketObjects.Count } else { 0 }
  if ($bucketObjectCount -lt $StorageObjects) {
    throw "storage listing returned fewer objects than expected: $bucketObjectCount"
  }

  $summary = [pscustomobject]@{
    baseUrl               = $baseUrl
    workspaceId           = $workspaceId
    realtimeMode          = [string]$realtimeStatus.mode
    realtimeNodeId        = [string]$realtimeStatus.node_id
    benchmarkRows         = if ($SkipBenchmark) { 0 } else { $BenchRows }
    benchmarkWorkers      = if ($SkipBenchmark) { 0 } else { $BenchWorkers }
    writers               = $ConcurrentWriters
    rowsPerWriter         = $RowsPerWriter
    writtenRows           = $writtenRows
    storageBucket         = $bucketName
    storageObjectCount    = $bucketObjectCount
    uploadConcurrency     = $UploadConcurrency
    validatedAtUtc        = (Get-Date).ToUniversalTime().ToString("o")
  }

  Write-Step "Local real-app validation summary"
  $summaryJson = $summary | ConvertTo-Json -Depth 6
  if (-not [string]::IsNullOrWhiteSpace($SummaryPath)) {
    $summaryDir = Split-Path -Parent $SummaryPath
    if (-not [string]::IsNullOrWhiteSpace($summaryDir)) {
      New-Item -ItemType Directory -Force -Path $summaryDir | Out-Null
    }
    Set-Content -Path $SummaryPath -Value $summaryJson -Encoding ASCII
  }
  $summaryJson
}
finally {
  if ($null -ne $rng) {
    $rng.Dispose()
  }

  if (-not $SkipCleanup) {
    try {
      if ($token -and $workspaceId) {
        $cleanupHeaders = @{
          Authorization    = "Bearer $token"
          "X-Workspace-Id" = $workspaceId
        }
        if ($tableName) {
          Invoke-Api -Method "DELETE" -Url "$baseUrl/api/collections/$tableName" -Headers $cleanupHeaders | Out-Null
        }
        if ($bucketName) {
          Invoke-Api -Method "DELETE" -Url "$baseUrl/api/files/buckets/$bucketName" -Headers $cleanupHeaders | Out-Null
        }
      }
    } catch {
    }
  }

  if (Test-Path $workspaceRoot) {
    Remove-Item -LiteralPath $workspaceRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
