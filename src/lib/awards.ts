// Достижения за рекорды из статистики (stats.ts): нажатия, мышь, мыши, клубки, забота, дни вместе.
// Часть даёт наряд (wardrobe.ts). Полученное не отнимается: хранится отдельно от статистики
// (ключ 'awards'), с датой. Получила — одно облачко в общем лимите (App.svelte, boast); лимит
// занят — достижение ждёт в `unsaid`, а не теряется.
// Чистые функции: время приходит параметром.

import { t } from './i18n';
import { days, grouped, type Stats } from './stats';
import { WEARS, type Wear } from './wardrobe';

const DAY = 24 * 3600_000;
const KM = 1_000_000; // мм

type Pair = readonly [ru: string, en: string];
const say = ([ru, en]: Pair) => t(ru, en);

/** Неделя без побудок: с какой поры не будили и сколько было снов и побудок на тот момент. */
export interface Calm {
  /** С какого момента не будили, мс. */
  at: number;
  /** stats.naps и stats.woken на момент `at`; -1 — ещё не засекали, засечёт `check`. */
  naps: number;
  woken: number;
}

/** Сколько надо проспать спокойно и сколько раз за это время уснуть, чтобы засчитать неделю. */
export const CALM_DAYS = 7;
export const CALM_NAPS = 5;

type Unit = 'count' | 'keys' | 'mm' | 'days';

interface Award {
  id: string;
  title: Pair;
  /** Что сделать — подпись под названием. */
  about: Pair;
  /** Реплика в облачке, когда получила. */
  line: Pair;
  need: number;
  unit: Unit;
  have: (s: Stats, calm: Calm, now: number) => number;
  wear?: Wear;
}

// От первого (день-два) к последнему (месяцы). Наряды — в порядке WEARS.
export const AWARDS: readonly Award[] = [
  {
    id: 'petted10',
    title: ['Ласковая', 'Cuddly'],
    about: ['Погладили 10 раз', 'Petted 10 times'],
    line: ['Десять поглаживаний! По такому случаю надену бантик', "Ten pets! I'll wear a bow for the occasion"],
    need: 10,
    unit: 'count',
    have: (s) => s.petted,
    wear: 'bow',
  },
  {
    id: 'keys10k',
    title: ['Стук-стук', 'Tap-tap'],
    about: ['10 000 нажатий клавиш', '10,000 key presses'],
    line: ['10 000 нажатий! Ты стучишь, я слушаю', '10,000 key presses! You type, I listen'],
    need: 10_000,
    unit: 'keys',
    have: (s) => s.keys,
  },
  {
    id: 'km1',
    title: ['Первый километр', 'First kilometre'],
    about: ['Мышкой проехали 1 км', 'Mouse travelled 1 km'],
    line: ['Мышка проехала целый километр. А я за ней даже не гналась', "The mouse went a whole kilometre. And I didn't even chase it"],
    need: KM,
    unit: 'mm',
    have: (s) => s.mouseMm,
  },
  {
    id: 'caught10',
    title: ['Охотница', 'Huntress'],
    about: ['Поймала 10 мышей', 'Caught 10 mice'],
    line: ['Десятая мышь! Я грозная охотница', 'Mouse number ten! Fear me'],
    need: 10,
    unit: 'count',
    have: (s) => s.caught,
  },
  {
    id: 'yarns20',
    title: ['Мастер клубка', 'Yarn master'],
    about: ['Поиграла с 20 клубками', 'Played with 20 yarn balls'],
    line: ['Двадцать клубков! Ни один не смотала обратно', "Twenty yarn balls! Didn't wind a single one back"],
    need: 20,
    unit: 'count',
    have: (s) => s.yarns,
  },
  {
    id: 'fed50',
    title: ['Сытая жизнь', 'Well fed'],
    about: ['Покормили 50 раз', 'Fed 50 times'],
    line: ['Пятьдесят мисок! Живу как королева. Почти', 'Fifty bowls! Living like a queen. Almost'],
    need: 50,
    unit: 'count',
    have: (s) => s.fed,
  },
  {
    id: 'calm7',
    title: ['Сладкий сон', 'Sweet dreams'],
    about: ['Неделю ни разу не будили', 'Not woken up for a week'],
    line: ['Целую неделю никто не будил. Высыпаюсь!', 'A whole week without being woken up. So rested!'],
    need: CALM_DAYS,
    unit: 'days',
    // спокойные дни; пока снов меньше CALM_NAPS, неделя не засчитывается — вдруг программу просто не включали
    have: (s, calm, now) => {
      const d = Math.max(0, Math.floor((now - calm.at) / DAY));
      return s.naps - calm.naps >= CALM_NAPS ? d : Math.min(CALM_DAYS - 1, d);
    },
  },
  {
    id: 'caught50',
    title: ['Гроза мышей', 'Mouse menace'],
    about: ['Поймала 50 мышей', 'Caught 50 mice'],
    line: ['Пятьдесят мышей! Повяжу платок, как настоящий охотник', 'Fifty mice! Time for a hunter’s bandana'],
    need: 50,
    unit: 'count',
    have: (s) => s.caught,
    wear: 'bandana',
  },
  {
    id: 'km10',
    title: ['Десять километров', 'Ten kilometres'],
    about: ['Мышкой проехали 10 км', 'Mouse travelled 10 km'],
    line: ['Десять километров мышкой! Мне за это ошейник с колокольчиком', 'Ten kilometres of mouse! That earns me a bell collar'],
    need: 10 * KM,
    unit: 'mm',
    have: (s) => s.mouseMm,
    wear: 'bell',
  },
  {
    id: 'keys100k',
    title: ['Сто тысяч', 'Hundred thousand'],
    about: ['100 000 нажатий клавиш', '100,000 key presses'],
    line: ['Сто тысяч нажатий! Связала под этот стук шапочку', '100,000 key presses! I knitted a beanie to the clatter'],
    need: 100_000,
    unit: 'keys',
    have: (s) => s.keys,
    wear: 'beanie',
  },
  {
    id: 'km42',
    title: ['Марафон', 'Marathon'],
    about: ['Мышкой проехали 42 км', 'Mouse travelled 42 km'],
    line: ['Мышка пробежала марафон. Я болела за неё', 'The mouse ran a marathon. I cheered'],
    need: 42 * KM,
    unit: 'mm',
    have: (s) => s.mouseMm,
  },
  {
    id: 'days100',
    title: ['Сто дней', 'Hundred days'],
    about: ['Знакомы 100 дней', 'Friends for 100 days'],
    line: ['Сто дней вместе! Сегодня я в короне', 'A hundred days together! Crown on today'],
    need: 100,
    unit: 'days',
    have: (s, _calm, now) => days(s.since, now),
    wear: 'crown',
  },
];

