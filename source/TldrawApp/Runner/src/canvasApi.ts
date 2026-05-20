import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { TLStoreSnapshot } from "tldraw";

export const CANVAS_API_PATH = "/api/canvas";
export const CANVAS_FILE_NAME = "canvas.json5";
export const CANVAS_SCHEMA_FILE_NAME = "canvas.schema.json";
export const CANVAS_SCHEMA_URI =
  "https://cdn.jsdelivr.net/gh/subtleGradient/Appify-UI@tldraw-schema-v1/source/TldrawApp/Runner/schemas/tldraw-canvas.schema.json";

export interface CanvasStatePayload {
  revision: number;
  snapshot: TLStoreSnapshot;
}

export interface PersistedCanvasStateEnvelope extends CanvasStatePayload {
  $schema?: string;
}

export interface ObserveCanvasChangesOptions {
  canvasFilePath: string;
  pollIntervalMs?: number;
}

export function parseCanvasStatePayload(payload: Partial<PersistedCanvasStateEnvelope>): CanvasStatePayload {
  if (!Number.isInteger(payload.revision) || payload.revision < 0) {
    throw new Error("Canvas payload revision must be a non-negative integer");
  }

  if (typeof payload.snapshot !== "object" || payload.snapshot === null || Array.isArray(payload.snapshot)) {
    throw new Error("Canvas snapshot must be an object");
  }

  return {
    revision: payload.revision,
    snapshot: payload.snapshot as CanvasStatePayload["snapshot"],
  };
}

export function createPersistedCanvasStateEnvelope(state: CanvasStatePayload): PersistedCanvasStateEnvelope {
  return {
    $schema: CANVAS_SCHEMA_URI,
    revision: state.revision,
    snapshot: state.snapshot,
  };
}

export function stringifyCanvasState(state: CanvasStatePayload): string {
  return `${Bun.JSON5.stringify(createPersistedCanvasStateEnvelope(state), null, 2)}\n`;
}

async function readCanvasStateFile(canvasFilePath: string): Promise<CanvasStatePayload | null> {
  const file = Bun.file(canvasFilePath);

  if (!(await file.exists())) {
    return null;
  }

  const payload = Bun.JSON5.parse(await file.text()) as Partial<PersistedCanvasStateEnvelope>;
  return parseCanvasStatePayload(payload);
}

export async function createCanvasState({
  canvasFilePath,
  state,
}: {
  canvasFilePath: string;
  state: CanvasStatePayload;
}): Promise<CanvasStatePayload> {
  await mkdir(dirname(canvasFilePath), { recursive: true });
  await Bun.write(canvasFilePath, stringifyCanvasState(state));
  return state;
}

export async function readCanvasState({
  canvasFilePath,
}: {
  canvasFilePath: string;
}): Promise<CanvasStatePayload | null> {
  return await readCanvasStateFile(canvasFilePath);
}

export async function updateCanvasState({
  canvasFilePath,
  update,
}: {
  canvasFilePath: string;
  update: (current: CanvasStatePayload) => CanvasStatePayload | Promise<CanvasStatePayload>;
}): Promise<CanvasStatePayload> {
  const current = await readCanvasStateFile(canvasFilePath);

  if (current === null) {
    throw new Error("Canvas state does not exist");
  }

  const nextState = await update(current);
  return await createCanvasState({ canvasFilePath, state: nextState });
}

export async function deleteCanvasState({
  canvasFilePath,
}: {
  canvasFilePath: string;
}): Promise<void> {
  await rm(canvasFilePath, { force: true });
}

export function observeCanvasChanges({
  canvasFilePath,
  pollIntervalMs = 100,
}: ObserveCanvasChangesOptions): AsyncGenerator<CanvasStatePayload, void, unknown> {
  let closed = false;
  let lastEmittedSnapshotKey: string | null = null;
  const queuedValues: Array<CanvasStatePayload> = [];
  const pendingNextResolvers: Array<(result: IteratorResult<CanvasStatePayload, void>) => void> = [];

  const flushQueue = () => {
    while (queuedValues.length > 0 && pendingNextResolvers.length > 0) {
      const value = queuedValues.shift()!;
      const resolve = pendingNextResolvers.shift()!;
      resolve({ done: false, value });
    }
  };

  const resolveDone = () => {
    while (pendingNextResolvers.length > 0) {
      const resolve = pendingNextResolvers.shift()!;
      resolve({ done: true, value: undefined });
    }
  };

  void (async () => {
    while (!closed) {
      const state = await readCanvasStateFile(canvasFilePath);

      if (state !== null) {
        const snapshotKey = JSON.stringify(state.snapshot);

        if (snapshotKey !== lastEmittedSnapshotKey) {
          lastEmittedSnapshotKey = snapshotKey;
          queuedValues.push(state);
          flushQueue();
          continue;
        }
      }

      await Bun.sleep(pollIntervalMs);
    }

    resolveDone();
  })();

  return {
    async next() {
      if (queuedValues.length > 0) {
        return { done: false, value: queuedValues.shift()! };
      }

      if (closed) {
        return { done: true, value: undefined };
      }

      return await new Promise<IteratorResult<CanvasStatePayload, void>>((resolve) => {
        pendingNextResolvers.push(resolve);
      });
    },

    async return() {
      closed = true;
      resolveDone();
      return { done: true, value: undefined };
    },

    async throw(error) {
      closed = true;
      resolveDone();
      throw error;
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
