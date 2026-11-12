export function readEnergy(csv) {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = header.split(',').map(s => s.trim());
  const frame = columns.indexOf('image');
  const energy = columns.indexOf('Delta E vs. reactant [kcal/mol]');
  if (frame < 0 || energy < 0) throw Error('DMF_energy.csv の列を認識できません。');
  const points = [];
  for (const line of rows) {
    const fields = line.split(',');
    if (!fields[frame]?.trim() || !fields[energy]?.trim()) continue;
    const x = Number(fields[frame]), y = Number(fields[energy]) * 4.184;
    if (Number.isSafeInteger(x) && Number.isFinite(y)) points.push([x, y]);
  }
  if (!points.length) throw Error('プロットできるエネルギーがありません。');
  return points.sort((a,b) => a[0]-b[0]);
}
