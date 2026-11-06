// Сон кошки. Как и голод, считается по накопленной работе программы, а не по часам на стене.
// Режим: бодрствует AWAKE_MS — устаёт и засыпает; человек отошёл — засыпает сразу, скучно.
// Спит NAP_MS и просыпается сама, но только когда человек вернулся.
// Будить не доспавшую можно, но она это запоминает: вялая → злая → обиделась и ушла за край экрана.
// Приложение зовёт `step` на каждом кадре с разницей Date.now(); разница обрезается до [0, MAX_STEP_MS].

import { MAX_STEP_MS } from './hunger';

const MIN = 60_000;

/** Столько бодрствует после полного сна — и хочет спать. */
export const AWAKE_MS = 40 * MIN;
/** Столько спит, если не будить; столько же спит за краем экрана, когда обиделась. */
export const NAP_MS = 20 * MIN;
/** Поспала столько — разбудить можно без обид, сон засчитан как полный. */
export const RESTED_MS = 15 * MIN;
/** Столько вялая после первой побудки, потом засыпает на ходу. */
export const GROGGY_MS = 30_000;
/** Столько злая после второй побудки, потом засыпает. */
export const ANGRY_MS = 10_000;

export interface Sleep {
  /** Мс бодрствования с последнего полного сна. */
  awake: number;
  /** Спит дома, на экране. */
  asleep: boolean;
  /** Мс сна в текущем заходе; побудки «не доспала» его не сбрасывают. */
  slept: number;
  /** Сколько раз разбудили не доспавшей, 0..3; сбрасывается полным сном. */
  wakes: number;
  /** Мс до того, как разбуженная уснёт снова; >0 — вялая (wakes 1) или злая (wakes 2). */
  cranky: number;
  /** Мс сна за краем экрана; >0 — обиделась и ушла. */
  away: number;
}

export type SleepEvent = 'sleep' | 'wake' | 'doze' | 'return';
export type Mood = 'awake' | 'asleep' | 'groggy' | 'angry' | 'away';
export type PokeResult = 'wake' | 'groggy' | 'angry' | 'leave';

/** Первый запуск: бодрая, никем не разбуженная. */
export function fresh(): Sleep {
  return { awake: 0, asleep: false, slept: 0, wakes: 0, cranky: 0, away: 0 };
}

/** Что показывать. Ушла важнее всего, разбуженная — важнее сна. */
export function mood(s: Sleep): Mood {
  if (s.away > 0) return 'away';
  if (s.cranky > 0) return s.wakes === 2 ? 'angry' : 'groggy';
  return s.asleep ? 'asleep' : 'awake';
}

/** Полный сон: проснулась выспавшейся, обиды забыты. */
const rested = (s: Sleep): Sleep => ({ ...s, asleep: false, slept: 0, awake: 0, wakes: 0, cranky: 0 });

/** Один кадр жизни. Чистая функция: возвращает новый объект и событие, вход не трогает. */
export function step(s: Sleep, ms: number, humanIdle: boolean): [Sleep, SleepEvent | null] {
  const dt = Math.min(Math.max(ms, 0), MAX_STEP_MS) || 0;

  // Спит за краем: вытащить нельзя, возвращается сама выспавшейся.
  if (s.away > 0) {
    const away = s.away - dt;
    if (away > 0) return [{ ...s, away }, null];
    return [{ ...rested(s), away: 0 }, 'return'];
  }

  // Разбуженная: походит вялой или злой и уснёт на ходу; сон продолжается, slept не сбрасывается.
  if (s.cranky > 0) {
    const cranky = s.cranky - dt;
    const awake = s.awake + dt;
    if (cranky > 0) return [{ ...s, cranky, awake }, null];
    return [{ ...s, cranky: 0, awake, asleep: true }, 'doze'];
  }

  // Спит дома: выспалась — просыпается, но пока человек отошёл, спит дальше.
  if (s.asleep) {
    const n: Sleep = { ...s, slept: s.slept + dt };
    if (n.slept >= NAP_MS && !humanIdle) return [rested(n), 'wake'];
    return [n, null];
  }

  // Бодрая: устала или скучно без человека — засыпает.
  const n: Sleep = { ...s, awake: s.awake + dt };
  if (n.awake >= AWAKE_MS || humanIdle) return [{ ...n, asleep: true, slept: 0 }, 'sleep'];
  return [n, null];
}

/**
 * Побудка: клик или тряска курсора. Выспавшаяся просыпается спокойно, не доспавшая — по лестнице
 * вялая → злая → уходит. Бодрую и ушедшую побудка не касается: тогда [тот же объект, null].
 */
export function poke(s: Sleep): [Sleep, PokeResult | null] {
  if (s.away > 0 || (!s.asleep && s.cranky <= 0)) return [s, null];
  if (s.asleep && s.slept >= RESTED_MS) return [rested(s), 'wake'];

  const wakes = Math.min(s.wakes + 1, 3);
  const n: Sleep = { ...s, asleep: false, wakes };
  if (wakes === 1) return [{ ...n, cranky: GROGGY_MS }, 'groggy'];
  if (wakes === 2) return [{ ...n, cranky: ANGRY_MS }, 'angry'];
  return [{ ...n, cranky: 0, away: NAP_MS, slept: 0 }, 'leave'];
}

/**
 * Позвали из трея: досыпающая за краем в обиде прощает и приходит, хоть и не доспала.
 * Считается выспавшейся — иначе первая же побудка дома снова увела бы её за край.
 * Дома зов на сон не влияет: тот же объект.
 */
export function call(s: Sleep): Sleep {
  return s.away > 0 ? { ...rested(s), away: 0 } : s;
}

/**
 * Заскучала на фильме: уходит спать за край, как обиженная, только без обид — побудки не копятся.
 * Вернётся сама через NAP_MS выспавшейся; громкая сцена может позвать раньше (`call`).
 */
export function bored(s: Sleep): Sleep {
  return { ...s, asleep: false, cranky: 0, wakes: 0, away: NAP_MS };
}

/**
 * Разбудил фильм: не побудка, обид нет. Поспала RESTED_MS — сон засчитан полным; меньше — проснулась,
 * но усталость (`awake`) осталась и догонит после титров. Не спящую дома не касается: тот же объект.
 */
export function stir(s: Sleep): Sleep {
  if (!s.asleep || s.cranky > 0 || s.away > 0) return s;
  return s.slept >= RESTED_MS ? rested(s) : { ...s, asleep: false, slept: 0 };
}

const okNum =(v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Разбор из localStorage. Битое или подделанное начинает заново, а не ломает кошку посреди жизни. */
export function load(raw: string | null): Sleep {
  if (raw === null) return fresh();
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return fresh();
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return fresh();
  const { awake, asleep, slept, wakes, cranky, away } = o as Record<string, unknown>;
  if (
    !okNum(awake) ||
    typeof asleep !== 'boolean' ||
    !okNum(slept) ||
    !okNum(wakes) ||
    !okNum(cranky) ||
    !okNum(away)
  )
    return fresh();
  const w = Math.min(Math.floor(wakes), 3);
  // Разбуженная бывает только вялой (1) или злой (2) и при этом не спит.
  if (cranky > 0 && (asleep || (w !== 1 && w !== 2))) return fresh();
  return { awake, asleep, slept, wakes: w, cranky, away };
}

export function save(s: Sleep): string {
  return JSON.stringify(s);
}
