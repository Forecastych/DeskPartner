// Облачка-реплики: когда кошке заговорить и что сказать. Только решения — без окон и таймеров;
// окно облачка (Bubble.svelte, bubble.rs) показывает то, что выбрано здесь.
//
// Говорит редко и только в паузу: человек тут, ничего не набирает, на весь экран ничего нет.
// «Иногда» — раз в 10–30 минут, интервал каждый раз случайный; «часто» — для тех, кому нужна
// компания; «молчун» говорит только по делу (голод). Отмахнулись подряд — болтает реже.
// Работа и отдых не смешиваются: в рабочее время — только тихое «ты молодец» и забота.

import type { Chatter } from './settings';

const MIN = 60_000;

/** Между двумя случайными репликами; у молчуна их нет. */
export const RANGES: Record<Chatter, [number, number] | null> = {
  quiet: null,
  sometimes: [10 * MIN, 30 * MIN],
  often: [5 * MIN, 15 * MIN],
};
/** После любого облачка — хотя бы столько тишины, даже для заботы. */
export const GAP_MS = 3 * MIN;
/** Голодная напоминает не чаще. */
export const HUNGRY_EVERY_MS = 20 * MIN;
/** Без перерыва столько — тянется и зовёт размяться. */
export const CARE_SECS = 90 * 60;
/** Столько в фокусе — хвалит. Кошка хвалит редко, зато ценно: раз за сессию. */
export const PRAISE_SECS = 2 * 60 * 60;
/** Каждое «отмахнулись подряд» растягивает интервал на столько, но не больше чем втрое. */
const SHOO_STRETCH = 0.5;
const SHOO_MAX = 3;
/** Погладили кошку вскоре после облачка — реплика понравилась. */
export const LIKED_MS = MIN;

export interface Talk {
  /** Раньше этого случайной реплики не будет, мс эпохи. */
  next: number;
  /** Когда было последнее облачко, мс эпохи; 0 — ещё не говорила. */
  spoke: number;
  /** Сколько облачков подряд смахнули кликом. */
  shooed: number;
  /** Последняя реплика: одно и то же два раза подряд не говорим. */
  last: string;
  /** Когда напоминала про голод. */
  hungryAt: number;
  /** Длина сессии на прошлом шаге: стала меньше — человек отходил, сессия новая. */
  session: number;
  /** Что в этой сессии уже сказано: забота, похвала. */
  inSession: string[];
  /** Раз в день: ключ события → день (YYYY-MM-DD), когда его сказали. */
  daily: Record<string, string>;
}

/** Что питомец знает о моменте. */
export interface Moment {
  now: Date;
  /** Человек тут и не занят: не отошёл, не набирает текст, ничего на весь экран. */
  pause: boolean;
  /** Секунды текущей сессии без перерыва. */
  session: number;
  /** Чистое время за компом сегодня, секунды. */
  today: number;
  hungry: boolean;
  /** Кошке есть когда: дома, бодрая, стоит на месте. */
  free: boolean;
}

export interface Line {
  /** Откуда реплика — по нему считаются «раз за сессию» и «раз в день». */
  key: string;
  text: string;
}

const HUNGRY = ['Мяу… Миска пустая.', 'Есть хочу. Клик по миске?'];
const WORK = ['Ты молодец.', 'Я тут, рядом.', 'Хорошо работаем.', 'Мур. Не отвлекаю.'];
const REST = ['Мур.', 'Хорошо сидим.', 'Погладишь?', 'А я бы вздремнула.', 'Мяу!', 'Ничего не происходит. Красота.'];
const TODAY = 'Сегодня мы за компом уже {today}.';
const CARE = 'Уже {session} без перерыва. Потянемся?';
const PRAISE = '{session} в фокусе. Ты молодец.';
const MORNING = 'Доброе утро!';
const NIGHT = 'Уже {time}. Может, спать?';
const FRIDAY = 'Пятница! Маленькая вечеринка?';

export function fresh(now: number, level: Chatter, rand: () => number): Talk {
  return { next: now + interval(level, 0, rand), spoke: 0, shooed: 0, last: '', hungryAt: 0, session: 0, inSession: [], daily: {} };
}

/** Между репликами: случайно в пределах уровня, растянуто отмахиваниями. Молчуну — никогда. */
export function interval(level: Chatter, shooed: number, rand: () => number): number {
  const r = RANGES[level];
  if (!r) return Infinity;
  return (r[0] + rand() * (r[1] - r[0])) * Math.min(1 + shooed * SHOO_STRETCH, SHOO_MAX);
}

/** Рабочее время — догадка, пока человек не сказал сам: будни с 9 до 18. */
export function isWork(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5 && d.getHours() >= 9 && d.getHours() < 18;
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «2 ч 15 мин», «40 мин», «3 ч». */
export function duration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function fill(text: string, m: Moment): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return text
    .replace('{time}', `${m.now.getHours()}:${p(m.now.getMinutes())}`)
    .replace('{session}', duration(m.session))
    .replace('{today}', duration(m.today));
}

