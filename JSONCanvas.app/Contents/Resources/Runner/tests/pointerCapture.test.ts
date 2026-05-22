import { expect, test } from "bun:test";
import { capturePointer, type PointerCaptureElement } from "../src/pointerCapture";

test("captures active pointers", () => {
  const pointerIds: number[] = [];
  const element: PointerCaptureElement = {
    setPointerCapture(pointerId) {
      pointerIds.push(pointerId);
    },
  };

  expect(capturePointer(element, 9)).toBe(true);
  expect(pointerIds).toEqual([9]);
});

test("ignores invalid pointer capture state from WebKit", () => {
  const domExceptionElement: PointerCaptureElement = {
    setPointerCapture() {
      throw new DOMException("The object is in an invalid state.", "InvalidStateError");
    },
  };
  const errorElement: PointerCaptureElement = {
    setPointerCapture() {
      const error = new Error("The object is in an invalid state.");
      error.name = "InvalidStateError";
      throw error;
    },
  };

  expect(capturePointer(domExceptionElement, 9)).toBe(false);
  expect(capturePointer(errorElement, 9)).toBe(false);
});

test("rethrows unexpected pointer capture errors", () => {
  const element: PointerCaptureElement = {
    setPointerCapture() {
      throw new TypeError("unexpected");
    },
  };

  expect(() => capturePointer(element, 9)).toThrow("unexpected");
});
