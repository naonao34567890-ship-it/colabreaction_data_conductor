# Windows PowerShell 5.1+; modifies editor UI source only.
# No job queue, ORCA data, Mol Bench library, or Colab history files are deleted.
$ErrorActionPreference = 'Stop'

function Replace-TextFile {
  param([string]$Path,[string]$Value)
  $current = [IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8)
  if ($current -ceq $Value) { return $false }
  $bak = $Path + '.rg-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
  $tmp = $Path + '.rg-tmp-' + [Guid]::NewGuid().ToString('N')
  try {
    [IO.File]::WriteAllText($tmp,$Value,([Text.UTF8Encoding]::new($false)))
    [IO.File]::Replace($tmp,$Path,$bak)
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }
  Write-Host ("変更: " + $Path) -ForegroundColor Green
  Write-Host ("バックアップ: " + $bak)
  return $true
}

function Test-Editor([string]$P) {
  try {
    if (-not (Test-Path -LiteralPath $P -PathType Leaf)) { return $false }
    $src = [IO.File]::ReadAllText($P,[Text.Encoding]::UTF8)
    return $src.Contains('id="optimizeGfn1"') -and $src.Contains('id="optimize"')
  } catch { return $false }
}

$conf = Join-Path $env:LOCALAPPDATA 'ReactionGeneratorUpdater'
$cache = Join-Path $conf 'editor-path.txt'
$editor = $null
if (Test-Path -LiteralPath $cache) {
  $p = [IO.File]::ReadAllText($cache).Trim()
  if (Test-Editor $p) { $editor = $p }
}
if (-not $editor) {
  $locations = @(
    (Join-Path $HOME 'Documents\Codex'),
    (Join-Path $HOME 'OneDrive\Documents\Codex'),
    (Join-Path $HOME 'Downloads')
  )
  $list = New-Object 'System.Collections.Generic.List[string]'
  foreach ($root in $locations) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    Write-Host ("ソースを検索: " + $root)
    Get-ChildItem -LiteralPath $root -Filter editor.html -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.FullName -notmatch '\\(node_modules|vendor|\.git)\\' -and (Test-Editor $_.FullName)) {
        if (-not $list.Contains($_.FullName)) { [void]$list.Add($_.FullName) }
      }
    }
  }
  if ($list.Count -eq 1) { $editor = $list[0] }
  elseif ($list.Count -gt 1) {
    Write-Host '使っているアプリのeditor.htmlを番号で選んでください。'
    for($i=0;$i -lt $list.Count;$i++) { Write-Host ((1+$i).ToString()+': '+$list[$i]) }
    $answer = Read-Host '番号'
    $n=0
    if (-not [int]::TryParse($answer,[ref]$n) -or $n -lt 1 -or $n -gt $list.Count) {
      throw '番号が不正なため、アプリの変更はありません。'
    }
    $editor=$list[$n-1]
  }
}
if (-not $editor) { throw 'editor.htmlが見つからず、変更はありません。' }
New-Item -ItemType Directory -Force -Path $conf | Out-Null
[IO.File]::WriteAllText($cache,$editor)
Write-Host ("対象: " + $editor)
$src = [IO.File]::ReadAllText($editor,[Text.Encoding]::UTF8)

# Preserve button IDs and onclick handlers, but place GFN1 directly under GFN2.
if (-not $src.Contains('rg-gfn1-position-v2')) {
  $regex1 = [regex]'(?is)<button\b[^>]*\bid=["'']optimizeGfn1["''][^>]*>.*?</button>'
  $regex2 = [regex]'(?is)<button\b[^>]*\bid=["'']optimize["''][^>]*>.*?</button>'
  $m1 = $regex1.Matches($src)
  $m2 = $regex2.Matches($src)
  if ($m1.Count -eq 1 -and $m2.Count -eq 1 -and $src.IndexOf('</head>',[StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $gfn1=$m1[0].Value
    $src=$src.Remove($m1[0].Index,$m1[0].Length)
    $gfn2=$regex2.Match($src)
    $wrapper='<span class="rg-gfn-methods">'+[Environment]::NewLine+$gfn2.Value+[Environment]::NewLine+$gfn1+'</span>'
    $src=$src.Remove($gfn2.Index,$gfn2.Length).Insert($gfn2.Index,$wrapper)
    $css=@'
<style id="rg-gfn1-position-v2">
.rg-gfn-methods{display:inline-flex;flex-direction:column;align-items:stretch;gap:0;vertical-align:middle}
.rg-gfn-methods button{width:100%;white-space:nowrap}
.rg-gfn-methods #optimizeGfn1{display:none!important}
.rg-gfn-methods:has(#optimize:hover) #optimizeGfn1,
.rg-gfn-methods:has(#optimize:focus-visible) #optimizeGfn1,
.rg-gfn-methods:has(#optimizeGfn1:hover) #optimizeGfn1,
.rg-gfn-methods:has(#optimizeGfn1:focus-visible) #optimizeGfn1{display:block!important}
</style>
'@
    $head=$src.IndexOf('</head>',[StringComparison]::OrdinalIgnoreCase)
    $src=$src.Insert($head,$css+[Environment]::NewLine)
  } else {
    Write-Warning ("GFN1/GFN2の検出数が想定外: "+$m1.Count+"/"+$m2.Count+"。配置修正はスキップ。")
  }
}

# Preserve min/max/step; change only default.
$src=[regex]::Replace($src,'(?i)(\bid=["'']speed["''][^>]*\bvalue=["''])1(?:\.0)?(["''])','15$2')
$src=[regex]::Replace($src,'(?i)(\bid=["'']speedValue["''][^>]*>)\s*1\.0(\s*Å/s)','15.0$2')
$src=$src.Replace('上書きしますか','上書きをしますか')
$changed=0
if (Replace-TextFile -Path $editor -Value $src) { $changed++ }

# Keep the wording consistent in the editor's sibling application JS/HTML files only.
$dir=Split-Path -Parent $editor
Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object {
  @('.js','.mjs','.html','.css') -contains $_.Extension.ToLowerInvariant() -and $_.FullName -ne $editor
} | ForEach-Object {
  $p=$_.FullName
  try {
    $before=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)
    if ($before.Contains('上書きしますか')) {
      if (Replace-TextFile -Path $p -Value $before.Replace('上書きしますか','上書きをしますか')) { $changed++ }
    }
  } catch { Write-Warning ("スキップ: "+$p+" / "+$_.Exception.Message) }
}
Write-Host ("完了。変更ファイル数: "+$changed) -ForegroundColor Green
Write-Host '今回変更したのはエディターUIと文言だけです。'
