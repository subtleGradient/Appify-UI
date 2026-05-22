export type PointerCaptureElement = Pick<Element, "setPointerCapture">;

export function capturePointer(element: PointerCaptureElement, pointerId: number): boolean {
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch (error) {
    if (isInvalidPointerCaptureState(error)) {
      return false;
    }

    throw error;
  }
}

function isInvalidPointerCaptureState(error: unknown) {
  if (error instanceof DOMException && error.name === "InvalidStateError") {
    return true;
  }

  return error instanceof Error && error.name === "InvalidStateError";
}
