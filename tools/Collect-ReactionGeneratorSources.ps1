# Collect-ReactionGeneratorSources.ps1
# Read-only source collector for Windows PowerShell 5.1 or newer.
# It NEVER modifies an installed app or deletes calculation data.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Windows.Forms

$wanted = @(
  'REACTION GENERATOR (2).zip',
  'desktop_ui.zip',
  'REACTION_GENERATOR_22_更新エラー修正版.zip'
)
$searchRoots = @(
  (Join-Path $HOME 'Downloads'),
  (Join-Path $HOME 'Desktop')
)
$archives = New-Object 'System.Collections.Generic.List[string]'

foreach ($fileName in $wanted) {
  $found = $null
  foreach ($root in $searchRoots) {
    $candidate = Join-Path $root $fileName
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $found = $candidate
      break
    }
  }
  if (-not $found) {
    Write-Host "ファイルが見つかりません: $fileName" -ForegroundColor Yellow
    Write-Host 'ファイル選択画面で指定できます。不要な場合はキャンセルしてください。'
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "元ファイルを選択: $fileName"
    $dialog.Filter = 'ZIP files (*.zip)|*.zip'
    $dialog.FileName = $fileName
    if (Test-Path -LiteralPath $searchRoots[0]) {
      $dialog.InitialDirectory = $searchRoots[0]
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $found = $dialog.FileName
    }
    $dialog.Dispose()
  }
  if ($found) {
    [void] $archives.Add($found)
  }
}

if ($archives.Count -eq 0) {
  throw '元アプリのZIPが選択されませんでした。何も変更していません。'
}

$sb = New-Object System.Text.StringBuilder
[void] $sb.AppendLine('REACTION GENERATOR / ORCA Calc SOURCE BUNDLE')
[void] $sb.AppendLine('Read-only extraction for code inspection.')
[void] $sb.AppendLine('Date: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
[void] $sb.AppendLine('Only source-like files are included. No files were changed in the apps.')
[void] $sb.AppendLine('')

$extensions = @('.py','.js','.mjs','.html','.css','.ps1','.cmd','.bat','.json','.ini')
$excludeFolders = '(?i)(^|/)(site-packages|node_modules|venv|\.venv|__pycache__|vendor|python_runtime|Python310Runtime|Lib|tcl|torch|numpy|scipy|PySide6|build|dist-packages|\.git|data|cache|logs|models)(/|$)'
$excludeNames = '(?i)(secret|credentials|private.?key|password|\.env)'
$maxEntryLength = 2MB
$maxBundleLength = 20MB
$included = 0
$skipped = 0

foreach ($archivePath in $archives) {
  Write-Host "ソースを抽出: $archivePath"
  $zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    foreach ($entry in $zip.Entries) {
      if ([string]::IsNullOrWhiteSpace($entry.Name)) { continue }
      $name = $entry.FullName.Replace('\','/')
      $ext = [System.IO.Path]::GetExtension($entry.Name).ToLowerInvariant()
      if ($extensions -notcontains $ext -or
          $name -match $excludeFolders -or
          $entry.Name -match $excludeNames -or
          $entry.Length -gt $maxEntryLength) {
        $skipped++
        continue
      }
      try {
        $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8, $true)
        try {
          $source = $reader.ReadToEnd()
        } finally {
          $reader.Dispose()
        }
        if ($source.IndexOf([char]0) -ge 0) {
          $skipped++
          continue
        }
        if (($sb.Length + $source.Length) -gt $maxBundleLength) {
          [void] $sb.AppendLine('SOURCE_BUNDLE_SIZE_LIMIT_REACHED: Remaining files omitted')
          break
        }
        [void] $sb.AppendLine('')
        [void] $sb.AppendLine('===== BEGIN SOURCE FILE =====')
        [void] $sb.AppendLine('ARCHIVE: ' + [System.IO.Path]::GetFileName($archivePath))
        [void] $sb.AppendLine('PATH: ' + $name)
        [void] $sb.AppendLine('===== CONTENT =====')
        [void] $sb.AppendLine($source)
        [void] $sb.AppendLine('===== END SOURCE FILE =====')
        $included++
      } catch {
        [void] $sb.AppendLine('SOURCE_READ_ERROR: ' + $name + ' :: ' + $_.Exception.Message)
      }
    }
  } finally {
    $zip.Dispose()
  }
}

[void] $sb.AppendLine('')
[void] $sb.AppendLine("SUMMARY: source_files=$included skipped_entries=$skipped archives=$($archives.Count)")
$outDir = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $outDir)) {
  $outDir = Join-Path $HOME 'Downloads'
}
$outPath = Join-Path $outDir ('RG_Source_Review_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host ''
Write-Host "作成しました: $outPath" -ForegroundColor Green
Write-Host "対象ソース数: $included, 除外エントリ数: $skipped"
Write-Host 'このTXTを元のChatGPTチャットへアップロードしてください。'