/** Случайная из списка, но не та же, что в прошлый раз. */
function any(list: string[], last: string, rand: () => number): string {
  const pool = list.length > 1 ? list.filter((t) => t !== last) : list;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Событие дня, если оно уместно сейчас и сегодня ещё не звучало. */
function daily(t: Talk, d: Date): Line | null {
  const today = dayKey(d);
  const h = d.getHours();
  const due = (key: string) => t.daily[key] !== today;
  if (h >= 5 && h < 11 && due('morning')) return { key: 'morning', text: MORNING };
  if (h < 4 && due('night')) return { key: 'night', text: NIGHT };
  if (d.getDay() === 5 && h >= 18 && due('friday')) return { key: 'friday', text: FRIDAY };
  return null;
}

/**
 * Сказать ли что-то сейчас. Возвращает новое состояние и реплику (null — молчим).
 * Голод — по делу, его скажет и молчун. Забота и похвала — как только пора, но не чаще GAP_MS.
 * Остальное — когда подошёл случайный срок; срок подошёл, а человек занят — ждёт паузы.
 */
export function say(talk: Talk, m: Moment, level: Chatter, rand: () => number): [Talk, Line | null] {
  const now = m.now.getTime();
  let t = talk;
  if (m.session < t.session) t = { ...t, inSession: [] };
  if (m.session !== t.session) t = { ...t, session: m.session };
  if (!m.hungry && t.hungryAt) t = { ...t, hungryAt: 0 };
  if (!m.pause || !m.free || now - t.spoke < GAP_MS) return [t, null];

  let line: Line | null = null;
  if (m.hungry && now - t.hungryAt >= HUNGRY_EVERY_MS) {
    line = { key: 'hungry', text: any(HUNGRY, t.last, rand) };
  } else if (level !== 'quiet') {
    const once = (key: string) => !t.inSession.includes(key);
    if (m.session >= CARE_SECS && once('care')) line = { key: 'care', text: CARE };
    else if (m.session >= PRAISE_SECS && isWork(m.now) && once('praise')) line = { key: 'praise', text: PRAISE };
    else if (now >= t.next) {
      line = daily(t, m.now);
      if (!line && m.today >= 3600 && rand() < 0.2) line = { key: 'today', text: TODAY };
      line ??= { key: isWork(m.now) ? 'work' : 'rest', text: any(isWork(m.now) ? WORK : REST, t.last, rand) };
    }
  }
  if (!line) return [t, null];

  const text = fill(line.text, m);
  t = { ...t, spoke: now, last: line.text, next: now + interval(level, t.shooed, rand) };
  if (line.key === 'hungry') t.hungryAt = now;
  if (line.key === 'care' || line.key === 'praise') t.inSession = [...t.inSession, line.key];
  if (line.key === 'morning' || line.key === 'night' || line.key === 'friday') t.daily = { ...t.daily, [line.key]: dayKey(m.now) };
  return [t, { key: line.key, text }];
}

/** Сколько висит облачко: успеть прочитать, но не застревать. */
export function shownFor(text: string): number {
  return Math.min(Math.max(3000 + text.length * 70, 4000), 9000);
}

/** Облачко смахнули кликом: следующая реплика — позже, и с каждым разом подряд ещё позже. */
export function shoo(t: Talk, level: Chatter, rand: () => number): Talk {
  const shooed = t.shooed + 1;
  return { ...t, shooed, next: t.spoke + interval(level, shooed, rand) };
}

/** Погладили вскоре после облачка — болтать можно снова как обычно. */
export function liked(t: Talk, now: number): Talk {
  return t.shooed && t.spoke && now - t.spoke <= LIKED_MS ? { ...t, shooed: 0 } : t;
}

/** Уровень сменили в настройках — срок пересчитываем от последней реплики (или от сейчас). */
export function retime(t: Talk, level: Chatter, now: number, rand: () => number): Talk {
  return { ...t, next: (t.spoke || now) + interval(level, t.shooed, rand) };
}

/** На диск — только то, что должно пережить перезапуск: отмахивания и сказанное сегодня. */
export function save(t: Talk): string {
  return JSON.stringify({ shooed: t.shooed, last: t.last, daily: t.daily });
}

export function load(raw: string | null, now: number, level: Chatter, rand: () => number): Talk {
  const t = fresh(now, level, rand);
  try {
    const s = JSON.parse(raw ?? '{}');
    const shooed = Number.isInteger(s.shooed) && s.shooed > 0 ? Math.min(s.shooed, 10) : 0;
    const daily: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.daily ?? {})) if (typeof v === 'string') daily[k] = v;
    return { ...t, shooed, last: typeof s.last === 'string' ? s.last : '', daily, next: now + interval(level, shooed, rand) };
  } catch {
    return t;
  }
}
