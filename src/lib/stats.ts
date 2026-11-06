// Статистика за всю жизнь программы: питомец сбежал — цифры остаются. Только счётчики и время,
// никаких названий программ и фильмов: файл лежит в папке данных и никуда не уходит.
// Копит окно кошки (App.svelte), показывает окно «Статистика» (Stats.svelte).

/** Время копится шагами кадра; больше этого за шаг не засчитываем — компьютер спал, а не мы вместе. */
export const MAX_STEP_MS = 60_000;

export const COUNTERS = [
  /** Сколько программа работала с питомцем дома, мс. */
  'together',
  /** Из них засчитанное кино, мс. */
  'filmMs',
  'films',
  'fed',
  'petted',
  'carried',
  'naps',
  /** Разбудили кликом, тряской или взяли на руки спящую. */
  'woken',
  'mice',
  /** Вернулась из-за края облизываясь. */
  'caught',
  'yarns',
  'lasers',
  'revenges',
  'puddles',
  'said',
  /** Пряталась от созвона. */
  'calls',
  /** Ушла насовсем от голода. */
  'runaways',
] as const;
export type Counter = (typeof COUNTERS)[number];

export type Stats = Record<Counter, number> & {
  /** С какого момента считаем, мс. Старые файлы без даты начинают отсчёт с первой загрузки. */
  since: number;
};

export function fresh(now: number): Stats {
  const s = { since: now } as Stats;
  for (const k of COUNTERS) s[k] = 0;
  return s;
}

/** Битое и чужое не роняет программу: непонятное поле — ноль, непонятная дата — сейчас. */
export function load(raw: string | null, now: number): Stats {
  const s = fresh(now);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw ?? '{}') ?? {};
  } catch {
    return s;
  }
  if (typeof o !== 'object') return s;
  for (const k of COUNTERS) {
    const v = Number(o[k]);
    if (Number.isFinite(v) && v > 0) s[k] = Math.floor(v);
  }
  const since = Number(o.since);
  if (Number.isFinite(since) && since > 0 && since <= now) s.since = since;
  return s;
}

export function save(s: Stats): string {
  return JSON.stringify(s);
}

/** Шаг кадра: дома — время вместе, на засчитанном сеансе — ещё и время кино. */
export function tick(s: Stats, ms: number, home: boolean, film: boolean): Stats {
  const dt = Math.min(Math.max(ms, 0), MAX_STEP_MS) || 0;
  if (!home || dt === 0) return s;
  return { ...s, together: s.together + dt, filmMs: film ? s.filmMs + dt : s.filmMs };
}

/** 1 раз, 2 раза, 5 раз, 11 раз, 21 раз. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Коротко, две старшие единицы: «меньше минуты», «12 мин», «3 ч 5 мин», «2 дн 4 ч». */
export function duration(ms: number): string {
  if (ms < MIN) return 'меньше минуты';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (d > 0) return h > 0 ? `${d} дн ${h} ч` : `${d} дн`;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  return `${m} мин`;
}

/** Сколько календарных дней прошло, считая первый: в день знакомства — 1. */
export function days(since: number, now: number): number {
  const a = new Date(since);
  const b = new Date(now);
  const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(1, Math.round((end - start) / DAY) + 1);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «6 ноября 2026»: без Intl, чтобы не зависеть от локали WebView. */
export function date(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export interface Row {
  label: string;
  value: string;
  /** Мелкая приписка под цифрой. */
  hint?: string;
}

export interface Group {
  title: string;
  rows: Row[];
}

const TIMES: [string, string, string] = ['раз', 'раза', 'раз'];

function times(n: number): string {
  return `${n} ${plural(n, TIMES)}`;
}

/** Готовые строки для окна: разделы, подписи и цифры уже по-русски. */
export function groups(s: Stats, now: number): Group[] {
  const n = days(s.since, now);
  const caught = s.mice > 0 ? `поймана ${s.caught} из ${s.mice}` : undefined;
  return [
    {
      title: 'Вместе',
      rows: [
        { label: 'Знакомы', value: `${n} ${plural(n, ['день', 'дня', 'дней'])}`, hint: `с ${date(s.since)}` },
        { label: 'Рядом на экране', value: duration(s.together) },
        { label: 'Кино вместе', value: `${s.films} ${plural(s.films, ['фильм', 'фильма', 'фильмов'])}`, hint: s.filmMs > 0 ? duration(s.filmMs) : undefined },
      ],
    },
    {
      title: 'Забота',
      rows: [
        { label: 'Покормили', value: times(s.fed) },
        { label: 'Погладили', value: times(s.petted) },
        { label: 'Носили на руках', value: times(s.carried) },
      ],
    },
    {
      title: 'Сон',
      rows: [
        { label: 'Уснула', value: times(s.naps) },
        { label: 'Разбудили', value: times(s.woken) },
      ],
    },
    {
      title: 'Игры',
      rows: [
        { label: 'Мыши', value: `${s.mice}`, hint: caught },
        { label: 'Клубки', value: `${s.yarns}` },
        { label: 'Лазерная указка', value: times(s.lasers) },
      ],
    },
    {
      title: 'Характер',
      rows: [
        { label: 'Мстила', value: times(s.revenges), hint: s.puddles > 0 ? `луж: ${s.puddles}` : undefined },
        { label: 'Пряталась от созвонов', value: times(s.calls) },
        { label: 'Облачков с мыслями', value: `${s.said}` },
        { label: 'Сбежала от голода', value: times(s.runaways) },
      ],
    },
  ];
}
