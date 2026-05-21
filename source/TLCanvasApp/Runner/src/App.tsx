import { type Editor, Tldraw, type TLStoreSnapshot, createTLStore, loadSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import "./index.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  CANVAS_API_PATH,
  type CanvasStatePayload,
} from "./canvasApi";

interface AppProps {
  onMount?: (editor: Editor) => void;
}

const SAVE_DEBOUNCE_MS = 250;
const UPSTREAM_USER_DATA_KEY = "TLDRAW_USER_DATA_v3";
const isTestEnv = process.env.NODE_ENV === "test";
const REMOTE_SYNC_POLL_MS = isTestEnv ? 250 : 1200;

function hasCompatiblePersistedUserPreferences(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const parsedPreferences = value as {
    version?: unknown;
    user?: unknown;
  };

  return (
    typeof parsedPreferences.version === "number" &&
    typeof parsedPreferences.user === "object" &&
    parsedPreferences.user !== null
  );
}

function discardIncompatiblePersistedUserPreferences() {
  if (typeof window === "undefined") {
    return;
  }

  const storedPreferences = window.localStorage.getItem(UPSTREAM_USER_DATA_KEY);
  if (!storedPreferences) {
    return;
  }

  try {
    if (!hasCompatiblePersistedUserPreferences(JSON.parse(storedPreferences))) {
      window.localStorage.removeItem(UPSTREAM_USER_DATA_KEY);
    }
  } catch {
    window.localStorage.removeItem(UPSTREAM_USER_DATA_KEY);
  }
}

function getSnapshotKey(snapshot: TLStoreSnapshot) {
  return JSON.stringify(snapshot);
}

function reconcileRemoteSnapshot(
  currentSnapshot: TLStoreSnapshot,
  incomingSnapshot: TLStoreSnapshot,
): TLStoreSnapshot {
  const currentStore = currentSnapshot.store as Record<string, unknown>;
  const incomingStore = incomingSnapshot.store as Record<string, unknown>;

  return {
    ...incomingSnapshot,
    store: Object.fromEntries(
      Object.entries(incomingStore).map(([id, incomingRecord]) => {
        const currentRecord = currentStore[id];

        if (
          typeof currentRecord !== "object" ||
          currentRecord === null ||
          Array.isArray(currentRecord) ||
          typeof incomingRecord !== "object" ||
          incomingRecord === null ||
          Array.isArray(incomingRecord)
        ) {
          return [id, incomingRecord];
        }

        const currentRecordObject = currentRecord as Record<string, unknown>;
        const incomingRecordObject = incomingRecord as Record<string, unknown>;
        const shouldMergeProps =
          currentRecordObject.typeName === "shape" &&
          incomingRecordObject.typeName === "shape";
        const currentProps = currentRecordObject.props;
        const incomingProps = incomingRecordObject.props;

        const nextRecord = {
          ...currentRecordObject,
          ...incomingRecordObject,
        };

        if (
          shouldMergeProps &&
          typeof currentProps === "object" &&
          currentProps !== null &&
          !Array.isArray(currentProps) &&
          typeof incomingProps === "object" &&
          incomingProps !== null &&
          !Array.isArray(incomingProps)
        ) {
          nextRecord.props = {
            ...(currentProps as Record<string, unknown>),
            ...(incomingProps as Record<string, unknown>),
          };
        }

        return [id, nextRecord];
      }),
    ),
  };
}

function getCanvasApiUrl() {
  const locationHref =
    typeof window === "undefined" || !window.location?.href
      ? "http://localhost"
      : window.location.href;

  return new URL(CANVAS_API_PATH, locationHref).toString();
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") !== null;
}

