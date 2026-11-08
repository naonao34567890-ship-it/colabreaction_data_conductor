import { loadOCC } from '../occ/module-loader.js';
/**
 * occ's own log level. Anything below 6 prints the whole SCF trace and a
 * per-atom multipole table for every one of the 6N displacements.
 */
const LOG_LEVEL = 6;
/**
 * occ's internal thread count. It stays at 1, and COOP/COEP headers are
 * deliberately NOT added, for three measured reasons:
 *
 * 1. Without cross-origin isolation `SharedArrayBuffer` is undefined in Chrome,
 *    Safari and Firefox alike, and occjs gates thread creation on exactly that
 *    (`_emscripten_has_threading_support = () => typeof SharedArrayBuffer !=
 *    'undefined'`), so `setNumThreads(n > 1)` cannot spawn a thread at all.
 * 2. Where threads *are* available they are worth only ~1.19-1.20x at four
 *    threads and are neutral-to-harmful at eight (benzene Hessian: 294 ms at
 *    one thread, 250 ms at two, 334 ms at four, 684 ms at eight).
 * 3. occ instantiates `parallel_for` only for the DFT/HF/integral kernels and
 *    the *periodic* xTB kernels; the molecular GFN2 path has none, so even that
 *    1.2x comes from TBB/Eigen inside the dense linear algebra.
 *
 * Parallelism therefore comes from `occPool.ts` — several independent module
 * instances, one per Web Worker — which is worth 2.5x-4.3x instead.
 */
const THREAD_COUNT = 1;
/**
 * Load one occjs module instance and put it in the state every caller expects:
 * quiet, single-threaded, data directory mounted.
 * @param options - Where the wasm and data live, plus the pool sharing hooks.
 * @returns The loaded module, typed with the members this app uses.
 */
export async function loadOccModule(options = {}) {
    const module = (await loadOCC({
        wasmPath: options.wasmPath,
        dataPath: options.dataPath,
        env: environmentFor(options),
    }));
    module.setLogLevel(LOG_LEVEL);
    module.setNumThreads(THREAD_COUNT);
    return module;
}
/**
 * Turn an embind failure into a readable message.
 *
 * A C++ exception reaches JavaScript in one of two shapes and both stringify to
 * something meaningless — a bare integer, or `[object Object]`. Which shape
 * arrives is a property of the emscripten the module was compiled with: 4
 * throws the raw pointer, 5 throws a `CppException` wrapper carrying `excPtr`.
 * Both are decoded here, so a toolchain change upstream cannot silently turn
 * every occ message into `[object Object]`. Either way `getExceptionMessage`
 * wants the thrown value itself: handing it the unwrapped `excPtr` reads out of
 * bounds and takes down the module.
 *
 * Getting this wrong is not cosmetic. The optimizer recognises a collapsed
 * trust radius by matching occ's own message, so an undecoded exception turns a
 * recoverable stationary point into a hard failure.
 * @param module - The module that threw, needed to decode the pointer.
 * @param error - Whatever was thrown.
 * @returns A human-readable message.
 */
export function describeOccError(module, error) {
    if (!isOccException(error)) {
        return error instanceof Error ? error.message : String(error);
    }
    try {
        const parts = module.getExceptionMessage(error);
        return parts[1] ?? parts[0] ?? `occ threw ${String(error)}`;
    }
    catch {
        return `occ threw ${String(error)}`;
    }
}
/** Whether a thrown value is a C++ exception `getExceptionMessage` can decode. */
function isOccException(error) {
    if (typeof error === 'number')
        return true;
    return typeof error === 'object' && error !== null && 'excPtr' in error;
}
/** The emscripten `Module` overrides `loadOCC` spreads into its own config. */
function environmentFor(options) {
    const environment = {
        print: () => undefined,
        printErr: () => undefined,
    };
    const shared = options.wasmModule;
    if (shared !== undefined) {
        environment.instantiateWasm = (imports, onInstance) => {
            const instance = new WebAssembly.Instance(shared, imports);
            onInstance(instance, shared);
            return instance.exports;
        };
    }
    const dataPackage = options.dataPackage;
    if (dataPackage !== undefined) {
        environment.getPreloadedPackage = (_name, size) => dataPackage.byteLength === size ? dataPackage : null;
    }
    return environment;
}
//# sourceMappingURL=occModule.js.map