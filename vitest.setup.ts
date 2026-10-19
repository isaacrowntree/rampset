import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// Node 26 ships an experimental (and disabled) localStorage global that
// shadows jsdom's. Replace it with a working in-memory implementation.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => void storage.clear(),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  },
});
