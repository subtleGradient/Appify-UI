import { createHash } from "node:crypto";

export interface CanvasReadErrorTracker {
  log: (text: string | null, error: unknown) => void;
  reset: () => void;
}

export function createCanvasReadErrorTracker(
  logError: (message: string, error: unknown) => void = console.error,
): CanvasReadErrorTracker {
  let lastErrorKey: string | null = null;

  return {
    log(text, error) {
      const key = createHash("sha256")
        .update(text ?? "<missing>")
        .update(String(error))
        .digest("hex");

      if (key === lastErrorKey) {
        return;
      }

      lastErrorKey = key;
      logError("Failed to read canvas file", error);
    },

    reset() {
      lastErrorKey = null;
    },
  };
}
