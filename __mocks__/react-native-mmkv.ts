// react-native-mmkv v4 replaced the constructor-based `MMKV` class with a
// `createMMKV` factory (Nitro-module HybridObjects); the real library has no
// JS-only implementation, so this mock stands in for that API shape. Keep it
// in sync with whatever shape current code actually imports.
type Value = string | number | boolean;

export function createMMKV(_config?: { id?: string }) {
  const store = new Map<string, Value>();
  return {
    getString(key: string): string | undefined {
      const v = store.get(key);
      return typeof v === 'string' ? v : undefined;
    },
    getBoolean(key: string): boolean | undefined {
      const v = store.get(key);
      return typeof v === 'boolean' ? v : undefined;
    },
    getNumber(key: string): number | undefined {
      const v = store.get(key);
      return typeof v === 'number' ? v : undefined;
    },
    set(key: string, value: Value): void {
      store.set(key, value);
    },
    remove(key: string): boolean {
      return store.delete(key);
    },
  };
}
