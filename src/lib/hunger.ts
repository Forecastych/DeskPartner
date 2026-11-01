// Голод кошки. Время считается по накопленной работе программы, а не по часам на стене:
// перевод системных часов вперёд не морит кошку голодом, назад — не кормит.
// Приложение зовёт `step` на каждом кадре анимации с разницей Date.now(); разница обрезается
// до [0, MAX_STEP_MS], поэтому сон и гибернация ПК, как и прыжки часов, просто не засчитываются.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Столько работы после последней еды — и кошка голодна. */
export const HUNGRY_AFTER_MS = 4 * HOUR;
/** Голодна столько, а никто не покормил — уходит за край экрана искать еду сама. */
export const FORAGE_AFTER_MS = 2 * HOUR;
/** Столько её нет, пока ищет еду. */
export const FORAGE_MS = 20 * MIN;
/** Человек не кормил столько — уходит насовсем (середина задуманных 5–7 дней). */
export const RUN_AWAY_MS = 6 * DAY;
/** Больше минуты за кадр не бывает: всё сверху — сон ПК или прыжок часов. */
export const MAX_STEP_MS = 60_000;
/** Автокликер по кормушке её просто переполняет — больше не влезает. */
export const FEEDER_MAX = 6;

export interface Belly {
  /** Мс работы с последней еды из любого источника. */
  sinceMeal: number;
  /** Мс работы с тех пор, как кормил ЧЕЛОВЕК: клик по миске или пополнение кормушки. Охота и еда из кормушки не в счёт. */
  sinceHuman: number;
  /** Порций в кормушке, 0..FEEDER_MAX. */
  feeder: number;
  /** Сколько мс ещё бродит за экраном; 0 — дома. */
  away: number;
  /** Ушла насовсем. */
  gone: boolean;
}

export type BellyEvent = 'eat' | 'leave' | 'return' | 'gone';

/** Первый запуск: сразу голодна — первое, что делает новый питомец, просит есть. */
export function fresh(): Belly {
  return { sinceMeal: HUNGRY_AFTER_MS, sinceHuman: 0, feeder: 0, away: 0, gone: false };
}

export function isHungry(b: Belly): boolean {
  return b.sinceMeal >= HUNGRY_AFTER_MS;
}

/**
 * Один кадр жизни. Чистая функция: возвращает новый объект и событие, вход не трогает.
 * Насыпанное в кормушку голодная съедает всегда: выключенная кормушка меняет только то, что делает
 * клик по миске, а запас не прячет — иначе корм «пропадал» на глазах.
 */
export function step(b: Belly, ms: number): [Belly, BellyEvent | null] {
  const dt = Math.min(Math.max(ms, 0), MAX_STEP_MS) || 0;
  if (b.gone) return [b, null];

  const n: Belly = { ...b, sinceMeal: b.sinceMeal + dt, sinceHuman: b.sinceHuman + dt };

  // Уходит насовсем даже с охоты: кормить её должен человек, а не мыши за экраном.
  if (n.sinceHuman >= RUN_AWAY_MS) return [{ ...n, gone: true, away: 0 }, 'gone'];

  if (n.away > 0) {
    n.away -= dt;
    if (n.away > 0) return [n, null];
    // Вернулась сытой — нашла еду сама.
    return [{ ...n, away: 0, sinceMeal: 0 }, 'return'];
  }

  if (isHungry(n) && n.feeder > 0) return [{ ...n, feeder: n.feeder - 1, sinceMeal: 0 }, 'eat'];

  if (n.sinceMeal >= HUNGRY_AFTER_MS + FORAGE_AFTER_MS) return [{ ...n, away: FORAGE_MS }, 'leave'];

  return [n, null];
}

/** Клик по миске. Сытая кошка не ест; ушедшую — нечем кормить. Тогда возвращается тот же объект. */
export function feedBowl(b: Belly): Belly {
  if (!isHungry(b) || b.away > 0 || b.gone) return b;
  return { ...b, sinceMeal: 0, sinceHuman: 0 };
}

/** ЛКМ по кормушке: порция сверху, и это забота человека — счётчик побега сначала. */
export function refill(b: Belly): Belly {
  if (b.gone) return b;
  return { ...b, feeder: Math.min(b.feeder + 1, FEEDER_MAX), sinceHuman: 0 };
}

/** ПКМ по кормушке: забрать порцию, если переложили. */
export function takeOut(b: Belly): Belly {
  if (b.gone) return b;
  return { ...b, feeder: Math.max(b.feeder - 1, 0) };
}

const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Разбор из localStorage. Битое или подделанное начинает заново, а не ломает кошку посреди жизни. */
export function load(raw: string | null): Belly {
  if (raw === null) return fresh();
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return fresh();
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return fresh();
  const { sinceMeal, sinceHuman, feeder, away, gone } = o as Record<string, unknown>;
  if (!okNum(sinceMeal) || !okNum(sinceHuman) || !okNum(feeder) || !okNum(away) || typeof gone !== 'boolean')
    return fresh();
  return { sinceMeal, sinceHuman, feeder: Math.min(Math.floor(feeder), FEEDER_MAX), away, gone };
}

export function save(b: Belly): string {
  return JSON.stringify(b);
}
