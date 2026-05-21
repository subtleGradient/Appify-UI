export function normalizeStructuredClone() {
  const nativeStructuredClone = globalThis.structuredClone;

  if (typeof nativeStructuredClone === "function") {
    globalThis.structuredClone = nativeStructuredClone.bind(globalThis);
    return;
  }

  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}
