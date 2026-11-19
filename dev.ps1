<#
.SYNOPSIS
    VDaAgent PoC development tasks (PowerShell equivalent to Makefile).
.DESCRIPTION
    Every tool runs in Docker; nothing is installed on the host.
    Getting started: .\dev.ps1 setup -> fill .env and credentials, .\dev.ps1 check -> .\dev.ps1 up.
.PARAMETER Command
    Target command: help, setup, check, up, down, logs, test, test-backend, test-workspace,
    test-frontend, test-live, test-clean, e2e, lint, format, lock, eval.
.EXAMPLE
    .\dev.ps1 help
.EXAMPLE
    .\dev.ps1 setup
.EXAMPLE
    .\dev.ps1 check
.EXAMPLE
    .\dev.ps1 up
.EXAMPLE
    .\dev.ps1 test-workspace -v
.EXAMPLE
    .\dev.ps1 test-backend -k test_health
#>

# Parse arguments without [CmdletBinding()] to prevent PowerShell from swallowing
# flags like -v (which matches -Verbose) or erroring on arbitrary CLI flags passed to targets.
$Command = "help"
$RestArgs = @()

if ($args.Count -gt 0) {
    if ($args[0] -in @("-Command", "--command", "-c") -and $args.Count -gt 1) {
        $Command = $args[1]
        if ($args.Count -gt 2) {
            $RestArgs = $args[2..($args.Count - 1)]
        }
    } else {
        $Command = $args[0]
        if ($args.Count -gt 1) {
            $RestArgs = $args[1..($args.Count - 1)]
        }
    }
}

$ErrorActionPreference = "Continue"

# Resolve repository root
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir -and $MyInvocation.MyCommand.Path) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $ScriptDir) {
    $ScriptDir = (Get-Location).Path
}
$RepoRoot = (Resolve-Path $ScriptDir).Path
$DockerRepoRoot = $RepoRoot -replace '\\', '/'

# Configuration matching Makefile
$PY_IMAGE = "python:3.12-slim"
$UV_IMAGE = "ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm"
$PY_PATHS = @("agents", "backend", "eval", "workspace")

$script:ExitCode = 0

function Flatten-Args {
    param([object[]]$Items)
    $result = @()
    if (-not $Items) { return @() }
    foreach ($it in $Items) {
        if ($it -is [System.Collections.IEnumerable] -and -not ($it -is [string])) {
            $result += Flatten-Args $it
        } elseif ($null -ne $it) {
            $result += [string]$it
        }
    }
    return $result
}

function Get-UserArgs {
    if ($env:UID_GID) {
        return @("--user", $env:UID_GID)
    }
    # On Windows, Docker Desktop handles file mounts without requiring container user mapping.
    # Invoking id on Windows (e.g. from Git/MSYS) produces arbitrary Windows SIDs (e.g. 197609)
    # that do not exist inside Linux containers and cause container execution failures.
    $isWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
    if (-not $isWindows) {
        $idCmd = Get-Command id -ErrorAction SilentlyContinue
        if ($idCmd) {
            $u = (& id -u 2>$null)
            $g = (& id -g 2>$null)
            if ($u -and $g) {
                return @("--user", "$($u.Trim()):$($g.Trim())")
            }
        }
    }
    return @()
}

# Reads KEY's value in .env (last line wins, quotes dropped), or $Default when unset or empty
function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $false)][string]$Default = ""
    )
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) {
        return $Default
    }
    $found = $null
    $lines = Get-Content -Path $envFile -ErrorAction SilentlyContinue
    if ($lines) {
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ($trimmed.StartsWith("#") -or (-not $trimmed.Contains("="))) {
                continue
            }
            $parts = $trimmed.Split("=", 2)
            $k = $parts[0].Trim()
            if ($k.StartsWith("export ")) {
                $k = $k.Substring(7).Trim()
            }
            if ($k -eq $Key) {
                # Strip all quotes matching Makefile's tr -d "\"'", then trim
                $v = ($parts[1].Trim() -replace '["'']', '').Trim()
                $found = $v
            }
        }
    }
    if ([string]::IsNullOrEmpty($found)) {
        return $Default
    }
    return $found
}

