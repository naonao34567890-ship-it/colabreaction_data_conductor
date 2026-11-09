const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eEdD][+-]?\\d+)?';
const unit = 'kJ\\s*\\/\\s*mol|kcal\\s*\\/\\s*mol|Hartrees?|Eh|eV|a\\.u\\.';
const explicit = new RegExp(`(?:^|[\\s,;])(?:energy|E)\\s*[:=]\\s*(${number})(?:\\s*(${unit}))?(?=$|[\\s,;])`, 'i');
const only = new RegExp(`^(${number})(?:\\s*(${unit}))?$`, 'i');
const withUnit = new RegExp(`(?:^|[\\s,;])(${number})\\s*(${unit})(?=$|[\\s,;])`, 'i');

export function readFrameEnergy(comment) {
  const value = comment.trim();
  const match = only.exec(value) || explicit.exec(value) || withUnit.exec(value);
  if (!match) return null;
  const numeric = Number(match[1].replace(/[dD]/, 'e'));
  const units = match[2]?.replace(/\s+/g, '').toLowerCase();
  const scale = units === 'kj/mol' ? 1 : units === 'kcal/mol' ? 4.184 : units === 'ev' ? 96.48533212 : 2625.499639;
  const result = numeric * scale;
  return Number.isFinite(result) ? result : null;
}
