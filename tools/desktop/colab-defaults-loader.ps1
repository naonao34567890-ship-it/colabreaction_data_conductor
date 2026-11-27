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