function isPlainSpaceKeyEvent(event: KeyboardEvent) {
  return (
    event.code === "Space" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function App({ onMount }: AppProps) {
  const store = useMemo(() => {
    discardIncompatiblePersistedUserPreferences();
    return createTLStore();
  }, []);
  const revisionRef = useRef<number | null>(null);
  const syncedSnapshotKeyRef = useRef<string | null>(null);
  const pendingSnapshotRef = useRef<TLStoreSnapshot | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const didZoomToInitialContentRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const isSyncingRef = useRef(false);
  const isPersistingRef = useRef(false);

  const zoomToInitialContent = useCallback(() => {
    const editor = editorRef.current;

    if (
      !editor ||
      didZoomToInitialContentRef.current ||
      editor.getCurrentPageShapeIds().size === 0
    ) {
      return;
    }

    didZoomToInitialContentRef.current = true;
    const scheduleFrame: (callback: FrameRequestCallback) => number =
      typeof window.requestAnimationFrame === "function"
        ? (callback) => window.requestAnimationFrame(callback)
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);

    scheduleFrame(() => {
      editor.selectNone();
      const bounds = editor.getCurrentPageBounds();

      if (bounds) {
        editor.zoomToBounds(bounds, {
          animation: { duration: 300 },
          inset: 128,
          targetZoom: 1,
        });
        return;
      }

      editor.zoomToFit({ animation: { duration: 300 } });
    });
  }, []);

  const isCanvasState = (value: unknown): value is CanvasStatePayload => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Partial<CanvasStatePayload>;
    if (!Number.isInteger(candidate.revision) || candidate.revision < 0) {
      return false;
    }

    if (!candidate.snapshot || typeof candidate.snapshot !== "object") {
      return false;
    }

    return true;
  };

  const fetchCanvasState = useCallback(async () => {
    try {
      const response = await fetch(getCanvasApiUrl(), {
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      if (!isCanvasState(payload)) {
        return null;
      }

      return payload;
    } catch (error) {
      if (!isTestEnv) {
        console.error("Failed to load canvas state", error);
      }
      return null;
    }
  }, []);

  const syncFromServer = useCallback(async () => {
    if (isSyncingRef.current) {
      return;
    }

    isSyncingRef.current = true;

    try {
      const payload = await fetchCanvasState();
      if (isUnmountedRef.current || !payload) {
        return;
      }

      const snapshotKey = getSnapshotKey(payload.snapshot);

      if (revisionRef.current === payload.revision && syncedSnapshotKeyRef.current === snapshotKey) {
        return;
      }

      const nextSnapshot = reconcileRemoteSnapshot(
        store.getStoreSnapshot("document"),
        payload.snapshot,
      );

      store.mergeRemoteChanges(() => {
        loadSnapshot(store, nextSnapshot);
      });
      revisionRef.current = payload.revision;
      syncedSnapshotKeyRef.current = snapshotKey;
      zoomToInitialContent();
    } finally {
      isSyncingRef.current = false;
    }
  }, [fetchCanvasState, store, zoomToInitialContent]);

  const persistCanvas = useCallback(
    async (snapshot: TLStoreSnapshot, revision: number) => {
      pendingSnapshotRef.current = snapshot;
      const savedSnapshotKey = getSnapshotKey(snapshot);
      isPersistingRef.current = true;

      try {
        const response = await fetch(getCanvasApiUrl(), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(revision),
          },
          body: JSON.stringify({
            revision,
            snapshot,
          } satisfies CanvasStatePayload),
        });

        if (!response.ok) {
          if (response.status === 409) {
            await syncFromServer();

            const pendingSnapshot = pendingSnapshotRef.current;
            const nextRevision = revisionRef.current;
            const pendingSnapshotKey = pendingSnapshot === null ? null : getSnapshotKey(pendingSnapshot);

            if (
              pendingSnapshot &&
              nextRevision !== null &&
              nextRevision > revision &&
              pendingSnapshotKey !== syncedSnapshotKeyRef.current
            ) {
              if (getSnapshotKey(store.getStoreSnapshot("document")) !== pendingSnapshotKey) {
                store.mergeRemoteChanges(() => {
                  loadSnapshot(store, pendingSnapshot);
                });
              }
              await persistCanvas(pendingSnapshot, nextRevision);
            }
          }
          return;
        }

        const payload = (await response.json()) as unknown;
        if (isCanvasState(payload)) {
          revisionRef.current = payload.revision;
          const snapshotKey = getSnapshotKey(payload.snapshot);
          syncedSnapshotKeyRef.current = snapshotKey;

          if (
            pendingSnapshotRef.current &&
            [savedSnapshotKey, snapshotKey].includes(getSnapshotKey(pendingSnapshotRef.current))
          ) {
            pendingSnapshotRef.current = null;
          }
        }
      } catch (error) {
        if (!isTestEnv) {
          console.error("Failed to persist canvas state", error);
        }
      } finally {
        isPersistingRef.current = false;
      }
    },
    [syncFromServer, store],
  );

  const queuePersist = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }

    if (revisionRef.current === null || isUnmountedRef.current) {
      return;
    }

    saveTimerRef.current = setTimeout(() => {
      const revision = revisionRef.current;
      if (revision === null || isUnmountedRef.current) {
        return;
      }

      if (isPersistingRef.current) {
        queuePersist();
        return;
      }

      const snapshot = pendingSnapshotRef.current ?? store.getStoreSnapshot("document");
      void persistCanvas(snapshot, revision);
    }, SAVE_DEBOUNCE_MS);
  }, [persistCanvas, store]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialState = async () => {
      const payload = await fetchCanvasState();

      if (cancelled || !payload) {
        return;
      }

      revisionRef.current = payload.revision;
      syncedSnapshotKeyRef.current = getSnapshotKey(payload.snapshot);
      const nextSnapshot = reconcileRemoteSnapshot(
        store.getStoreSnapshot("document"),
        payload.snapshot,
      );

      store.mergeRemoteChanges(() => {
        loadSnapshot(store, nextSnapshot);
      });
      zoomToInitialContent();
    };

    void loadInitialState();

    return () => {
      cancelled = true;
    };
  }, [fetchCanvasState, store, zoomToInitialContent]);

  useEffect(() => {
    const unsubscribe = store.listen(() => {
      if (isUnmountedRef.current || revisionRef.current === null) {
        return;
      }

      pendingSnapshotRef.current = store.getStoreSnapshot("document");
      queuePersist();
    }, { source: "user", scope: "document" });

    return () => {
      unsubscribe();

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [queuePersist, store]);

  useEffect(() => {
    const preventUnhandledSpace = (event: KeyboardEvent) => {
      if (!isPlainSpaceKeyEvent(event) || isEditableKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("keydown", preventUnhandledSpace);

    return () => {
      window.removeEventListener("keydown", preventUnhandledSpace);
    };
  }, []);

  useEffect(() => {
    void syncFromServer();

    pollTimerRef.current = setInterval(() => {
      void syncFromServer();
    }, REMOTE_SYNC_POLL_MS);

    return () => {
      isUnmountedRef.current = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [syncFromServer]);

  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
    onMount?.(editor);
    zoomToInitialContent();
  };

  return (
    <div className="tlcanvas-app-shell">
      <main className="tlcanvas-app-canvas">
        <Tldraw autoFocus store={store} onMount={handleMount} />
      </main>
    </div>
  );
}

export default App;
