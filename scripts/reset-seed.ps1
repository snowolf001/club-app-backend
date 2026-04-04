param(
  [string]$DatabaseUrl
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
$envFile = Join-Path $projectRoot ".env"
$resetFile = Join-Path $projectRoot "sql\seeds\reset_dev.sql"

function Get-EnvValue {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if (-not (Test-Path $FilePath)) {
    return $null
  }

  $lines = Get-Content $FilePath

  foreach ($line in $lines) {
    $trimmed = $line.Trim()

    if ([string]::IsNullOrWhiteSpace($trimmed)) {
      continue
    }

    if ($trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^\s*$Key\s*=\s*(.*)\s*$") {
      $value = $matches[1].Trim()

      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      return $value
    }
  }

  return $null
}

if (-not $DatabaseUrl) {
  $DatabaseUrl = Get-EnvValue -FilePath $envFile -Key "DATABASE_URL"
}

if (-not $DatabaseUrl) {
  Write-Host "❌ DATABASE_URL not found"
  Write-Host "Checked: $envFile"
  exit 1
}

if (-not (Test-Path $resetFile)) {
  Write-Host "❌ Reset file not found: $resetFile"
  exit 1
}

Write-Host "🔄 Resetting dev data..."
Write-Host "Env file: $envFile"
Write-Host "Reset file: $resetFile"
Write-Host ""

psql $DatabaseUrl -f $resetFile

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "❌ Reset failed"
  exit 1
}

Write-Host ""
Write-Host "✅ Reset completed successfully"
