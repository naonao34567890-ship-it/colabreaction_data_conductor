import { alignGeometry } from './align-geometry.js';
import { loadOccModule } from './xtb/engines/occModule.js';
import { relaxInProcess } from './xtb/engines/occRelax.js';

self.onmessage = async ({data}) => {
  try {
    const module = await loadOccModule({
      wasmPath: new URL('./xtb/occ/occjs.wasm', import.meta.url).href,
      dataPath: new URL('./xtb/occ/occjs.data', import.meta.url).href,
    });
    self.postMessage({type: 'ready'});
    const result = relaxInProcess(module, data, {
      onCycle: (cycle, energy) => self.postMessage({type: 'cycle', cycle, energy}),
    });
    if (!Number.isFinite(result.energy.total) ||
        result.coordinates.length !== data.geometry.coordinates.length ||
        !result.coordinates.every(Number.isFinite)) {
      throw new Error('有限な座標とエネルギーが得られませんでした');
    }
    if (result.warnings.some(warning => warning.includes('ran a spin-restricted SCF'))) {
      throw new Error('指定したスピン状態で計算できませんでした');
    }
    result.coordinates = alignGeometry(data.geometry.coordinates, result.coordinates, data.anchor);
    self.postMessage({type: 'result', result}, [result.coordinates.buffer]);
  } catch (error) {
    self.postMessage({type: 'error', message: error.message || String(error)});
  }
};
