/**
 * Рост питомца: малыш → подросток → взрослая — по чистому времени вместе (stats.together, тот же
 * счёт, что у тортиков). Счёт — от появления этого питомца: «Новый котик» начинает с малыша,
 * а статистика остаётся общей.
 *
 * Рост не случается тихо между кадрами: стадия на экране меняется моментом («смотри, я подросла!»),
 * поэтому хранится и та, что человек уже видел. Через месяц открывается сила — форму можно
 * выбрать в настройках, и она меняет только внешность.
 */
import { ANIMS, type Anims, type Fat, type Frame } from './sprite';
import { YOUNG_ANIMS } from './sprite-young';
import { FORMS, type Form } from './settings';

/** 0 — малыш, 1 — подросток, 2 — взрослая. */
export type Stage = 0 | 1 | 2;
/** Форма в настройках, когда сила открыта (живёт в settings.ts, чтобы окно настроек не тянуло спрайты). */
export { FORMS, type Form };

const HOUR = 3_600_000;
/** С какого времени вместе подросток и взрослая; со взрослой открывается и выбор формы. */
export const TEEN_AT = 360 * HOUR;
export const ADULT_AT = 720 * HOUR;

export interface Growth {
  /** stats.together в момент появления этого питомца. */
  born: number;
  /** Пришла из версии без роста: уже взрослая и малышом не станет. */
  grown: boolean;
  /** Стадия, которую человек уже видел. */
  seen: Stage;
  /** Сила показана — форма выбирается в настройках. */
  power: boolean;
}

/** Новый питомец: малыш с нынешней отметки общего времени. */
export const fresh = (born = 0): Growth => ({ born: Math.max(0, born), grown: false, seen: 0, power: false });

/**
 * Пользователь из версии без роста. Его кошка всегда была взрослой на вид — уменьшать её нельзя:
 * «кошку подменили». Выбор формы не даётся даром — откроется моментом, когда наберётся месяц вместе.
 */
export const legacy = (): Growth => ({ born: 0, grown: true, seen: 2, power: false });

const isStage = (v: unknown): v is Stage => v === 0 || v === 1 || v === 2;

/**
 * Разбор сохранённого. `raw` нет: `old` — в хранилище уже есть что-то от прошлых версий
 * (статистика или сытость), значит, это обновление, а не свежая установка.
 */
export function load(raw: string | null, old: boolean): Growth {
  if (raw === null) return old ? legacy() : fresh();
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) ?? {};
  } catch {
    return old ? legacy() : fresh();
  }
  if (typeof o !== 'object') return old ? legacy() : fresh();
  const born = Number(o.born);
  return {
    born: Number.isFinite(born) && born > 0 ? Math.floor(born) : 0,
    grown: o.grown === true,
    seen: isStage(o.seen) ? o.seen : 0,
    power: o.power === true,
  };
}

export const save = (g: Growth): string => JSON.stringify(g);

export const stageOf = (age: number): Stage => (age >= ADULT_AT ? 2 : age >= TEEN_AT ? 1 : 0);

/** Сколько этот питомец рядом. */
export const ageOf = (g: Growth, together: number): number => Math.max(0, together - g.born);

/** Стадия по времени. */
export const real = (g: Growth, together: number): Stage => (g.grown ? 2 : stageOf(ageOf(g, together)));

/** Сила открывается через месяц вместе — и у старых пользователей тоже, по общему счёту. */
export const ripe = (g: Growth, together: number): boolean => ageOf(g, together) >= ADULT_AT;

/** Сколько ждать выбора формы; 0 — уже открыт. */
export const remaining = (g: Growth, together: number): number => (g.power ? 0 : Math.max(0, ADULT_AT - ageOf(g, together)));

export type Moment = 'grow' | 'power';

/** Какой момент пора показать: сначала сила (она заодно и рост во взрослую), потом обычный рост. */
export function due(g: Growth, together: number): Moment | null {
  if (!g.power && ripe(g, together)) return 'power';
  return real(g, together) > g.seen ? 'grow' : null;
}

/** Момент показан. */
export const apply = (g: Growth, together: number, m: Moment): Growth => ({
  ...g,
  seen: Math.max(g.seen, real(g, together)) as Stage,
  power: g.power || m === 'power',
});

export const formStage = (f: Form): Stage => FORMS.indexOf(f) as Stage;

/** Что на экране: до момента роста — прежняя стадия, после силы — выбранная форма. */
export const shown = (g: Growth, together: number, form: Form): Stage => (g.power ? formStage(form) : (Math.min(real(g, together), g.seen) as Stage));

/**
 * Стадии момента по порядку. Рост — от прежней до новой. Сила — сначала вырасти до взрослой,
 * потом уменьшиться до малыша и вырасти обратно: «смотри, что я умею».
 */
export function steps(g: Growth, together: number, m: Moment): Stage[] {
  const from = Math.min(real(g, together), g.seen) as Stage;
  const up: Stage[] = [];
  for (let s = from; s <= 2; s++) up.push(s as Stage);
  if (m === 'grow') return up.slice(0, real(g, together) - from + 1);
  return [...up, 1, 0, 1, 2];
}

/** Сколько длится один переход момента. */
export const STEP_MS = 1600;

/**
 * Стадия на экране через `elapsed` мс от начала момента: каждый переход мерцает между старой и новой
 * стадией всё чаще и под конец остаётся на новой — «вытянулась».
 */
export function momentAt(path: Stage[], elapsed: number, stepMs = STEP_MS): Stage {
  if (path.length === 0) return 2;
  const i = Math.floor(Math.max(0, elapsed) / stepMs);
  if (i >= path.length - 1) return path[path.length - 1];
  const t = (elapsed - i * stepMs) / stepMs;
  if (t >= 0.8) return path[i + 1];
  // фаза растёт как квадрат времени: смены всё чаще
  return Math.floor(t * t * 12) % 2 === 1 ? path[i + 1] : path[i];
}

/** Сколько длится весь момент. */
export const momentMs = (path: Stage[], stepMs = STEP_MS): number => Math.max(1, path.length - 1) * stepMs;

/** После переходов кошка ещё сидит в звёздочках — момент успевают разглядеть. */
export const HOLD_MS = 2400;

/** Весь момент с паузой в конце. */
export const totalMs = (path: Stage[], stepMs = STEP_MS): number => momentMs(path, stepMs) + HOLD_MS;

/** Две россыпи звёздочек по краям кадра — меняются местами, мигают. */
const SPARKS: [number, number][][] = [
  [[2, 4], [26, 2], [27, 13], [1, 15]],
  [[5, 1], [28, 7], [24, 16], [3, 10]],
];
const STAR = ['.s.', 'sss', '.s.'];
export const SPARK_MS = 300;

/**
 * Звёздочки вокруг кошки во время момента. Рисуются только по пустым клеткам — кошку не закрывают,
 * а клики сквозь них проходят (звёздочка — украшение, не силуэт).
 */
export function sparkle(frame: Frame, elapsed: number): Frame {
  const rows = frame.map((r) => [...r]);
  for (const [x0, y0] of SPARKS[Math.floor(Math.max(0, elapsed) / SPARK_MS) % SPARKS.length])
    STAR.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const y = y0 + dy;
        const x = x0 + dx;
        if (row[dx] !== '.' && rows[y]?.[x] === '.') rows[y][x] = row[dx];
      }
    });
  return rows.map((r) => r.join(''));
}

/** Набор кадров для стадии и жирка. */
export const animsFor = (stage: Stage, fat: Fat): Anims => (stage === 2 ? ANIMS[fat] : YOUNG_ANIMS[stage][fat]);
