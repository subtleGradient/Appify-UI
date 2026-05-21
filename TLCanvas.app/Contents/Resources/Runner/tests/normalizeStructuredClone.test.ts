import { afterEach, expect, test } from "bun:test";
import { normalizeStructuredClone } from "../src/normalizeStructuredClone";

const originalStructuredClone = globalThis.structuredClone;

afterEach(() => {
  globalThis.structuredClone = originalStructuredClone;
});

test("normalizes receiver-sensitive native structuredClone functions", () => {
  const receiver = globalThis;
  globalThis.structuredClone = function <T>(this: typeof globalThis, value: T): T {
    if (this !== receiver) {
      throw new TypeError("Can only call Window.structuredClone on instances of Window");
    }

    return value;
  };

  const unboundBeforeNormalize = globalThis.structuredClone;
  expect(() => unboundBeforeNormalize({ broken: true })).toThrow(TypeError);

  normalizeStructuredClone();

  const unboundAfterNormalize = globalThis.structuredClone;
  expect(unboundAfterNormalize({ ok: true })).toEqual({ ok: true });
});

test("installs a fallback when structuredClone is missing", () => {
  globalThis.structuredClone = undefined as unknown as typeof structuredClone;

  normalizeStructuredClone();

  expect(globalThis.structuredClone({ nested: { value: 1 } })).toEqual({
    nested: { value: 1 },
  });
});
