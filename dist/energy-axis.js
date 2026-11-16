// Shared zero-anchored axis used by saved Colab energy plots and the live viewer.
// Energies are relative values in kJ/mol. Ignore values outside ±500 when
// selecting the scale, and clamp them to the visible edge when drawing.
export function energyAxis(values) {
  const steps = [1, 5, 10, 20, 25, 40, 50, 100];
  let minimum = 0, maximum = 0;
  for (const energy of values) {
    if (!Number.isFinite(energy) || energy < -500 || energy > 500) continue;
    minimum = Math.min(minimum, energy);
    maximum = Math.max(maximum, energy);
  }
  const step = [...steps].reverse().find(candidate =>
    Math.ceil(-minimum / candidate) + Math.ceil(maximum / candidate) >= 4) ?? 1;
  let negative = Math.ceil(-minimum / step), positive = Math.ceil(maximum / step);
  while (negative + positive < 4) {
    if (negative <= positive) negative++;
    else positive++;
  }
  return {step, low:-negative*step, high:positive*step, negative, positive};
}
export function clampEnergy(value, axis) {
  return Math.max(axis.low, Math.min(axis.high, value));
}
