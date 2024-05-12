type RefObject<T> = { readonly current: T }
declare global {
  var hotness: undefined | RefObject<Hotness>
}

type HotDisposable<T> = T & {
  [Symbol.dispose](this: T, last: T, next: T): void
}

export class Hotness {
  static version = "hotness 2.13"
  version = Hotness.version

  count = -1

  disposables = new Map<string, HotDisposable<any>>()
  listeners: (null | (() => void))[] = [];

  [Symbol.dispose]() {
    this.listeners.forEach((it, i, them) => ((them[i] = null), it?.()))
    this.listeners = []
  }

  using<T extends Record<string, HotDisposable<any>>>(meta: ImportMeta, map: T): T {
    for (const [id, current] of Object.entries(map)) this.usingOne(meta, id, current)
    return map
  }

  usingOne<T extends HotDisposable<any>>({ filename }: ImportMeta, id: string, current: T): T {
    const key = `${filename}#${id}`
    const old = this.disposables.get(key)
    this.disposables.set(key, current)
    try {
      old?.[Symbol.dispose]?.(old, current)
    } catch (error) {
      console.warn("Hotness.using", "error disposing", { key, error })
    }
    return current
  }

  static get current(): Hotness {
    const old = globalThis.hotness?.current
    if (old?.version === Hotness.version) return old

    globalThis.hotness = { current: new Hotness() }
    return globalThis.hotness!.current
  }

  static onHotReload(listener: (old: Hotness, current: Hotness) => void): void {
    const old = { ...Hotness.current } as Hotness
    Hotness.current.listeners.push(() => listener(old, Hotness.current))
  }
}

Hotness.current.count++
Hotness.current[Symbol.dispose]()

if (import.meta.main) {
  console.log(`<TEST id=${Hotness.current.count}>`, import.meta.filename)
  setImmediate(() => Hotness.onHotReload(({ count }) => console.log(`</TEST id=${count}>\n`)))

  const testObject: HotDisposable<{ id: string }> = {
    id: new Date().toLocaleTimeString() + " " + Hotness.current.count,
    [Symbol.dispose]: function ({ id: OLD }, { id: NEW }): void {
      console.log("Hot reloaded! disposed of old object.", { OLD, NEW })
    },
  }

  Hotness.current.using(import.meta, { testObject })

  Hotness.onHotReload(({ count, version }) => {
    console.log("onHotReload, Hot reloaded! ran once listener. ", { count, version })
  })
}