const BY_ID = new Map(AWARDS.map((a) => [a.id, a]));

const WEAR_NAMES: Record<Wear, Pair> = {
  bow: ['Бантик', 'Bow'],
  bandana: ['Платок', 'Bandana'],
  bell: ['Колокольчик', 'Bell collar'],
  beanie: ['Шапочка', 'Beanie'],
  crown: ['Корона', 'Crown'],
};

/** Название наряда на языке интерфейса. */
export function wearName(w: Wear): string {
  return say(WEAR_NAMES[w]);
}

/** Выбор наряда: наряд, 'none' — без наряда, null — сама (последний полученный). */
export type Choice = Wear | 'none' | null;

export interface Prize {
  /** id → когда получено, мс. */
  got: Record<string, number>;
  /** Получено, но ещё не сказано облачком. */
  unsaid: string[];
  wear: Choice;
  calm: Calm;
}

export function fresh(): Prize {
  return { got: {}, unsaid: [], wear: null, calm: { at: 0, naps: -1, woken: -1 } };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Битое и чужое не роняет программу: неизвестные достижения и наряды отбрасываем. */
export function load(raw: string | null): Prize {
  const p = fresh();
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw ?? '{}') ?? {};
  } catch {
    return p;
  }
  if (typeof o !== 'object' || Array.isArray(o)) return p;
  if (o.got && typeof o.got === 'object') {
    for (const [id, at] of Object.entries(o.got as Record<string, unknown>))
      if (BY_ID.has(id) && num(at) > 0) p.got[id] = num(at);
  }
  if (Array.isArray(o.unsaid)) p.unsaid = [...new Set(o.unsaid.filter((id): id is string => typeof id === 'string' && id in p.got))];
  if (o.wear === 'none' || WEARS.includes(o.wear as Wear)) p.wear = o.wear as Choice;
  const c = (o.calm ?? {}) as Record<string, unknown>;
  if (num(c.at) > 0 && num(c.naps) >= 0 && num(c.woken) >= 0) p.calm = { at: num(c.at), naps: num(c.naps), woken: num(c.woken) };
  return p;
}

export function save(p: Prize): string {
  return JSON.stringify(p);
}

/**
 * Свериться со статистикой: засечь спокойный сон (разбудили — отсчёт заново) и выдать
 * достигнутое. Ничего не изменилось — тот же объект, чтобы не писать на диск зря.
 */
