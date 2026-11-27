# Repair the documented split WSL launcher. Windows PowerShell 5.1+.
# Apply only with REACTION GENERATOR closed and no ColabReaction batch running.
# Does not start or terminate jobs, modify libraries, or remove data.
param([string]$Root)
$ErrorActionPreference = 'Stop'
$cacheDir = Join-Path $env:LOCALAPPDATA 'ReactionGeneratorUpdater'
$cache = Join-Path $cacheDir 'colabreaction-path.txt'

function Find-Launcher([string]$p) {
    if (-not $p) { return $null }
    if (Test-Path -LiteralPath $p -PathType Leaf) { $p = Split-Path -Parent $p }
    if (-not (Test-Path -LiteralPath $p -PathType Container)) { return $null }
    for ($i = 0; $i -lt 7 -and $p; $i++) {
        foreach ($dir in @($p, (Join-Path $p 'ColabReaction'))) {
            if ((Test-Path -LiteralPath (Join-Path $dir 'Start-ColabReaction.ps1') -PathType Leaf) -and
                (Test-Path -LiteralPath (Join-Path $dir 'run-wsl.sh') -PathType Leaf) -and
                (Test-Path -LiteralPath (Join-Path $dir 'ColabReaction-Desktop.ps1') -PathType Leaf)) {
                return (Resolve-Path -LiteralPath $dir).Path
            }
        }
        $parent = Split-Path -Parent $p
        if ($parent -eq $p) { break }
        $p = $parent
    }
    return $null
}

$dir = Find-Launcher $Root
if ($Root -and -not $dir) { throw 'The specified application root does not contain ColabReaction.' }
if (-not $dir) {
    foreach ($name in @('colabreaction-path.txt','web-dist-path.txt','editor-path.txt')) {
        $file = Join-Path $cacheDir $name
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            $dir = Find-Launcher ([IO.File]::ReadAllText($file).Trim())
            if ($dir) { break }
        }
    }
}
if (-not $dir) {
    $roots = @((Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex'),
        (Join-Path $HOME 'Documents\Codex'), (Join-Path $HOME 'OneDrive\Documents\Codex'))
    $candidates = @(
        foreach ($base in ($roots | Select-Object -Unique)) {
            if (Test-Path -LiteralPath $base -PathType Container) {
                Get-ChildItem -LiteralPath $base -Filter 'Start-ColabReaction.ps1' -File -Recurse -ErrorAction SilentlyContinue |
                    ForEach-Object { Find-Launcher $_.DirectoryName }
            }
        }
    ) | Where-Object { $_ } | Sort-Object -Unique
    $candidates = @($candidates | Where-Object { $_ })
    if ($candidates.Count -eq 1) { $dir = $candidates[0] }
    elseif ($candidates.Count -gt 1) {
        for ($i=0; $i -lt $candidates.Count; $i++) { Write-Host ((1+$i).ToString()+': '+$candidates[$i]) }
        $n=0
        if (-not [int]::TryParse((Read-Host 'Select the installed app number'),[ref]$n) -or $n -lt 1 -or $n -gt $candidates.Count) { throw 'No valid selection.' }
        $dir=$candidates[$n-1]
    }
}
if (-not $dir) { throw 'ColabReaction folder not found. No files changed.' }
$launcher = Join-Path $dir 'Start-ColabReaction.ps1'
$runner = Join-Path $dir 'run-wsl.sh'
Write-Host ('Target: '+$dir)
function Parse-Source([string]$s) {
    $tokens=$null; $errors=$null
    $tree=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors)
    if ($errors.Count) { throw ('PowerShell parse error: '+($errors | ForEach-Object Message | Out-String)) }
    return $tree
}

$source=[IO.File]::ReadAllText($launcher)
$new=$source
$marker='# RG-WSL-DIRECT-LAUNCH-V1'
if (-not $source.Contains($marker)) {
    $tree=Parse-Source $source
    $matches=@($tree.FindAll({
        param($node)
        if ($node -isnot [System.Management.Automation.Language.IfStatementAst]) { return $false }
        if ($node.Clauses.Count -ne 1 -or $null -eq $node.ElseClause) { return $false }
        return ($node.Clauses[0].Item1.Extent.Text.Trim() -eq '$NonInteractiveRun' -and
            $node.Clauses[0].Item2.Extent.Text -match 'Diagnostics\.ProcessStartInfo' -and
            $node.ElseClause.Extent.Text -match 'wsl\.exe\s+--distribution\s+\$distro\s+--cd\s+\$wslDirectory\s+--exec\s+(?:/usr/bin/)?bash\s+\./run-wsl\.sh\s+@arguments' -and
            $node.ElseClause.Extent.Text -match '\$batchExit\s*=\s*\$LASTEXITCODE')
    },$true))
    if ($matches.Count -ne 1) {
        throw 'The documented split launcher was not uniquely identified. No files changed.'
    }
    $replacement=@'
# RG-WSL-DIRECT-LAUNCH-V1
# Both modes use the same native PowerShell WSL invocation.
# Preserve --non-interactive, --startup-log, ZIP selection, and all other arguments.
$rgPreviousErrorPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & wsl.exe --distribution $distro --cd $wslDirectory --exec /usr/bin/bash ./run-wsl.sh @arguments
    $batchExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $rgPreviousErrorPreference
}
'@
    $extent=$matches[0].Extent
    $new=$source.Remove($extent.StartOffset,$extent.EndOffset-$extent.StartOffset).Insert($extent.StartOffset,$replacement)
    [void](Parse-Source $new)
}
$oldShell=[IO.File]::ReadAllText($runner)
# Bash requires LF and no BOM. Compare bytes too, to detect a BOM-only defect.
$newShell=$oldShell.Replace(([string][char]13+[string][char]10),[string][char]10)
$runnerBytes=[IO.File]::ReadAllBytes($runner)
$hasBom=($runnerBytes.Length -ge 3 -and $runnerBytes[0] -eq 239 -and $runnerBytes[1] -eq 187 -and $runnerBytes[2] -eq 191)

function Write-BackedUp([string]$p,[string]$s,[bool]$bom) {
    $backup=$p+'.rg-backup-'+[Guid]::NewGuid().ToString('N')
    $tmp=$p+'.rg-tmp-'+[Guid]::NewGuid().ToString('N')
    try {
        [IO.File]::WriteAllText($tmp,$s,[Text.UTF8Encoding]::new($bom))
        [IO.File]::Replace($tmp,$p,$backup)
        Write-Host ('Updated: '+$p)
        Write-Host ('Backup: '+$backup)
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}
if ($new -cne $source) { Write-BackedUp $launcher $new $true }
else { Write-Host 'Launcher already repaired.' }
if ($newShell -cne $oldShell -or $hasBom) { Write-BackedUp $runner $newShell $false }
else { Write-Host 'Bash line endings already LF.' }
[void](New-Item -ItemType Directory -Path $cacheDir -Force)
[IO.File]::WriteAllText($cache,$dir,[Text.UTF8Encoding]::new($false))
Write-Host 'Repair applied. No calculation was started. Reopen the application and test normal start.'
