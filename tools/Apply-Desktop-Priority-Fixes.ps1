# Apply targeted fixes to the actual Windows desktop application. PowerShell 5.1+.
# Apply only with REACTION GENERATOR closed and no ColabReaction batch running.
# Does not start or terminate jobs, modify libraries, or remove data.
param([string]$Root, [switch]$NoSourceExport)
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

$script:rgOK=0
$script:rgFailed=0
function Invoke-RgPatch([string]$name,[scriptblock]$action) {
    Write-Host ('=== '+$name+' ===') -ForegroundColor Cyan
    try { & $action; $script:rgOK++; Write-Host 'OK' -ForegroundColor Green }
    catch { $script:rgFailed++; Write-Warning ($name+': '+$_.Exception.Message) }
}
Invoke-RgPatch 'WSL launcher' {
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

if ($new -cne $source) { Write-BackedUp $launcher $new $true }
else { Write-Host 'Launcher already repaired.' }
if ($newShell -cne $oldShell -or $hasBom) { Write-BackedUp $runner $newShell $false }
else { Write-Host 'Bash line endings already LF.' }
}
Invoke-RgPatch 'Desktop Colab history selection' {
$localDist = Join-Path (Split-Path -Parent $dir) 'MolBench\dist'
$localJs = Join-Path $localDist 'colab-local.js'
$localHtml = Join-Path $localDist 'colab.html'
if (-not (Test-Path -LiteralPath $localJs -PathType Leaf) -or -not (Test-Path -LiteralPath $localHtml -PathType Leaf)) {
    throw 'Desktop Colab history source was not found.'
}
$html=[IO.File]::ReadAllText($localHtml)
if ($html -notmatch '\bid\s*=\s*["'']records["'']' -or $html -notmatch 'colab-local\.js' -or $html -notmatch 'recordSelection') {
    throw 'The local Colab history markup differs from the documented version.'
}
$old=[IO.File]::ReadAllText($localJs)
if ($old.Contains('Desktop-only Colab history selection adapter')) {
    Write-Host 'Desktop selection adapter already installed.'
} else {
    $adapter=@'
/* Desktop-only Colab history selection adapter.
 * Uses the existing record checkbox and its native click handler.
 * No changes to the local data API, record IDs, or ordinary click actions.
 */
(function (root) {
  "use strict";
  const selector = 'article,details,li,tr,[data-record-id],[data-archive-id],.record-card,.archive-card,.record-row,.archive-row,.colab-job,.record-item,.archive-item,.record,.archive';
  function onlyCheckbox(node) {
    const boxes = [...node.querySelectorAll('input[type="checkbox"]')];
    return boxes.length === 1 && !boxes[0].disabled ? boxes[0] : null;
  }
  function checkboxFor(target, list) {
    if (!target || !list || !list.contains(target) || target === list) return null;
    // A recognized record must contain exactly one checkbox. Do not guess
    // among multiple records within a classification group.
    for (let item = target; item && item !== list; item = item.parentElement) {
      if (!item.matches(selector) && item.parentElement !== list) continue;
      const box = onlyCheckbox(item);
      if (box) return box;
    }
    return null;
  }
  function isNativeCheckboxTarget(target, box) {
    if (target === box) return true;
    const label = target.closest('label');
    return !!label && label.control === box;
  }
  function editable(target) {
    return !!target.closest('textarea,[contenteditable="true"],input:not([type="checkbox"]),select');
  }
  function install(win) {
    if (win.__rgDesktopSelectionV1) return;
    win.__rgDesktopSelectionV1 = true;
    const doc = win.document;
    let forwarding = false;
    function targetOf(event) {
      const target = event.target;
      return target && typeof target.closest === 'function' ? target : target?.parentElement;
    }
    function inspect(event) {
      if (forwarding) return null;
      const target = targetOf(event);
      const box = checkboxFor(target, doc.getElementById('records'));
      if (!box || editable(target) || isNativeCheckboxTarget(target, box)) return null;
      return box;
    }
    function reserveModifierClick(event) {
      if (!((event.button === 0 && (event.ctrlKey || event.metaKey)) ||
            (event.button === 2 && event.shiftKey))) return;
      const box = inspect(event);
      if (box) event.stopImmediatePropagation();
    }
    // Reserve the modifier gesture before a generic document-level
    // pointerdown/mousedown or click listener can clear the selection.
    for (const name of ['pointerdown','mousedown','pointerup','mouseup']) {
      win.addEventListener(name, reserveModifierClick, true);
    }
    function select(event, addOnly) {
      const box = inspect(event);
      if (!box) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (addOnly && box.checked) return;
      forwarding = true;
      try { box.click(); } finally { forwarding = false; }
    }
    win.addEventListener('click', event => {
      if (event.button === 0 && (event.ctrlKey || event.metaKey)) select(event, false);
    }, true);
    win.addEventListener('contextmenu', event => {
      if (event.shiftKey) select(event, true);
    }, true);
  }
  if (typeof module === 'object' && module.exports) module.exports = {checkboxFor,install};
  if (root && root.document) install(root);
})(typeof window !== 'undefined' ? window : null);
'@
    # Preserve any existing classic-script strict-mode directive.
    $strict=[regex]::Match($old,'^\s*["'']use strict["'']\s*;')
    $offset=if ($strict.Success) { $strict.Index+$strict.Length } else { 0 }
    $modified=$old.Insert($offset,[Environment]::NewLine+$adapter+[Environment]::NewLine)
    Write-BackedUp $localJs $modified $false
}
}
Invoke-RgPatch 'Colab personal default settings' {
$desktop=Join-Path $dir 'ColabReaction-Desktop.ps1'
$old=[IO.File]::ReadAllText($desktop)
if ($old.Contains('# RG-COLAB-PERSONAL-DEFAULTS-V1')) {
    Write-Host 'Personal defaults loader already installed.'
} else {
    foreach ($control in @('$moves','$ipoptEvery','$heartbeatSeconds','$fields')) {
        if (-not $old.Contains($control)) { throw ('Missing documented UI control: '+$control) }
    }
    [void](Parse-Source $old)
    $anchor=[regex]::Matches($old,'(?m)^[\t ]*\$run[\t ]*=[\t ]*Add-Action[\t ]+["''](?:通常開始|計算開始)["''][\t ]+\d+[\t ]*\r?$')
    if ($anchor.Count -ne 1) { throw 'Could not uniquely identify the ColabReaction start-button definition.' }
    $loader=@'
# RG-COLAB-PERSONAL-DEFAULTS-V1
# This code is injected into ColabReaction-Desktop.ps1 after creation of
# the original settings controls, before creation of the run buttons.
# Existing run parameter construction continues to use the same controls.
$rgConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'REACTION_GENERATOR.config.json'
$rgConfigDefaults = [ordered]@{
    N_MOVE = 198
    IPOPT_LOG_EVERY = 10
    NO_OUTPUT_NOTICE_SECONDS = 300
    SKIP_GAUSSVIEW = $true
}
$rgConfigMessages = New-Object 'System.Collections.Generic.List[string]'
$rgConfigValues = $null
try {
    if (-not (Test-Path -LiteralPath $rgConfigPath -PathType Leaf)) {
        $rgDefaultDocument = [ordered]@{ colabReaction = $rgConfigDefaults }
        [IO.File]::WriteAllText($rgConfigPath,($rgDefaultDocument | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    }
    $rgDocument = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($rgConfigPath))
    if ($null -eq $rgDocument -or $null -eq $rgDocument.colabReaction -or
        $rgDocument.colabReaction -isnot [pscustomobject]) {
        throw 'The colabReaction section must be an object.'
    }
    $rgConfigValues = $rgDocument.colabReaction
} catch {
    [void]$rgConfigMessages.Add('設定ファイルを読み込めません。アプリ既定値を使用します: '+$_.Exception.Message)
}
function Get-RgConfigValue([string]$key) {
    $property = if ($null -ne $rgConfigValues) { $rgConfigValues.PSObject.Properties[$key] } else { $null }
    if ($null -eq $property) { return $rgConfigDefaults[$key] }
    return $property.Value
}
function Set-RgConfigNumber([string]$key,$control) {
    $value=Get-RgConfigValue $key
    $default=[int]$rgConfigDefaults[$key]
    $n=0
    if ($null -eq $value -or $value -is [bool] -or
        -not [int]::TryParse([string]$value,[ref]$n) -or
        $n -lt $control.Minimum -or $n -gt $control.Maximum) {
        [void]$rgConfigMessages.Add($key+' が不正です。既定値 '+$default+' を使用します。')
        $n=$default
    }
    if ($n -lt $control.Minimum -or $n -gt $control.Maximum) {
        [void]$rgConfigMessages.Add($key+' の既定値が現在のUI範囲外です。元のUI初期値を維持します。')
        return
    }
    try { $control.Value = $n }
    catch { [void]$rgConfigMessages.Add($key+' のUI反映に失敗しました: '+$_.Exception.Message) }
}
Set-RgConfigNumber 'N_MOVE' $moves
Set-RgConfigNumber 'IPOPT_LOG_EVERY' $ipoptEvery
Set-RgConfigNumber 'NO_OUTPUT_NOTICE_SECONDS' $heartbeatSeconds

$rgSkipGauss = Get-RgConfigValue 'SKIP_GAUSSVIEW'
if ($rgSkipGauss -isnot [bool]) {
    $rgSkipGauss = $true
    [void]$rgConfigMessages.Add('SKIP_GAUSSVIEW は true または false を指定してください。既定値 true を使用します。')
}
# The previous desktop UI audit identifies this exact checkbox label.
$rgGaussBoxes = @($fields.Controls | Where-Object {
    $_.Text -eq 'GaussView変換を省略' -and $null -ne $_.PSObject.Properties['Checked']
})
if ($rgGaussBoxes.Count -eq 1) { $rgGaussBoxes[0].Checked = $rgSkipGauss }
else { [void]$rgConfigMessages.Add('GaussView変換を省略するチェックボックスを特定できません。元の設定を維持します。') }
if ($rgConfigMessages.Count) {
    $rgMessage = $rgConfigPath + [Environment]::NewLine + [Environment]::NewLine + ($rgConfigMessages -join [Environment]::NewLine)
    [void][System.Windows.Forms.MessageBox]::Show($rgMessage,'REACTION GENERATOR 設定の確認',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Warning)
}
# RG-COLAB-PERSONAL-DEFAULTS-END
'@
    $modified=$old.Insert($anchor[0].Index,$loader+[Environment]::NewLine+[Environment]::NewLine)
    [void](Parse-Source $modified)
    Write-BackedUp $desktop $modified $true
}
$configPath=Join-Path (Split-Path -Parent $dir) 'REACTION_GENERATOR.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    $defaults=[ordered]@{colabReaction=[ordered]@{N_MOVE=198;IPOPT_LOG_EVERY=10;NO_OUTPUT_NOTICE_SECONDS=300;SKIP_GAUSSVIEW=$true}}
    [IO.File]::WriteAllText($configPath,($defaults|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Write-Host ('Created: '+$configPath)
} else { Write-Host ('Existing settings kept: '+$configPath) }
}
Invoke-RgPatch 'Desktop editor and wording' {
$dist=Join-Path (Split-Path -Parent $dir) 'MolBench\dist'
$p=Join-Path $dist 'editor.html'
if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw 'Local editor.html not found.' }
$old=[IO.File]::ReadAllText($p)
if (-not $old.Contains('id="optimizeUMA"')) { throw 'This is not the documented desktop UMA editor.' }
$new=$old
if (-not $new.Contains('rg-gfn1-desktop-v2')) {
    $pat1=[regex]'(?is)<button\b[^>]*\bid=["'']optimizeGfn1["''][^>]*>.*?</button>'
    $pat2=[regex]'(?is)<button\b[^>]*\bid=["'']optimize["''][^>]*>.*?</button>'
    $m1=$pat1.Matches($new)
    $m2=$pat2.Matches($new)
    if ($m1.Count -ne 1 -or $m2.Count -ne 1) { throw 'GFN buttons not unique.' }
    $gfn1=$m1[0].Value
    $gfn1=[regex]::Replace($gfn1,'\bgfn1-extra\b','')
    $new=$new.Remove($m1[0].Index,$m1[0].Length)
    $gfn2=$pat2.Match($new)
    $wrapper='<span class="rg-gfn1-desktop-v2">'+$gfn2.Value+$gfn1+'</span>'
    $new=$new.Remove($gfn2.Index,$gfn2.Length).Insert($gfn2.Index,$wrapper)
    $css=@'
<style id="rg-gfn1-desktop-v2-style">
.rg-gfn1-desktop-v2{display:inline-flex;flex-direction:column;align-items:stretch;gap:0;vertical-align:middle}
.rg-gfn1-desktop-v2 button{width:100%;white-space:nowrap}
.rg-gfn1-desktop-v2 #optimizeGfn1{display:none!important}
.rg-gfn1-desktop-v2:hover #optimizeGfn1,.rg-gfn1-desktop-v2:focus-within #optimizeGfn1{display:block!important}
</style>
'@
    $head=$new.IndexOf('</head>',[StringComparison]::OrdinalIgnoreCase)
    if ($head -lt 0) { throw 'Missing head tag.' }
    $new=$new.Insert($head,$css+[Environment]::NewLine)
}
$new=[regex]::Replace($new,'(?i)(\bid=["'']speed["''][^>]*\bvalue=["''])1(?:\.0)?(["''])','15$2')
$new=[regex]::Replace($new,'(?i)(\bid=["'']speedValue["''][^>]*>)\s*1\.0(\s*Å/s)','$'+'{1}5.0$2')
$new=$new.Replace('上書きしますか','上書きをしますか')
if ($new -cne $old) { Write-BackedUp $p $new $false } else { Write-Host 'Editor fixes already present.' }
# Exact wording correction only in nearby application source, preserving all other content.
foreach ($name in @('colab-local.js','slideshow.js','reaction-editor.js','common.js','reaction-viewer.html')) {
    $f=Join-Path $dist $name
    if (Test-Path -LiteralPath $f -PathType Leaf) {
        $oldText=[IO.File]::ReadAllText($f)
        if ($oldText.Contains('上書きしますか')) { Write-BackedUp $f ($oldText.Replace('上書きしますか','上書きをしますか')) $false }
    }
}
}

[void](New-Item -ItemType Directory -Path $cacheDir -Force)
[IO.File]::WriteAllText($cache,$dir,[Text.UTF8Encoding]::new($false))

if (-not $NoSourceExport) {
    try {
        $app=Split-Path -Parent $dir
        $desktopPath=[Environment]::GetFolderPath('Desktop')
        if (-not $desktopPath -or -not (Test-Path -LiteralPath $desktopPath)) { $desktopPath=$HOME }
        $out=Join-Path $desktopPath ('RG_Desktop_Source_Review_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'.txt')
        $sb=New-Object Text.StringBuilder
        [void]$sb.AppendLine('REACTION GENERATOR - relevant installed source only. No data, settings or logs included.')
        $sources=New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
        $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $addSource={
            param($file)
            if ($file -and $file.Length -le 1500000 -and $seen.Add($file.FullName)) { $sources.Add($file) }
        }
        foreach ($base in @($app,$dir)) {
            Get-ChildItem -LiteralPath $base -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Extension -in @('.ps1','.py','.sh','.cmd','.bat') -and $_.Name -notmatch '(?i)secret|token|credential|private.?key' } |
                ForEach-Object { & $addSource $_ }
        }
        $mol=Join-Path $app 'MolBench'
        foreach ($rel in @('desktop.py','dist\colab-local.js','dist\colab.html','dist\editor.html','dist\slideshow.js','dist\reaction-viewer.html','dist\reaction-store.js','dist\reactions.js')) {
            $p=Join-Path $mol $rel
            if (Test-Path -LiteralPath $p -PathType Leaf) { & $addSource (Get-Item -LiteralPath $p) }
        }
        foreach ($orca in @('C:\Apps\ORCA-Calc',(Join-Path $app 'ORCA-Calc'))) {
            foreach ($sub in @('core','desktop_ui')) {
                $base=Join-Path $orca $sub
                if (Test-Path -LiteralPath $base -PathType Container) {
                    Get-ChildItem -LiteralPath $base -Filter '*.py' -File -ErrorAction SilentlyContinue |
                        ForEach-Object { & $addSource $_ }
                }
            }
        }
        foreach ($f in $sources) {
            if ($sb.Length -gt 5000000) { [void]$sb.AppendLine('Size limit reached.');break }
            [void]$sb.AppendLine('')
            [void]$sb.AppendLine('===== BEGIN SOURCE FILE =====')
            # Keep only relative app paths or the final ORCA directory/name.
            $label=if ($f.FullName.StartsWith($app,[StringComparison]::OrdinalIgnoreCase)) {
                $f.FullName.Substring($app.Length).TrimStart([char]92)
            } else { 'ORCA-Calc\'+$f.Directory.Name+'\'+$f.Name }
            [void]$sb.AppendLine('PATH: '+$label)
            [void]$sb.AppendLine([IO.File]::ReadAllText($f.FullName))
            [void]$sb.AppendLine('===== END SOURCE FILE =====')
        }
        [IO.File]::WriteAllText($out,$sb.ToString(),[Text.UTF8Encoding]::new($false))
        Write-Host ('Remaining source review file: '+$out)
        Write-Host 'This is a local text file. It is NOT uploaded automatically. Review it before sharing.'
    } catch { Write-Warning ('Source export failed: '+$_.Exception.Message) }
}
Write-Host ('Completed: '+$script:rgOK+' groups; blocked: '+$script:rgFailed+' groups.')
Write-Host 'No jobs started or stopped, and no calculation data or libraries deleted.'
if ($script:rgFailed) { exit 2 }
