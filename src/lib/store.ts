// Хранилище состояния: кеш в памяти + файлы в папке, которую выбрал человек (через Rust-команды).
// Логика чистая и без @tauri-apps: бэкенд и старое хранилище подаются снаружи, поэтому тестируется без Tauri.

export const KEYS = ['belly', 'sleep', 'stats', 'spot', 'settings', 'bowl', 'bed', 'talk'] as const;
export type Key = (typeof KEYS)[number];

export interface Backend {
  /** null — файла нет или папка не выбрана. */
  load(key: Key): Promise<string | null>;
  save(key: Key, value: string): Promise<void>;
}

/** Старое хранилище (localStorage): оттуда один раз переезжаем в файлы. */
export interface Legacy {
  get(key: Key): string | null;
  remove(key: Key): void;
}

export interface Store {
  /** Синхронно, из кеша. */
  get(key: Key): string | null;
  /** Кеш обновляется сразу, запись в файл — в фоне. */
  set(key: Key, value: string): void;
  /** Ждёт, пока все текущие и поставленные в очередь записи завершатся (успешно или нет). */
  flush(): Promise<void>;
}

interface Slot {
  /** Последнее значение, про которое точно известно, что оно в файле (загружено или записано). */
  saved: string | null;
  /** Самое свежее значение, пока идёт запись; null — ждать нечего. */
  pending: string | null;
  /** Идущий цикл записи; null — простаиваем. */
  running: Promise<void> | null;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Очередь записи по ключам. На один ключ — не больше одной записи одновременно;
 * пока идёт запись, новые значения схлопываются в последнее. Разные ключи пишутся параллельно.
 * Неудачная запись: логируем и бросаем это значение (saved не меняется), поэтому следующий set
 * того же ключа запишет снова. Повторов по таймеру нет — так проще и не плодит фоновую работу.
 */
function createStore(backend: Backend, initial: Partial<Record<Key, string>>, saved: Partial<Record<Key, string>>) {
  const cache: Partial<Record<Key, string>> = { ...initial };
  const slots = new Map<Key, Slot>();
  const slot = (key: Key): Slot => {
    let s = slots.get(key);
    if (!s) slots.set(key, (s = { saved: saved[key] ?? null, pending: null, running: null }));
    return s;
  };

  async function drain(key: Key, s: Slot): Promise<void> {
    while (s.pending !== null) {
      const value = s.pending;
      s.pending = null;
      // Вернули то, что уже в файле (пока писали промежуточное) — писать нечего.
      if (value === s.saved) continue;
      try {
        await backend.save(key, value);
        s.saved = value;
      } catch (e) {
        console.error(`store: не удалось сохранить «${key}»:`, errText(e));
      }
    }
    s.running = null;
  }

  function schedule(key: Key, value: string): void {
    const s = slot(key);
    if (s.running === null && value === s.saved) return;
    s.pending = value;
    if (s.running === null) s.running = drain(key, s);
  }

  const store: Store = {
    get: (key) => cache[key] ?? null,
    set(key, value) {
      cache[key] = value;
      schedule(key, value);
    },
    async flush() {
      // Пока кто-то пишет — ждём; set во время ожидания тоже будет подхвачен.
      for (;;) {
        const running = [...slots.values()].map((s) => s.running).filter((r): r is Promise<void> => r !== null);
        if (running.length === 0) return;
        await Promise.all(running);
      }
    },
  };
  return { store, slot };
}

export async function open(backend: Backend, legacy?: Legacy): Promise<Store> {
  const failed = new Set<Key>();
  const loaded = await Promise.all(
    KEYS.map(async (key): Promise<string | null> => {
      try {
        return await backend.load(key);
      } catch (e) {
        console.error(`store: не удалось прочитать «${key}»:`, errText(e));
        failed.add(key);
        return null;
      }
    }),
  );
  const initial: Partial<Record<Key, string>> = {};
  KEYS.forEach((key, i) => {
    const v = loaded[i];
    if (v !== null) initial[key] = v;
  });
  const { store, slot } = createStore(backend, initial, initial);

  if (legacy) {
    await Promise.all(
      KEYS.map(async (key) => {
        // Ошибка чтения — не «файла нет»: мигрировать нельзя, иначе затрём настоящий файл старьём.
        if (initial[key] !== undefined || failed.has(key)) return;
        const old = legacy.get(key);
        if (old === null) return;
        store.set(key, old);
        await slot(key).running; // set уже запустил запись; ждём её конца
        // Удаляем старое только если запись реально легла; иначе повторим при следующем запуске.
        if (slot(key).saved === old) legacy.remove(key);
      }),
    );
  }
  return store;
}

export function tauriBackend(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>): Backend {
  return {
    async load(key) {
      const v = await invoke('load_state', { key });
      return typeof v === 'string' ? v : null;
    },
    async save(key, value) {
      await invoke('save_state', { key, value });
    },
  };
}

export function localLegacy(): Legacy {
  // localStorage может бросать (запрещён, переполнен, нет в окружении) — тогда считаем, что там пусто.
  return {
    get(key) {
      try {
        return globalThis.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    remove(key) {
      try {
        globalThis.localStorage.removeItem(key);
      } catch {
        /* нечего удалять */
      }
    },
  };
}

/** Без файлов: только кеш. Для тестов и запуска вне Tauri. */
export function memoryStore(init: Partial<Record<Key, string>> = {}): Store {
  const cache = { ...init };
  return {
    get: (key) => cache[key] ?? null,
    set(key, value) {
      cache[key] = value;
    },
    flush: () => Promise.resolve(),
  };
}
