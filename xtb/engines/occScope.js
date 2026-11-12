/**
 * Run `body` with a scope whose handles are released even if it throws. This is
 * the only way handles should be created outside long-lived engine state.
 * @param body - Receives the scope; every handle it creates must be kept.
 * @returns Whatever `body` returns.
 */
export function withHandleScope(body) {
    const scope = createHandleScope();
    try {
        return body(scope);
    }
    finally {
        scope.release();
    }
}
/**
 * A scope the caller releases itself. Used for the inner loop of a sweep, where
 * one scope is reused for thousands of points instead of allocating one per
 * point.
 * @returns An empty scope.
 */
export function createHandleScope() {
    const handles = [];
    return {
        keep(handle) {
            handles.push(handle);
            return handle;
        },
        release() {
            for (let index = handles.length - 1; index >= 0; index--) {
                // A handle embind has already reclaimed throws on a second delete, and
                // a partially built scope must still free the rest.
                try {
                    handles[index]?.delete?.();
                }
                catch {
                    continue;
                }
            }
            handles.length = 0;
        },
    };
}
//# sourceMappingURL=occScope.js.map