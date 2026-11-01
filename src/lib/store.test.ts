import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Backend, type Key, KEYS, type Legacy, localLegacy, memoryStore, open, tauriBackend } from './store';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Пропустить микрозадачи, чтобы цепочки await добежали до очередной паузы. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface SaveCall {
  key: Key;
  value: string;
  d: Deferred<void>;
}

/** Бэкенд, где каждый save висит, пока тест не завершит его руками; load отдаёт files. */
function fakeBackend(files: Partial<Record<Key, string>> = {}) {
  const calls: SaveCall[] = [];
  const active = new Map<Key, number>();
  let overlap = false;
  const backend: Backend = {
    load: vi.fn(async (key: Key) => files[key] ?? null),
    save: vi.fn((key: Key, value: string) => {
      const d = deferred();
      calls.push({ key, value, d });
      active.set(key, (active.get(key) ?? 0) + 1);
      if ((active.get(key) ?? 0) > 1) overlap = true;
      return d.promise.finally(() => active.set(key, (active.get(key) ?? 1) - 1));
    }),
  };
  return { backend, calls, overlapped: () => overlap };
}

/** Старое хранилище на Map. */
function fakeLegacy(init: Partial<Record<Key, string>> = {}) {
  const m = new Map<Key, string>(Object.entries(init) as [Key, string][]);
  const legacy: Legacy = { get: (k) => m.get(k) ?? null, remove: vi.fn((k: Key) => void m.delete(k)) };
  return { legacy, m };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe('open', () => {
  it('грузит все ключи и отдаёт их синхронно', async () => {
    const { backend } = fakeBackend({ belly: 'b', settings: 's' });
    const store = await open(backend);
    expect(backend.load).toHaveBeenCalledTimes(KEYS.length);
    expect(store.get('belly')).toBe('b');
    expect(store.get('settings')).toBe('s');
    expect(store.get('sleep')).toBeNull();
  });

  it('все load стартуют, не дожидаясь друг друга', async () => {
    const ds = new Map<Key, Deferred<string | null>>();
    const backend: Backend = {
      load: (k) => {
        const d = deferred<string | null>();
        ds.set(k, d);
        return d.promise;
      },
      save: async () => {},
    };
    const p = open(backend);
    await tick();
    expect(ds.size).toBe(KEYS.length);
    ds.forEach((d) => d.resolve(null));
    await p;
  });

  it('ошибка чтения одного ключа не валит остальные', async () => {
    const backend: Backend = {
      load: async (k) => {
        if (k === 'sleep') throw 'диск сгорел';
        return k === 'spot' ? 'x' : null;
      },
      save: async () => {},
    };
    const store = await open(backend);
    expect(store.get('sleep')).toBeNull();
    expect(store.get('spot')).toBe('x');
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('при ошибке чтения не мигрирует legacy поверх возможного файла', async () => {
    const { legacy, m } = fakeLegacy({ sleep: 'old' });
    const save = vi.fn(async () => {});
    const backend: Backend = {
      load: async (k) => {
        if (k === 'sleep') throw new Error('x');
        return null;
      },
      save,
    };
    await open(backend, legacy);
    expect(save).not.toHaveBeenCalled();
    expect(m.get('sleep')).toBe('old');
  });
});

describe('миграция', () => {
  it('сохраняет значение из legacy и только после успеха удаляет его', async () => {
    const { backend, calls } = fakeBackend();
    const { legacy, m } = fakeLegacy({ belly: 'old' });
    const p = open(backend, legacy);
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ key: 'belly', value: 'old' });
    expect(legacy.remove).not.toHaveBeenCalled();
    expect(m.has('belly')).toBe(true);
    calls[0].d.resolve();
    const store = await p;
    expect(legacy.remove).toHaveBeenCalledWith('belly');
    expect(m.has('belly')).toBe(false);
    expect(store.get('belly')).toBe('old');
  });

  it('при неудачной записи legacy остаётся, а значение — в кеше', async () => {
    const { backend, calls } = fakeBackend();
    const { legacy, m } = fakeLegacy({ stats: 'old' });
    const p = open(backend, legacy);
    await tick();
    calls[0].d.reject('нет папки');
    const store = await p;
    expect(legacy.remove).not.toHaveBeenCalled();
    expect(m.get('stats')).toBe('old');
    expect(store.get('stats')).toBe('old');
    expect(errSpy).toHaveBeenCalled();
  });

  it('значение из бэкенда главнее legacy, legacy не трогается', async () => {
    const { backend, calls } = fakeBackend({ belly: 'new' });
    const { legacy, m } = fakeLegacy({ belly: 'old' });
    const store = await open(backend, legacy);
    expect(store.get('belly')).toBe('new');
    expect(calls).toHaveLength(0);
    expect(m.get('belly')).toBe('old');
  });
});

describe('set', () => {
  it('обновляет get сразу, не дожидаясь записи', async () => {
    const { backend, calls } = fakeBackend();
    const store = await open(backend);
    store.set('spot', '1');
    expect(store.get('spot')).toBe('1');
    expect(calls).toHaveLength(1);
    calls[0].d.resolve();
    await store.flush();
  });

  it('схлопывает: 3 set во время записи — всего 2 записи, побеждает последний', async () => {
    const { backend, calls } = fakeBackend();
    const store = await open(backend);
    store.set('belly', 'a');
    store.set('belly', 'b');
    store.set('belly', 'c');
    store.set('belly', 'd');
    expect(calls.map((c) => c.value)).toEqual(['a']);
    calls[0].d.resolve();
    await tick();
    expect(calls.map((c) => c.value)).toEqual(['a', 'd']);
    calls[1].d.resolve();
    await store.flush();
    expect(calls).toHaveLength(2);
  });

  it('не пишет то же значение, что уже загружено или записано', async () => {
    const { backend, calls } = fakeBackend({ belly: 'same' });
    const store = await open(backend);
    store.set('belly', 'same');
    expect(calls).toHaveLength(0);
    store.set('belly', 'x');
    calls[0].d.resolve();
    await store.flush();
    store.set('belly', 'x');
    expect(calls).toHaveLength(1);
  });

  it('вернули записанное значение, пока шла запись другого, — файл приводится к последнему', async () => {
    const { backend, calls } = fakeBackend({ belly: 'a' });
    const store = await open(backend);
    store.set('belly', 'b');
    store.set('belly', 'a');
    calls[0].d.resolve();
    await tick();
    expect(calls.map((c) => c.value)).toEqual(['b', 'a']);
    calls[1].d.resolve();
    await store.flush();
  });

  it('после неудачной записи следующий set того же значения пишет снова', async () => {
    const { backend, calls } = fakeBackend();
    const store = await open(backend);
    store.set('belly', 'v');
    calls[0].d.reject('диск полон');
    await store.flush();
    expect(errSpy).toHaveBeenCalled();
    expect(store.get('belly')).toBe('v');
    store.set('belly', 'v');
    expect(calls).toHaveLength(2);
    calls[1].d.resolve();
    await store.flush();
  });

  it('один ключ не пишется внахлёст, разные ключи — параллельно', async () => {
    const { backend, calls, overlapped } = fakeBackend();
    const store = await open(backend);
    store.set('belly', '1');
    store.set('belly', '2');
    store.set('sleep', 's');
    expect(calls.map((c) => c.key)).toEqual(['belly', 'sleep']);
    calls[0].d.resolve();
    await tick();
    calls[1].d.resolve();
    await tick();
    calls[2].d.resolve();
    await store.flush();
    expect(overlapped()).toBe(false);
    expect(calls.map((c) => `${c.key}=${c.value}`)).toEqual(['belly=1', 'sleep=s', 'belly=2']);
  });
});

describe('flush', () => {
  it('без записей сразу готов', async () => {
    const store = await open(fakeBackend().backend);
    await store.flush();
  });

  it('ждёт текущую и поставленную в очередь запись всех ключей', async () => {
    const { backend, calls } = fakeBackend();
    const store = await open(backend);
    store.set('belly', 'a');
    store.set('belly', 'b');
    store.set('stats', 'z');
    let done = false;
    const f = store.flush().then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    calls[0].d.resolve();
    await tick();
    expect(done).toBe(false);
    calls.forEach((c) => c.d.resolve());
    await f;
    expect(done).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('не зависает на неудачной записи', async () => {
    const { backend, calls } = fakeBackend();
    const store = await open(backend);
    store.set('belly', 'a');
    const f = store.flush();
    calls[0].d.reject('x');
    await f;
  });
});

describe('tauriBackend', () => {
  it('зовёт load_state / save_state с нужными аргументами', async () => {
    const invoke = vi.fn(async (cmd: string) => (cmd === 'load_state' ? 'json' : undefined));
    const b = tauriBackend(invoke);
    expect(await b.load('spot')).toBe('json');
    await b.save('spot', 'v');
    expect(invoke).toHaveBeenNthCalledWith(1, 'load_state', { key: 'spot' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_state', { key: 'spot', value: 'v' });
  });

  it('не-строка вместо null — тоже null; ошибка save пробрасывается', async () => {
    const b = tauriBackend(async (cmd) => {
      if (cmd === 'save_state') throw 'папка не выбрана';
      return null;
    });
    expect(await b.load('belly')).toBeNull();
    await expect(b.save('belly', 'x')).rejects.toBe('папка не выбрана');
  });
});

describe('memoryStore', () => {
  it('держит значения в кеше, flush завершается', async () => {
    const s = memoryStore({ belly: 'b' });
    expect(s.get('belly')).toBe('b');
    expect(s.get('sleep')).toBeNull();
    s.set('sleep', 'z');
    expect(s.get('sleep')).toBe('z');
    await s.flush();
  });
});

describe('localLegacy', () => {
  it('читает и удаляет через localStorage', () => {
    const m = new Map<string, string>([['belly', 'v']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      removeItem: (k: string) => void m.delete(k),
    });
    const l = localLegacy();
    expect(l.get('belly')).toBe('v');
    expect(l.get('spot')).toBeNull();
    l.remove('belly');
    expect(l.get('belly')).toBeNull();
  });

  it('переживает localStorage, который бросает', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: boom, removeItem: boom });
    const l = localLegacy();
    expect(l.get('belly')).toBeNull();
    expect(() => l.remove('belly')).not.toThrow();
  });

  it('переживает отсутствие localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    const l = localLegacy();
    expect(l.get('belly')).toBeNull();
    expect(() => l.remove('belly')).not.toThrow();
  });
});