function Invoke-UvRun {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [object[]]$CmdArgs
    )
    $userArgs = Get-UserArgs
    $baseArgs = @("run", "--rm") + $userArgs + @(
        "-e", "UV_CACHE_DIR=/cache/uv",
        "-e", "UV_PROJECT_ENVIRONMENT=/cache/venv",
        "-v", "contoso-uv-cache:/cache",
        "-v", "${DockerRepoRoot}:/w",
        "-w", "/w",
        $UV_IMAGE
    )
    $dockerArgs = Flatten-Args ($baseArgs + $CmdArgs)

    & docker @dockerArgs
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-Help {
    Write-Host "VDaAgent PoC development tasks (equivalent to Makefile)"
    Write-Host "Usage: .\dev.ps1 <command> [args...]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  help            List the targets"
    Write-Host "  setup           1. Check Docker; create .env + credential files; list what to fill in"
    Write-Host "  check           2. Missing keys and unavailable domains, by name only"
    Write-Host "  up              3. Start the stack with the web UI, create demo users, print the URLs"
    Write-Host "  down            Stop the stack (volumes are kept)"
    Write-Host "  logs            Follow backend and workspace logs"
    Write-Host "  test            Backend, workspace and frontend tests in compose (doc 17)"
    Write-Host "  test-backend    Backend pytest (contoso_test DB, MODEL_BACKEND=fake)"
    Write-Host "  test-workspace  execd and contoso tests"
    Write-Host "  test-frontend   Vitest + legacy domain suite"
    Write-Host "  test-live       Live OpenRouter contract tests (pytest -m live; needs OPENROUTER_API_KEY)"
    Write-Host "  test-clean      Remove the test project's containers and volumes"
    Write-Host "  e2e             Playwright end-to-end against a fresh fake-mode stack (doc 17)"
    Write-Host "  lint            ruff check + format --check; frontend eslint"
    Write-Host "  format          ruff check --fix + ruff format"
    Write-Host "  lock            Refresh uv.lock and execd's pinned requirements"
    Write-Host "  eval            Agent evaluation (eval/ is not implemented yet)"
    $script:ExitCode = 0
}

