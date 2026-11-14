// Compact, versioned metadata for Colab record folders. No browser APIs are required.
export const SUMMARY_VERSION = '1';
const keys = {
  '計算結果':'summaryOriginalsId',
  'START.png':'summaryStartId',
  'FINAL.png':'summaryFinalId',
  'Energy.png':'summaryEnergyId',
  'config.txt':'summaryConfigId',
};
const fields = {
  'プロット点数':'summaryPoints',
  '電荷':'summaryCharge',
  'spin':'summarySpin',
  '結果出力日時':'summaryDate',
};
const encoder = new TextEncoder();
function fits(key,value) {
  return encoder.encode(key).length + encoder.encode(value).length <= 124;
}
export function parseConfig(config) {
  const result = {count: undefined, lines: {}};
  for (const line of config.split(/\r?\n/)) {
    const count = line.match(/^ファイル数: (\d+)$/);
    if (count) result.count = count[1];
    const match = line.match(/^(プロット点数|電荷|spin(?:（出力値）)?|結果出力日時):(.*)$/);
    if (!match) continue;
    const key = match[1].startsWith('spin') ? 'spin' : match[1];
    (result.lines[key] ??= []).push(line);
  }
  return result;
}
export function summaryProperties(config, files, overrideCount) {
  const parsed = parseConfig(config);
  const props = {summaryVersion:SUMMARY_VERSION};
  const count = overrideCount === undefined ? parsed.count : String(overrideCount);
  if (count !== undefined && fits('summaryCount',count)) props.summaryCount = count;
  for (const [name,key] of Object.entries(fields)) {
    // A repeated field must retain all lines; otherwise use the original config.
    const lines = parsed.lines[name] ?? [];
    const value = JSON.stringify(lines);
    if (fits(key,value)) props[key] = value;
  }
  for (const [name,key] of Object.entries(keys)) {
    const value = files.get(name) ?? '';
    if (fits(key,value)) props[key] = value;
  }
  return props;
}
export function readSummary(props) {
  if (props?.summaryVersion !== SUMMARY_VERSION) return null;
  const files = new Map(), lines = {};
  let needsFiles = false, needsConfig = false;
  for (const [name,key] of Object.entries(keys)) {
    if (!Object.hasOwn(props,key)) { needsFiles = true; continue; }
    if (props[key]) files.set(name,props[key]);
  }
  for (const [name,key] of Object.entries(fields)) {
    if (!Object.hasOwn(props,key)) { needsConfig = true; continue; }
    try {
      const value = JSON.parse(props[key]);
      if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw Error('Invalid lines');
      lines[name] = value;
    } catch { needsConfig = true; }
  }
  if (!Object.hasOwn(props,'summaryCount')) needsConfig = true;
  return {files, lines, count:props.summaryCount, needsFiles, needsConfig};
}
export function displayLines(parsed) {
  return Object.values(fields).flatMap((_,i) => parsed.lines[Object.keys(fields)[i]] ?? [])
    .map(line => line.replace(/^電荷:\s*/, '⚡ ')
      .replace(/^spin(?:（出力値）)?:\s*/, '🌀 ')
      .replace(/^(結果出力日時:.*?)（[^）]*）$/, '$1'));
}
export function resultDate(parsed) {
  const line = parsed.lines['結果出力日時']?.[0] ?? '';
  return line.match(/^結果出力日時: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)?.[1];
}
