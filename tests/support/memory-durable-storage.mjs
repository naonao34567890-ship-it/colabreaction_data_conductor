// Structured-clone and atomic transaction behavior used by coordinator tests.
export function memoryStorage(values = new Map()) {
  const api = {
    async get(key) {
      return structuredClone(values.get(key));
    },
    async put(key, value) {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) values.set(k, structuredClone(v));
      } else values.set(key, structuredClone(value));
    },
    async transaction(run) {
      const staged = new Map([...values].map(([k, v]) => [k, structuredClone(v)]));
      const result = await run(memoryStorage(staged));
      values.clear();
      for (const [k, v] of staged) values.set(k, v);
      return result;
    },
  };
  return api;
}
