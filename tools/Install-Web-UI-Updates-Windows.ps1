# Applies reviewed WEB UI changes to the selected local dist directory.
# Windows PowerShell 5.1+; requires existing editable web UI sources.
# Keeps modified user files via three-way merge, or skips if cannot merge.
# Does not delete or reset data stores or calculation files.
$ErrorActionPreference = 'Stop'
$repo = 'naonao34567890-ship-it/colabreaction_data_conductor'
$branch = 'desktop-repair-offline-tools-20261124'
$uri = 'https://raw.githubusercontent.com/' + $repo + '/'
$files = @('editor.html','colab.html','colab-records.js','slideshow.js','reaction-viewer.html','reaction-store.js','reactions.js')
$config = Join-Path $env:LOCALAPPDATA 'ReactionGeneratorUpdater'
$cache = Join-Path $config 'web-dist-path.txt'
$editorCache = Join-Path $config 'editor-path.txt'

function Test-WebDir([string]$path) {
  return ($path -and (Test-Path -LiteralPath (Join-Path $path 'editor.html') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $path 'colab-records.js') -PathType Leaf))
}

$dist = $null
if (Test-Path -LiteralPath $cache) {
  $candidate = [IO.File]::ReadAllText($cache).Trim()
  if (Test-WebDir $candidate) { $dist = $candidate }
}
if (-not $dist -and (Test-Path -LiteralPath $editorCache)) {
  $candidate = Split-Path -Parent ([IO.File]::ReadAllText($editorCache).Trim())
  if (Test-WebDir $candidate) { $dist = $candidate }
}
if (-not $dist) {
  $roots = @(
    (Join-Path $HOME 'Documents\Codex'),
    (Join-Path $HOME 'OneDrive\Documents\Codex'),
    (Join-Path $HOME 'Downloads')
  )
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    Write-Host ('ソースを探索: ' + $root)
    Get-ChildItem -LiteralPath $root -Filter 'colab-records.js' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $dir = $_.DirectoryName
      if ($dir -notmatch '\\(node_modules|vendor|\.git)\\' -and
          (Test-WebDir $dir) -and -not $candidates.Contains($dir)) {
        [void]$candidates.Add($dir)
      }
    }
  }
  if ($candidates.Count -eq 1) { $dist = $candidates[0] }
  elseif ($candidates.Count -gt 1) {
    Write-Host '候補が複数見つかりました。現在使用している本体を番号で指定してください。'
    for ($i=0; $i -lt $candidates.Count; $i++) {
      Write-Host ((1+$i).ToString() + ': ' + $candidates[$i])
    }
    $answer = Read-Host '番号'
    $n = 0
    if (-not [int]::TryParse($answer,[ref]$n) -or $n -lt 1 -or $n -gt $candidates.Count) {
      throw '番号が不正です。変更しません。'
    }
    $dist = $candidates[$n-1]
  }
}
if (-not $dist) { throw '対象のWeb UIソースが見つかりませんでした。変更はありません。' }
New-Item -ItemType Directory -Path $config -Force | Out-Null
[IO.File]::WriteAllText($cache,$dist)
Write-Host ('対象のWeb UI: ' + $dist) -ForegroundColor Cyan

$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$temp = Join-Path $env:TEMP ('RG-Web-Update-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$changed = 0
$skipped = 0
try {
  foreach($name in $files) {
    $local = Join-Path $dist $name
    if (-not (Test-Path -LiteralPath $local -PathType Leaf)) {
      Write-Warning ('未設置のためスキップ: '+$name)
      $skipped++; continue
    }
    $base = Join-Path $temp ('base-'+$name)
    $new = Join-Path $temp ('new-'+$name)
    $candidate = Join-Path $temp ('merge-'+$name)
    $remotePath = 'dist/' + $name
    try {
      Invoke-WebRequest -UseBasicParsing -Uri ($uri+'main/'+$remotePath) -OutFile $base
      Invoke-WebRequest -UseBasicParsing -Uri ($uri+$branch+'/'+$remotePath) -OutFile $new
      $localHash = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash
      $newHash = (Get-FileHash -LiteralPath $new -Algorithm SHA256).Hash
      if ($localHash -eq $newHash) {
        Write-Host ('適用済み: '+$name)
        continue
      }
      $baseHash = (Get-FileHash -LiteralPath $base -Algorithm SHA256).Hash
      if ($localHash -eq $baseHash) {
        [IO.File]::Copy($new,$candidate,$true)
      } elseif ($gitCommand) {
        [IO.File]::Copy($local,$candidate,$true)
        & $gitCommand.Source merge-file --diff3 $candidate $base $new
        if ($LASTEXITCODE -ne 0) {
          Write-Warning ('ローカル変更と競合したため保留: '+$name+'（上書きしていません）')
          $skipped++; continue
        }
      } else {
        Write-Warning ('変更済みのローカルソースはGitなしでは自動統合できません: '+$name)
        $skipped++; continue
      }
      $backup = $local + '.rg-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
      # Use a temporary file in the destination directory, so File.Replace stays on the same volume.
      $write = $local + '.rg-update-' + [Guid]::NewGuid().ToString('N')
      try {
        [IO.File]::Copy($candidate,$write,$false)
        [IO.File]::Replace($write,$local,$backup)
        Write-Host ('更新: '+$name) -ForegroundColor Green
        Write-Host ('  バックアップ: '+$backup)
        $changed++
      } finally {
        if (Test-Path -LiteralPath $write) { Remove-Item -LiteralPath $write -Force }
      }
    } catch {
      Write-Warning ('処理できませんでした: '+$name+' / '+$_.Exception.Message)
      $skipped++
    }
  }
} finally {
  Remove-Item -LiteralPath $temp -Force -Recurse -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ('完了: '+$changed+'件更新、'+$skipped+'件保留') -ForegroundColor Cyan
Write-Host '対象はWeb UIソース7ファイルのみ。ORCAキューや保存データは変更していません。'