export function check(p: Prize, s: Stats, now: number): Prize {
  let calm = p.calm;
  if (calm.woken < 0 || calm.naps < 0 || s.woken !== calm.woken) calm = { at: now, naps: s.naps, woken: s.woken };
  const won = AWARDS.filter((a) => !(a.id in p.got) && a.have(s, calm, now) >= a.need).map((a) => a.id);
  if (!won.length && calm === p.calm) return p;
  const got = { ...p.got };
  for (const id of won) got[id] = now;
  return { ...p, got, unsaid: [...p.unsaid, ...won], calm };
}

/** Что сказать облачком: одно облачко на все несказанные. null — нечего. */
export function herald(p: Prize): [Prize, string] | null {
  const ids = p.unsaid.filter((id) => BY_ID.has(id));
  if (!ids.length) return null;
  const text =
    ids.length === 1
      ? say(BY_ID.get(ids[0])!.line)
      : t(`Новых достижений сразу ${ids.length}! Загляни в статистику`, `${ids.length} new achievements at once! Take a look at the stats`);
  return [{ ...p, unsaid: [] }, text];
}

/** Полученные наряды в порядке гардероба. */
export function wardrobe(p: Prize): Wear[] {
  const own = new Set(AWARDS.filter((a) => a.wear && a.id in p.got).map((a) => a.wear));
  return WEARS.filter((w) => own.has(w));
}

/** Что надето: выбранное, а если выбор «сама» — последний полученный наряд. */
export function worn(p: Prize): Wear | null {
  if (p.wear === 'none') return null;
  const own = wardrobe(p);
  if (p.wear && own.includes(p.wear)) return p.wear;
  let best: Wear | null = null;
  let at = -Infinity;
  for (const a of AWARDS) if (a.wear && a.id in p.got && p.got[a.id] >= at) [best, at] = [a.wear, p.got[a.id]];
  return best;
}

/** Выбрать наряд. Чужое и неполученное — «сама». */
export function choose(p: Prize, c: unknown): Prize {
  const wear: Choice = c === 'none' ? 'none' : WEARS.includes(c as Wear) && wardrobe(p).includes(c as Wear) ? (c as Wear) : null;
  return wear === p.wear ? p : { ...p, wear };
}

/** «64 тыс» вместо «64 200»: прогресс пишется мелко и должен влезать в строку. */
function short(n: number): string {
  return n < 10_000 ? grouped(n) : t(`${Math.floor(n / 1000)} тыс`, `${Math.floor(n / 1000)}k`);
}

/** Прогресс коротко: «7 / 10», «64 тыс / 100 тыс», «3,4 / 10 км», «12 / 100 дн». */
export function progress(unit: Unit, have: number, need: number): string {
  const h = Math.min(Math.max(0, have), need);
  if (unit === 'keys') return `${short(h)} / ${short(need)}`;
  if (unit === 'days') return t(`${h} / ${need} дн`, `${h} / ${need} days`);
  if (unit === 'mm') {
    // «3,4 / 10 км»: единицу пишем один раз, путь — в километрах с десятыми
    const km = (Math.floor((h / KM) * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return t(`${km.replace('.', ',')} / ${need / KM} км`, `${km} / ${need / KM} km`);
  }
  return `${h} / ${need}`;
}

export interface Line {
  id: string;
  title: string;
  about: string;
  wear?: Wear;
}

export interface Got extends Line {
  /** Когда получено, мс. */
  at: number;
}

export interface Next extends Line {
  /** «64 тыс / 100 тыс». */
  progress: string;
  /** 0..1. */
  meter: number;
}

/**
 * Для окна статистики: полученные (свежие сверху) и ближайшие следующие — у которых
 * больше всего сделано. Строки уже на языке интерфейса.
 */
export function board(p: Prize, s: Stats, now: number, next = 3): { got: Got[]; next: Next[]; left: number } {
  const line = (a: Award): Line => ({ id: a.id, title: say(a.title), about: say(a.about), ...(a.wear ? { wear: a.wear } : {}) });
  const got = AWARDS.filter((a) => a.id in p.got)
    .map((a) => ({ ...line(a), at: p.got[a.id] }))
    .sort((a, b) => b.at - a.at);
  const calm = p.calm.naps < 0 ? { at: now, naps: s.naps, woken: s.woken } : p.calm;
  const todo = AWARDS.filter((a) => !(a.id in p.got)).map((a, i) => {
    const have = a.have(s, calm, now);
    return { ...line(a), progress: progress(a.unit, have, a.need), meter: Math.min(1, Math.max(0, have / a.need)), i };
  });
  // ближе к цели — выше; поровну — в порядке списка
  todo.sort((a, b) => b.meter - a.meter || a.i - b.i);
  const shown = todo.slice(0, next).map(({ i: _i, ...n }) => n);
  return { got, next: shown, left: todo.length - shown.length };
}
