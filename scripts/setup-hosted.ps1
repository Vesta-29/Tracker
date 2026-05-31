$ErrorActionPreference = "Stop"

if (Test-Path ".env.local") {
  foreach ($line in Get-Content ".env.local") {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $name, $value = $line -split "=", 2
    if (-not [Environment]::GetEnvironmentVariable($name.Trim())) {
      Set-Item -Path "Env:$($name.Trim())" -Value $value.Trim().Trim('"').Trim("'")
    }
  }
}

$required = @(
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INITIAL_ADMIN_EMAIL"
)
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "Set $name before running scripts/setup-hosted.ps1."
  }
}

$supabaseUrl = [Uri]$env:SUPABASE_URL
if ($supabaseUrl.AbsolutePath.TrimEnd("/") -ne "") {
  throw "SUPABASE_URL must be the project base URL, without a path such as /rest/v1."
}

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE." }
}

Invoke-Checked { npx supabase link --project-ref $env:SUPABASE_PROJECT_REF -p $env:SUPABASE_DB_PASSWORD }
Invoke-Checked { npx supabase db push -p $env:SUPABASE_DB_PASSWORD }
Invoke-Checked { npm run seed:psgc }
Invoke-Checked { npm run seed:psgc }
Invoke-Checked { npm run seed:references }
Invoke-Checked { npm run seed:references }
Invoke-Checked { npm run bootstrap:admin }

Write-Host "Hosted Supabase setup complete."