function Invoke-Setup {
    param([object[]]$ArgsList = @())
    & docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("setup: Docker isn't running or isn't installed (GUIDE.md, Prerequisites)")
        $script:ExitCode = 1
        return
    }
    & docker compose version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("setup: 'docker compose' is missing (GUIDE.md, Prerequisites)")
        $script:ExitCode = 1
        return
    }
    & docker buildx version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("setup: 'docker buildx' is missing (GUIDE.md, Prerequisites)")
        $script:ExitCode = 1
        return
    }

    $userArgs = Get-UserArgs
    $dockerArgs = Flatten-Args (@("run", "--rm") + $userArgs + @(
        "-v", "${DockerRepoRoot}:/w",
        "-w", "/w",
        $PY_IMAGE,
        "python", "-m", "backend.init_env"
    ) + $ArgsList)
    & docker @dockerArgs
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-Check {
    param([object[]]$ArgsList = @())
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) {
        [Console]::Error.WriteLine("check: no .env yet; run .\dev.ps1 setup (or make setup) first")
        $script:ExitCode = 1
        return
    }
    $cmd = Flatten-Args (@("compose", "run", "--rm", "--no-deps", "--build", "backend", "python", "-m", "backend.preflight") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-Up {
    param([object[]]$ArgsList = @())
    Invoke-Check
    if ($script:ExitCode -ne 0) {
        return
    }

    $upArgs = Flatten-Args (@("compose", "--profile", "proxy", "up", "-d", "--build", "--wait") + $ArgsList)
    & docker @upArgs
    if ($LASTEXITCODE -ne 0) {
        $script:ExitCode = $LASTEXITCODE
        return
    }

    $demoPassword = Get-EnvValue "DEMO_PASSWORD" ""
    if ($demoPassword -ne "") {
        & docker compose exec -T backend python -m backend.seed_demo
    } else {
        Write-Host "DEMO_PASSWORD is not set in .env; skipping demo users alice and bob"
    }

    $proxy = Get-EnvValue "PROXY_PORT" "8080"
    $api = Get-EnvValue "APP_PORT" "8000"
    $langfuse = Get-EnvValue "LANGFUSE_PUBLIC_URL" "http://localhost:3100"
    $lfUser = Get-EnvValue "LANGFUSE_INIT_USER_EMAIL" "admin@contoso.local"
    $adminUser = Get-EnvValue "ADMIN_USERNAME" ""
    $logins = $adminUser
    if ($demoPassword -ne "") {
        if ($logins -ne "") {
            $logins = "$logins, alice, bob"
        } else {
            $logins = "alice, bob"
        }
    }

    Write-Host ""
    Write-Host "VDaAgent is up"
    Write-Host "  app       http://localhost:$proxy   (login: $logins)"
    Write-Host "  api       http://127.0.0.1:$api/api/health"
    Write-Host "  langfuse  $langfuse   ($lfUser / ADMIN_PASSWORD)"
    Write-Host "  stop: .\dev.ps1 down    logs: .\dev.ps1 logs"
    $script:ExitCode = 0
}

function Invoke-Down {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "--profile", "*", "down", "--remove-orphans") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-Logs {
    param([object[]]$ArgsList = @())
    if ($ArgsList.Count -eq 0) {
        & docker compose logs -f backend workspace
    } else {
        $hasFollow = ($ArgsList -contains "-f") -or ($ArgsList -contains "--follow")
        $base = if ($hasFollow) { @("compose", "logs") } else { @("compose", "logs", "-f") }
        $cmd = Flatten-Args ($base + $ArgsList)
        & docker @cmd
    }
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-TestClean {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "-f", "docker-compose.yml", "-f", "compose.test.yaml", "--profile", "*", "down", "-v", "--remove-orphans") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-TestBackend {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "-f", "docker-compose.yml", "-f", "compose.test.yaml", "run", "--rm", "--build", "backend", "pytest") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-TestWorkspace {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "-f", "docker-compose.yml", "-f", "compose.test.yaml", "run", "--rm", "--no-deps", "--build", "workspace", "pytest", "/opt/execd/tests") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-TestFrontend {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "-f", "docker-compose.yml", "-f", "compose.test.yaml", "run", "--rm", "--build", "frontend-test") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-TestLive {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "-f", "docker-compose.yml", "-f", "compose.test.yaml", "run", "--rm", "--no-deps", "--build", "backend", "pytest", "-m", "live") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

function Invoke-Test {
    $overall = 0
    Invoke-TestClean
    Invoke-TestBackend @()
    if ($script:ExitCode -ne 0) { $overall = 1 }
    Invoke-TestWorkspace @()
    if ($script:ExitCode -ne 0) { $overall = 1 }
    Invoke-TestFrontend @()
    if ($script:ExitCode -ne 0) { $overall = 1 }
    Invoke-TestClean
    $script:ExitCode = $overall
}

function Invoke-E2E {
    param([object[]]$ArgsList = @())
    $overall = 0
    & docker compose -f docker-compose.yml -f compose.e2e.yaml --profile '*' down -v --remove-orphans
    & docker compose -f docker-compose.yml -f compose.e2e.yaml up -d --build --wait backend frontend proxy fixtures
    if ($LASTEXITCODE -ne 0) { $overall = 1 }
    if ($overall -eq 0) {
        & docker compose -f docker-compose.yml -f compose.e2e.yaml run --rm --no-deps fixtures-seed
        if ($LASTEXITCODE -ne 0) { $overall = 1 }
    }
    if ($overall -eq 0) {
        $e2eCmd = Flatten-Args (@("compose", "-f", "docker-compose.yml", "-f", "compose.e2e.yaml", "run", "--rm", "--no-deps", "--build", "e2e") + $ArgsList)
        & docker @e2eCmd
        if ($LASTEXITCODE -ne 0) { $overall = 1 }
    }
    & docker compose -f docker-compose.yml -f compose.e2e.yaml --profile '*' down -v --remove-orphans
    $script:ExitCode = $overall
}

function Invoke-Lint {
    param([object[]]$ArgsList = @())
    $paths = if ($ArgsList.Count -gt 0) { $ArgsList } else { $PY_PATHS }
    Invoke-UvRun (@("uv", "run", "--frozen", "--only-group", "dev", "ruff", "check") + $paths)
    if ($script:ExitCode -ne 0) { return }

    Invoke-UvRun (@("uv", "run", "--frozen", "--only-group", "dev", "ruff", "format", "--check") + $paths)
    if ($script:ExitCode -ne 0) { return }

    if ($ArgsList.Count -eq 0 -or ($ArgsList -contains "frontend")) {
        & docker compose -f docker-compose.yml -f compose.test.yaml run --rm --no-deps --build frontend-test npm run lint
        $script:ExitCode = $LASTEXITCODE
    }
}

function Invoke-Format {
    param([object[]]$ArgsList = @())
    $paths = if ($ArgsList.Count -gt 0) { $ArgsList } else { $PY_PATHS }
    Invoke-UvRun (@("uv", "run", "--frozen", "--only-group", "dev", "ruff", "check", "--fix") + $paths)
    if ($script:ExitCode -ne 0) { return }

    Invoke-UvRun (@("uv", "run", "--frozen", "--only-group", "dev", "ruff", "format") + $paths)
}

function Invoke-Lock {
    Invoke-UvRun @("uv", "lock")
    if ($script:ExitCode -ne 0) { return }

    $shCmd = "cd workspace/execd && uv pip compile -q --python-version 3.12 requirements.in -o requirements.txt && uv pip compile -q --python-version 3.12 requirements-test.in -o requirements-test.txt"
    Invoke-UvRun @("sh", "-c", $shCmd)
}

function Invoke-Eval {
    param([object[]]$ArgsList = @())
    $cmd = Flatten-Args (@("compose", "run", "--rm", "--no-deps", "backend", "python", "-m", "eval.runners.run_smoke_eval") + $ArgsList)
    & docker @cmd
    $script:ExitCode = $LASTEXITCODE
}

# Ensure working directory is repo root during execution
Push-Location $RepoRoot
try {
    switch ($Command.ToLower()) {
        { $_ -in @("help", "-h", "--help", "/?", "-?") } {
            Invoke-Help
            break
        }
        "setup" {
            Invoke-Setup $RestArgs
            break
        }
        "check" {
            Invoke-Check $RestArgs
            break
        }
        "up" {
            Invoke-Up $RestArgs
            break
        }
        "down" {
            Invoke-Down $RestArgs
            break
        }
        "logs" {
            Invoke-Logs $RestArgs
            break
        }
        "test" {
            Invoke-Test
            break
        }
        { $_ -in @("test-backend", "test_backend") } {
            Invoke-TestBackend $RestArgs
            break
        }
        { $_ -in @("test-workspace", "test_workspace") } {
            Invoke-TestWorkspace $RestArgs
            break
        }
        { $_ -in @("test-frontend", "test_frontend") } {
            Invoke-TestFrontend $RestArgs
            break
        }
        { $_ -in @("test-live", "test_live") } {
            Invoke-TestLive $RestArgs
            break
        }
        { $_ -in @("test-clean", "test_clean") } {
            Invoke-TestClean $RestArgs
            break
        }
        "e2e" {
            Invoke-E2E $RestArgs
            break
        }
        "lint" {
            Invoke-Lint $RestArgs
            break
        }
        "format" {
            Invoke-Format $RestArgs
            break
        }
        "lock" {
            Invoke-Lock
            break
        }
        "eval" {
            Invoke-Eval $RestArgs
            break
        }
        default {
            [Console]::Error.WriteLine("Unknown command: $Command")
            Invoke-Help
            $script:ExitCode = 1
            break
        }
    }
}
finally {
    Pop-Location
}

$global:LASTEXITCODE = $script:ExitCode
if ($script:ExitCode -ne 0) {
    exit $script:ExitCode
}
