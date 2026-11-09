import createModule from './xtbloom_web.js';
import {angstromToBohr, initializeDownloadedEngineModule} from './app_helpers.js';

async function loadBytes(name) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw new Error('GFN1のエンジンを取得できませんでした：'+response.status);
  return new Uint8Array(await response.arrayBuffer());
}

export async function relaxGfn1({geometry, settings}, {onReady, onCycle}) {
  const [wasm, data] = await Promise.all([
    loadBytes('xtbloom_web.wasm'), loadBytes('xtbloom_web.side.wasm'),
  ]);
  const engine = await initializeDownloadedEngineModule(createModule, wasm, data);
  const xyz = geometry.elements.map((symbol, i) =>
    symbol+' '+geometry.coordinates.slice(3*i, 3*i+3).join(' ')).join('\n');
  const callback = engine.addFunction((step, atoms, pointer, energy) => onCycle(step, energy), 'viipdd');
  engine.ccall('xtbloom_web_set_optimize_step_cb', 'void', ['pointer'], [callback]);
  onReady();
  let raw;
  try {
    raw = engine.ccall('xtbloom_web_optimize', 'string',
      ['string', ...Array(10).fill('number')],
      [xyz, 1, settings.charge, settings.unpairedElectrons, 300*3.166811563e-6,
        1e-8, 1e-5, 250, settings.maxCycles, 4.5e-4, angstromToBohr(0.4)]);
  } finally {
    engine.ccall('xtbloom_web_set_optimize_step_cb', 'void', ['pointer'], [0]);
  }
  const result = JSON.parse(raw);
  if (!result.ok) throw new Error([result.error_code, result.detail || result.error].filter(Boolean).join('：') || 'GFN1の最適化に失敗しました');
  const rows = result.geometry.trim().split(/\r?\n/).map(line => line.trim().split(/\s+/));
  if (rows.length !== geometry.elements.length ||
      rows.some((row, i) => row.length !== 4 || row[0] !== geometry.elements[i])) {
    throw new Error('GFN1の結果の原子数・元素順が入力と一致しません');
  }
  return {
    coordinates: Float64Array.from(rows.flatMap(row => row.slice(1).map(Number))),
    energy: {total: result.energy_final_Eh},
    cycles: result.iterations,
    converged: Boolean(result.converged),
    sccTotal: result.scc_iterations_total,
  };
}
