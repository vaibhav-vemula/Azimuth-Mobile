// react-native-mmkv v4 replaced the constructor-based `MMKV` class with a
// `createMMKV` factory (Nitro-module HybridObjects); the real library has no
// JS-only implementation, so this mock stands in for that API shape. Keep it
// in sync with whatever shape current code actually imports.
export function createMMKV(_config?: { id?: string }) {
  const store = new Map<string, string>();
  return {
    getString(key: string): string | undefined {
      return store.get(key);
    },
    set(key: string, value: string): void {
      store.set(key, value);
    },
    remove(key: string): boolean {
      return store.delete(key);
    },
  };
}
