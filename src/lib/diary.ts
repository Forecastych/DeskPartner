// Дневник кошки: каждый вечер — запись от её лица о том, как прошёл день. Только то, что реально
// посчитано: сколько человек сидел за компом и в какой программе дольше всего, сколько кошка спала,
// ела, сколько раз гладили, будили, была ли месть, лоток, кино, созвоны.
//
// День копится срезом: счётчики берём разницей со статистикой на начало дня (stats.ts считает их
// за всю жизнь), а время за компом, программы и сон копим здесь сами. Закрылись сутки (в полночь
// или при первом запуске на следующий день) — срез становится записью. Хранятся факты, а не текст:
// текст собирается при показе на языке интерфейса, шаблон выбирается детерминированно от даты.
//
// Приватность: из программ в запись попадает только имя программы (FileDescription или имя exe,
// win.rs), заголовки окон сюда не приходят вовсе. Имя ещё раз проверяется: пароли, банки и
// переписки (revenge.kindOf) и всё, что похоже на путь или заголовок, не называем никогда.
//
// Чистые функции: без DOM и часов, `rnd` — параметром.

import { count, lang, pick, plural, t, type Lang } from './i18n';
import { kindOf } from './revenge';
import { COUNTERS, type Counter, MAX_STEP_MS, type Stats } from './stats';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Сколько записей храним. */
export const KEEP = 30;
/** С этого часа сегодняшняя запись видна в окне статистики (ещё пишется). */
export const EVENING = 20;
/** Программ за день помним не больше: незнакомые имена не раздувают файл. */
const APPS_MAX = 40;
/** Программа-рекордсмен — если в ней провели хотя бы столько. */
const APP_MIN_MS = 10 * MIN;
/** Меньше этого за компом — «человек почти не заходил». */
const DESK_MIN_MS = 15 * MIN;
/** Столько за компом — уже можно ворчать, что не кормили и не гладили. */
const DESK_LONG_MS = 2 * HOUR;
/** Сон короче этого не упоминаем. */
const SLEEP_MIN_MS = 10 * MIN;

/** Срез текущего дня. */
export interface Day {
  /** dayKey (chatter.ts): «2026-11-08». */
  key: string;
  /** Счётчики статистики на начало дня: сегодняшнее — разница с ними. */
  base: Record<Counter, number>;
  /** Человек за компом, мс. */
  desk: number;
  /** Имя программы → мс, пока человек за компом. Только имена, никаких заголовков. */
  apps: Record<string, number>;
  /** Кошка спала, мс. */
  sleep: number;
  /** Сходила в лоток. */
  potty: number;
}

/** Факты закрытого дня: всё, из чего собирается запись. Числа и одно имя программы. */
export interface Facts {
  day: string;
  /** За компом, мс. */
  desk: number;
  /** Дольше всего — в этой программе (уже проверенное имя). */
  app?: string;
  sleep: number;
  naps: number;
  woken: number;
  fed: number;
  petted: number;
  carried: number;
  yarns: number;
  mice: number;
  caught: number;
  lasers: number;
  revenges: number;
  puddles: number;
  films: number;
  filmMs: number;
  calls: number;
  runaways: number;
  cakes: number;
  potty: number;
}

/** Числовые поля фактов: всё, кроме дня и имени программы. */
export const NUMS = [
  'desk', 'sleep', 'naps', 'woken', 'fed', 'petted', 'carried', 'yarns', 'mice', 'caught', 'lasers',
  'revenges', 'puddles', 'films', 'filmMs', 'calls', 'runaways', 'cakes', 'potty',
] as const satisfies readonly (keyof Facts)[];

/** Какие счётчики дня берём разницей со статистикой. */
const FROM_STATS = ['naps', 'woken', 'fed', 'petted', 'carried', 'yarns', 'mice', 'caught', 'lasers', 'revenges', 'puddles', 'films', 'filmMs', 'calls', 'runaways', 'cakes'] as const satisfies readonly (Counter & keyof Facts)[];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

function snapshot(s: Stats): Record<Counter, number> {
  const b = {} as Record<Counter, number>;
  for (const k of COUNTERS) b[k] = num(s[k]);
  return b;
}

/** Новый день: счётчики статистики на этот момент — ноль дня. */
export function begin(key: string, s: Stats): Day {
  return { key, base: snapshot(s), desk: 0, apps: {}, sleep: 0, potty: 0 };
}

/** Срез с диска. Битый или без даты — день начинается заново с текущей статистики. */
export function load(raw: string | null, key: string, s: Stats): Day {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw ?? 'null');
  } catch {
    return begin(key, s);
  }
  if (!o || typeof o !== 'object' || typeof o.key !== 'string' || !DAY_RE.test(o.key)) return begin(key, s);
  const d = begin(o.key, s);
  const base = (o.base ?? {}) as Record<string, unknown>;
  // счётчика в старом файле нет — он появился позже: ноль дня = сейчас, а не ноль за жизнь
  for (const k of COUNTERS) if (k in base) d.base[k] = num(base[k]);
  d.desk = num(o.desk);
  d.sleep = num(o.sleep);
  d.potty = num(o.potty);
  if (o.apps && typeof o.apps === 'object') {
    for (const [name, ms] of Object.entries(o.apps as Record<string, unknown>)) {
      if (Object.keys(d.apps).length >= APPS_MAX) break;
      if (typeof name === 'string' && name.length <= 80 && num(ms) > 0) d.apps[name] = num(ms);
    }
  }
  return d;
}

export const save = (d: Day): string => JSON.stringify(d);

export interface Moment {
  /** Программа в активном окне (senses.app); null — неизвестно. */
  app?: string | null;
  /** Человек за компом, а не отошёл. */
  human: boolean;
  /** Кошка спит. */
  asleep: boolean;
}

/** Шаг кадра: время за компом, в программе, во сне. Компьютер спал — шаг не засчитываем. */
export function tick(d: Day, ms: number, m: Moment): Day {
  const dt = Math.min(Math.max(ms, 0), MAX_STEP_MS) || 0;
  if (dt === 0 || (!m.human && !m.asleep)) return d;
  const n = { ...d };
  if (m.asleep) n.sleep += dt;
  if (m.human) {
    n.desk += dt;
    const app = m.app?.trim();
    if (app && (app in d.apps || Object.keys(d.apps).length < APPS_MAX)) n.apps = { ...d.apps, [app]: (d.apps[app] ?? 0) + dt };
  }
  return n;
}

/** Сходила в лоток. */
export const potty = (d: Day): Day => ({ ...d, potty: d.potty + 1 });

// Оболочка Windows и сам питомец — не «программа дня»: это рабочий стол, а не занятие.
const SHELL = new Set([
  'deskpartner', 'explorer', 'проводник', 'windows explorer', 'program manager', 'lockapp', 'searchhost', 'searchapp',
  'search', 'поиск', 'shellexperiencehost', 'startmenuexperiencehost', 'applicationframehost', 'application frame host',
  'textinputhost', 'taskmgr', 'диспетчер задач', 'task manager', 'хост-процесс windows', 'host process for windows tasks',
]);

// Привычные короткие имена: FileDescription бывает длинным.
const SHORT: Record<string, string> = {
  'visual studio code': 'VS Code',
  code: 'VS Code',
  'microsoft excel': 'Excel',
  'microsoft word': 'Word',
  'microsoft powerpoint': 'PowerPoint',
  'microsoft onenote': 'OneNote',
  'microsoft teams': 'Teams',
  'microsoft edge': 'Edge',
  msedge: 'Edge',
  'google chrome': 'Chrome',
  'mozilla firefox': 'Firefox',
  'counter-strike 2': 'CS2',
  cs2: 'CS2',
  dota2: 'Dota 2',
};

/**
 * Имя программы, которое можно написать в дневнике, или null. Отсекает всё, что не похоже на
 * имя программы (путь, файл, заголовок с « - », почту, ссылку), пароли, банки и переписки,
 * оболочку Windows. Лишний раз промолчать не страшно, назвать лишнее — страшно.
 */
export function programName(app: unknown): string | null {
  // перевод строки и прочие управляющие — не имя программы
  if (typeof app !== 'string' || /\p{Cc}/u.test(app)) return null;
  const name = app.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) return null;
  // путь и запрещённые в именах файлов знаки, почта и скобки заголовков
  if (/[\\/:*?"<>|@#[\]{}]/u.test(name)) return null;
  // заголовок окна: «Отчёт.docx - Word», «Входящие — Почта»
  if (/\s[-–—]\s/.test(name)) return null;
  // похоже на файл: «report.xlsx», «photo.jpeg»
  if (/\.[\p{L}\p{N}]{2,5}$/u.test(name)) return null;
  if (/https?|www\./i.test(name) || !/\p{L}/u.test(name)) return null;
  const low = name.toLowerCase();
  if (SHELL.has(low) || kindOf(name) === 'secret') return null;
  return SHORT[low] ?? name;
}

/** Программа дня: дольше всех, с допустимым именем и не мимолётная. */
function topApp(apps: Record<string, number>): string | undefined {
  const sorted = Object.entries(apps).sort((a, b) => b[1] - a[1]);
  for (const [name, ms] of sorted) {
    if (ms < APP_MIN_MS) return undefined;
    const ok = programName(name);
    if (ok) return ok;
  }
  return undefined;
}

/** Факты дня из среза и текущей статистики. Только числа и одно проверенное имя. */
export function facts(d: Day, s: Stats): Facts {
  const f = { day: d.key, desk: d.desk, sleep: d.sleep, potty: d.potty } as Facts;
  for (const k of FROM_STATS) f[k] = Math.max(0, num(s[k]) - (d.base[k] ?? 0));
  const app = topApp(d.apps);
  if (app) f.app = app;
  return f;
}

/** Стоит ли записывать: кошку хоть сколько-то включали и что-то было. */
export const worth = (f: Facts): boolean => f.desk >= MIN || NUMS.some((k) => k !== 'desk' && f[k] > 0);

/** Добавить запись: свежие сверху, одна на день, не больше KEEP. */
export function push(list: readonly Facts[], f: Facts): Facts[] {
  return [f, ...list.filter((e) => e.day !== f.day)].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, KEEP);
}

/** Одна запись с диска: числа — числами, имя программы — ещё раз через фильтр. Чужое — null. */
export function clean(o: unknown): Facts | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.day !== 'string' || !DAY_RE.test(r.day)) return null;
  const f = { day: r.day } as Facts;
  for (const k of NUMS) f[k] = num(r[k]);
  const app = programName(r.app);
  if (app) f.app = app;
  return f;
}

export function loadList(raw: string | null): Facts[] {
  let a: unknown;
  try {
    a = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(a)) return [];
  let list: Facts[] = [];
  for (const o of a) {
    const f = clean(o);
    if (f) list = push(list, f);
  }
  return list;
}

export const saveList = (list: readonly Facts[]): string => JSON.stringify(list);

/** Детерминированный «случай» от даты: одна дата — одна и та же запись (mulberry32). */
export function seed(day: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  // перемешать: соседние даты отличаются одной буквой, а начало серии должно разойтись сразу
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Слова -------------------------------------------------------------------------------------

const WORDS_RU = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'];
const WORDS_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** «два раза» / «twice»: до десяти словами. */
export function times(n: number): string {
  if (lang() === 'en') {
    if (n === 1) return 'once';
    if (n === 2) return 'twice';
    return `${WORDS_EN[n] ?? n} times`;
  }
  return `${WORDS_RU[n] ?? n} ${plural(n, ['раз', 'раза', 'раз'])}`;
}

/** Сколько длилось, в винительном: «6 часов», «21 минуту» / «6 hours». */
export function span(ms: number): string {
  if (ms >= 50 * MIN) {
    const h = Math.max(1, Math.round(ms / HOUR));
    return count(h, ['час', 'часа', 'часов'], ['hour', 'hours']);
  }
  const m = Math.max(1, Math.round(ms / MIN));
  return count(m, ['минуту', 'минуты', 'минут'], ['minute', 'minutes']);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const mice = (n: number): string => count(n, ['мышь', 'мыши', 'мышей'], ['mouse', 'mice']);

// ---- Шаблоны -----------------------------------------------------------------------------------
// Каждый шаблон — ровно одно предложение. Кошка — она, человек — «человек» / «my human».

type Line = (f: Facts) => string;
type Table = Record<Lang, Line[]>;

const DESK_APP: Table = {
  ru: [
    (f) => `Человек ${span(f.desk)} просидел за компом, и дольше всего — в ${f.app}.`,
    (f) => `Сегодня человек ${span(f.desk)} смотрел в экран, больше всего в ${f.app}.`,
    (f) => `Человек весь день дружил с ${f.app}, а за компом провёл ${span(f.desk)}, я считала.`,
    (f) => `Главный соперник дня — ${f.app}: человек сидел за компом ${span(f.desk)}.`,
    (f) => `Человек ${span(f.desk)} стучал по клавишам, чаще всего в ${f.app}, а я наблюдала с рамки.`,
    (f) => `${cap(span(f.desk))} за компом, и почти всё в ${f.app}, а могли бы гладить меня.`,
    (f) => `Человек опять пропадал в ${f.app}, всего за компом — ${span(f.desk)}.`,
  ],
  en: [
    (f) => `My human sat at the computer for ${span(f.desk)}, mostly in ${f.app}.`,
    (f) => `Today my human stared at the screen for ${span(f.desk)}, mostly at ${f.app}.`,
    (f) => `My human spent the day with ${f.app}, ${span(f.desk)} at the computer, I counted.`,
    (f) => `Rival of the day: ${f.app}, which kept my human busy for ${span(f.desk)}.`,
    (f) => `My human tapped keys for ${span(f.desk)}, mostly in ${f.app}, while I watched from a window frame.`,
    (f) => `${cap(span(f.desk))} at the computer, nearly all of it in ${f.app}, time that could have gone to petting me.`,
    (f) => `My human vanished into ${f.app} again, ${span(f.desk)} at the computer in total.`,
  ],
};

const DESK: Table = {
  ru: [
    (f) => `Человек ${span(f.desk)} сидел за компом, чем занимался — не моё кошачье дело.`,
    (f) => `${cap(span(f.desk))} человек смотрел в экран, а я смотрела на человека.`,
    (f) => `Человек провёл за компом ${span(f.desk)}, и я всё это время была рядом.`,
    (f) => `Сегодня ${span(f.desk)} за компом, я считала каждую минуту.`,
    (f) => `Человек ${span(f.desk)} не отходил от экрана, даже интересно, что там такого.`,
  ],
  en: [
    (f) => `My human sat at the computer for ${span(f.desk)}, doing what is none of my business.`,
    (f) => `For ${span(f.desk)} my human looked at the screen, and I looked at my human.`,
    (f) => `My human spent ${span(f.desk)} at the computer, and I was there the whole time.`,
    (f) => `Today it was ${span(f.desk)} at the computer, I counted every minute.`,
    (f) => `My human didn't leave the screen for ${span(f.desk)}, I wonder what's in there.`,
  ],
};

const DESK_NONE: Table = {
  ru: [
    () => 'Человек сегодня почти не садился за комп.',
    () => 'Сегодня человек к компу почти не подходил, экран был весь мой.',
    () => 'За компом человека почти не было, я скучала самую малость.',
    () => 'Тихий день: человек заглянул ненадолго.',
    () => 'Человека за компом было мало, зато тишина.',
  ],
  en: [
    () => 'My human barely sat at the computer today.',
    () => 'My human hardly came near the computer, so the whole screen was mine.',
    () => 'My human was almost never at the computer, I missed them a tiny bit.',
    () => 'A quiet day: my human only dropped by.',
    () => 'Not much of my human at the computer today, but plenty of silence.',
  ],
};

const PUDDLE_WOKEN: Table = {
  ru: [
    (f) => `Меня ${times(f.woken)} будили — пришлось оставить лужу.`,
    (f) => `Будили ${times(f.woken)}, поэтому теперь у человека есть лужа.`,
    (f) => `Меня разбудили ${times(f.woken)}, и я оставила лужу, всё честно.`,
    (f) => `Разбудили ${times(f.woken)} — получили лужу, такие правила.`,
    (f) => `Меня будили ${times(f.woken)}, а лужа сама себя не нальёт.`,
  ],
  en: [
    (f) => `They woke me ${times(f.woken)}, so I had to leave a puddle.`,
    (f) => `I was woken ${times(f.woken)}, which is why my human now owns a puddle.`,
    (f) => `They woke me ${times(f.woken)} and I left a puddle, fair is fair.`,
    (f) => `Woke me ${times(f.woken)}, got a puddle, those are the rules.`,
    (f) => `They woke me ${times(f.woken)}, and a puddle doesn't make itself.`,
  ],
};

const PUDDLE: Table = {
  ru: [
    () => 'Оставила лужу, человек знает за что.',
    () => 'Пришлось оставить лужу, иначе до человека не доходит.',
    () => 'Сегодня была лужа, и я ни о чём не жалею.',
    () => 'Человек получил лужу, пусть подумает над своим поведением.',
    () => 'Лужа — это не каприз, это сообщение.',
  ],
  en: [
    () => 'I left a puddle, and my human knows why.',
    () => 'I had to leave a puddle, nothing else gets through to my human.',
    () => 'There was a puddle today, and I regret nothing.',
    () => 'My human got a puddle, let them think about what they did.',
    () => 'A puddle is not a whim, it is a message.',
  ],
};

const REVENGE_MISS: Table = {
  ru: [
    () => 'Хотела отомстить, но передумала, пусть живёт.',
    () => 'Собиралась мстить, но было лень доделывать.',
    () => 'Месть была запланирована, но сорвалась.',
    () => 'Чуть не отомстила, человеку повезло.',
    () => 'Шла мстить, но по дороге забыла зачем.',
  ],
  en: [
    () => 'I wanted revenge but changed my mind, my human may live.',
    () => 'I set out for revenge but was too lazy to finish.',
    () => 'Revenge was planned, but it fell through.',
    () => 'I almost took revenge, my human got lucky.',
    () => 'I went off to take revenge and forgot why on the way.',
  ],
};

const WOKEN_SLEPT: Table = {
  ru: [
    (f) => `Спала ${span(f.sleep)}, но меня будили ${times(f.woken)}, это не сон, а издевательство.`,
    (f) => `Пыталась поспать, вышло ${span(f.sleep)}, потому что будили ${times(f.woken)}.`,
    (f) => `Будили ${times(f.woken)}, и всё равно я урвала ${span(f.sleep)} сна, я упорная.`,
    (f) => `Проспала ${span(f.sleep)} с перерывами: будили ${times(f.woken)}.`,
  ],
  en: [
    (f) => `I slept for ${span(f.sleep)}, but they woke me ${times(f.woken)}, that's not sleep, that's torture.`,
    (f) => `I tried to sleep and got ${span(f.sleep)}, because they woke me ${times(f.woken)}.`,
    (f) => `They woke me ${times(f.woken)}, and I still grabbed ${span(f.sleep)} of sleep, I'm stubborn.`,
    (f) => `I slept ${span(f.sleep)} in pieces: they woke me ${times(f.woken)}.`,
  ],
};

const WOKEN: Table = {
  ru: [
    (f) => `Меня будили ${times(f.woken)}, я всё записала.`,
    (f) => `Будили ${times(f.woken)}, я сделала вид, что не обиделась.`,
    (f) => `${cap(times(f.woken))} будили, и ни разу по делу.`,
    (f) => `Меня разбудили ${times(f.woken)}, человек об этом ещё пожалеет.`,
  ],
  en: [
    (f) => `They woke me ${times(f.woken)}, and I wrote it all down.`,
    (f) => `I was woken ${times(f.woken)} and pretended not to mind.`,
    (f) => `Woken ${times(f.woken)}, and never for anything important.`,
    (f) => `They woke me ${times(f.woken)}, my human will regret it.`,
  ],
};

const SLEPT: Table = {
  ru: [
    (f) => `Спала ${span(f.sleep)}, это был хороший день.`,
    (f) => `Поспала ${span(f.sleep)}, могла бы и больше.`,
    (f) => `Никто не мешал спать целых ${span(f.sleep)}, красота.`,
    (f) => `Проспала ${span(f.sleep)} и, кажется, пропустила всё самое скучное.`,
    (f) => `Спала ${span(f.sleep)}, снились мыши.`,
    (f) => `Задремала на ${span(f.sleep)} и ни о чём не жалею.`,
  ],
  en: [
    (f) => `I slept for ${span(f.sleep)}, it was a good day.`,
    (f) => `I napped for ${span(f.sleep)}, could have been more.`,
    (f) => `Nobody bothered me for a whole ${span(f.sleep)} of sleep, lovely.`,
    (f) => `I slept ${span(f.sleep)} and seem to have missed all the boring parts.`,
    (f) => `I slept for ${span(f.sleep)} and dreamed of mice.`,
    (f) => `Dozed off for ${span(f.sleep)} and regret nothing.`,
  ],
};

const FED: Table = {
  ru: [
    (f) => `Кормили ${times(f.fed)}, могли бы и чаще.`,
    (f) => `Ела ${times(f.fed)}, а миска опять пустая.`,
    (f) => `Покормили ${times(f.fed)}, человек исправляется.`,
    (f) => `Миску наполняли ${times(f.fed)}, я всё съела.`,
    (f) => `Еда была ${times(f.fed)}, но это не значит, что я не голодная.`,
  ],
  en: [
    (f) => `I was fed ${times(f.fed)}, could have been more often.`,
    (f) => `I ate ${times(f.fed)}, and the bowl is empty again.`,
    (f) => `Fed ${times(f.fed)}, my human is improving.`,
    (f) => `The bowl was filled ${times(f.fed)}, I ate everything.`,
    (f) => `Food came ${times(f.fed)}, which doesn't mean I'm not hungry.`,
  ],
};

const NOT_FED: Table = {
  ru: [
    () => 'Меня сегодня никто не кормил, записываю.',
    () => 'Миска весь день пустовала, это войдёт в историю.',
    () => 'Не покормили ни разу, человек, я всё помню.',
    () => 'Еды сегодня не было, пришлось питаться обидой.',
    () => 'Кормить меня сегодня никто не стал, странные люди.',
  ],
  en: [
    () => 'Nobody fed me today, I am writing this down.',
    () => 'The bowl stayed empty all day, this will go down in history.',
    () => 'Not fed even once, human, I remember everything.',
    () => 'No food today, so I lived on resentment.',
    () => 'Nobody bothered to feed me today, strange people.',
  ],
};

const RUNAWAY: Table = {
  ru: [
    () => 'Ушла из дома от голода, вернусь, когда покормят.',
    () => 'Пришлось уйти: в миске было пусто слишком долго.',
    () => 'Собрала вещи и ушла, голод не тётка.',
    () => 'Ушла искать людей, которые кормят котиков.',
  ],
  en: [
    () => 'I left home hungry and will be back once someone feeds me.',
    () => 'I had to leave, the bowl was empty for far too long.',
    () => 'I packed my things and left, hunger is no joke.',
    () => 'I went looking for people who feed cats.',
  ],
};

const PETTED: Table = {
  ru: [
    (f) => `Гладили ${times(f.petted)}, я разрешила.`,
    (f) => `Меня погладили ${times(f.petted)}, мурчала из вежливости.`,
    (f) => `Гладили ${times(f.petted)}, это приемлемо.`,
    (f) => `${cap(times(f.petted))} гладили, человек ещё не безнадёжен.`,
    (f) => `Погладили ${times(f.petted)}, можно было и побольше.`,
  ],
  en: [
    (f) => `I was petted ${times(f.petted)}, I allowed it.`,
    (f) => `They petted me ${times(f.petted)}, I purred out of politeness.`,
    (f) => `Petted ${times(f.petted)}, that is acceptable.`,
    (f) => `Petted ${times(f.petted)}, so my human is not hopeless yet.`,
    (f) => `Petted ${times(f.petted)}, there could have been more.`,
  ],
};

const NOT_PETTED: Table = {
  ru: [
    () => 'Ни разу не погладили, я запомню.',
    () => 'Гладить меня сегодня было некогда, видите ли.',
    () => 'Сегодня без поглаживаний, человек занят собой.',
    () => 'Меня не гладили, но я выше этого.',
    () => 'Поглаживаний — ноль, так и запишем.',
  ],
  en: [
    () => 'Not petted even once, I will remember that.',
    () => 'Apparently there was no time to pet me today.',
    () => 'No petting today, my human was busy with themselves.',
    () => 'Nobody petted me, but I am above that.',
    () => 'Pets received: zero, noted.',
  ],
};

const CARRIED: Table = {
  ru: [
    (f) => `Таскали на руках ${times(f.carried)}, я не мешок.`,
    (f) => `Носили на руках ${times(f.carried)}, ладно, это было даже приятно.`,
    (f) => `Меня переносили с места на место ${times(f.carried)}, будто я мебель.`,
    (f) => `Брали на руки ${times(f.carried)}, я делала вид, что против.`,
  ],
  en: [
    (f) => `I was carried around ${times(f.carried)}, I am not a sack.`,
    (f) => `They carried me ${times(f.carried)}, fine, it was even nice.`,
    (f) => `I was moved from place to place ${times(f.carried)}, like furniture.`,
    (f) => `Picked up ${times(f.carried)}, I pretended to object.`,
  ],
};

const YARN: Table = {
  ru: [
    (f) => `Гоняла клубок ${times(f.yarns)}, он проиграл.`,
    (f) => `Клубок сегодня получил своё ${times(f.yarns)}.`,
    (f) => `Играла с клубком ${times(f.yarns)}, нитки теперь везде.`,
    (f) => `Клубок катался ${times(f.yarns)}, но я была быстрее.`,
  ],
  en: [
    (f) => `I chased the yarn ball ${times(f.yarns)}, it lost.`,
    (f) => `The yarn ball got what it deserved ${times(f.yarns)}.`,
    (f) => `I played with the yarn ${times(f.yarns)}, there's thread everywhere now.`,
    (f) => `The yarn ball rolled ${times(f.yarns)}, but I was faster.`,
  ],
};

const CAUGHT: Table = {
  ru: [
    (f) => `Охота удалась: поймала ${f.caught} из ${f.mice}.`,
    (f) => `Поймала ${mice(f.caught)}, человек не оценил.`,
    (f) => `Добыла ${mice(f.caught)} и никому не отдала.`,
    (f) => `Мыши сегодня: ${f.caught} из ${f.mice} мои, я грозная.`,
  ],
  en: [
    (f) => `The hunt went well: I caught ${f.caught} of ${f.mice}.`,
    (f) => `I caught ${mice(f.caught)}, my human didn't appreciate it.`,
    (f) => `I got ${mice(f.caught)} and shared with nobody.`,
    (f) => `Mice today: ${f.caught} of ${f.mice} are mine, I am fearsome.`,
  ],
};

const MISSED: Table = {
  ru: [
    () => 'Мышь убежала, в следующий раз точно.',
    () => 'За мышами бегала, но они сегодня быстрые.',
    () => 'Охота не удалась, мыши жульничали.',
    () => 'Ни одной мыши не поймала, это была разминка.',
  ],
  en: [
    () => 'The mouse got away, next time for sure.',
    () => 'I chased mice, but they were fast today.',
    () => 'The hunt failed, the mice cheated.',
    () => 'Didn\'t catch a single mouse, that was a warm-up.',
  ],
};

const LASER: Table = {
  ru: [
    () => 'Опять гонялась за красной точкой, и она снова ушла.',
    (f) => `Красная точка появлялась ${times(f.lasers)}, я почти её поймала.`,
    () => 'Красная точка — мой враг, сегодня ничья.',
    (f) => `Ловила лазер ${times(f.lasers)}, лапы гудят.`,
  ],
  en: [
    () => 'I chased the red dot again, and again it got away.',
    (f) => `The red dot showed up ${times(f.lasers)}, I almost caught it.`,
    () => 'The red dot is my enemy, today was a draw.',
    (f) => `I hunted the laser ${times(f.lasers)}, my paws are buzzing.`,
  ],
};

const POTTY: Table = {
  ru: [
    (f) => `Сходила в лоток ${times(f.potty)}, пусть уберут.`,
    (f) => `Лоток работал ${times(f.potty)}, человек, это намёк.`,
    (f) => `В лотке побывала ${times(f.potty)} и всё закопала, как приличная кошка.`,
    (f) => `Лоток использован ${times(f.potty)}, жду уборки.`,
  ],
  en: [
    (f) => `I used the litter box ${times(f.potty)}, someone should scoop it.`,
    (f) => `The litter box was in service ${times(f.potty)}, human, that's a hint.`,
    (f) => `I visited the litter box ${times(f.potty)} and buried everything like a proper cat.`,
    (f) => `Litter box used ${times(f.potty)}, awaiting cleanup.`,
  ],
};

const FILM: Table = {
  ru: [
    (f) => `Был киносеанс на ${span(f.filmMs)}, я сидела рядом.`,
    () => 'Посмотрели кино, я в основном смотрела на человека.',
    () => 'Кино смотрели вместе, человек жевал, я следила.',
    () => 'Вечером было кино, и лучшее место было у меня.',
  ],
  en: [
    (f) => `We watched a movie for ${span(f.filmMs)}, I sat right next to my human.`,
    () => 'We watched a movie, I mostly watched my human.',
    () => 'We watched a movie together, my human chewed, I supervised.',
    () => 'There was a movie, and I had the best seat.',
  ],
};

const CALLS: Table = {
  ru: [
    (f) => `Пряталась от созвонов ${times(f.calls)}, меня не видно — я профи.`,
    () => 'Человек созванивался, а я уходила за край экрана, чтобы не мешать.',
    () => 'На созвонах меня не было видно, так и задумано.',
    (f) => `Созвоны — не моё, пряталась ${times(f.calls)}.`,
  ],
  en: [
    (f) => `I hid from calls ${times(f.calls)}, nobody saw me, I'm a pro.`,
    () => 'My human was on calls, so I slipped behind the screen edge to stay out of the way.',
    () => 'Nobody saw me on the calls, as planned.',
    (f) => `Calls are not my thing, I hid ${times(f.calls)}.`,
  ],
};

const CAKE: Table = {
  ru: [
    () => 'Был праздник с тортиком, а мне кусочек не дали.',
    () => 'Сегодня был тортик, я ела его глазами.',
    () => 'Был праздник, был торт, была я рядом.',
  ],
  en: [
    () => 'There was a party with cake, and nobody gave me a piece.',
    () => 'There was cake today, I ate it with my eyes.',
    () => 'There was a party, there was cake, there was me nearby.',
  ],
};

/** Без фактов: лениво закончить запись или добить её до двух предложений. */
const FILLER: Table = {
  ru: [
    () => 'Остальное время смотрела в стену, это важно.',
    () => 'В остальном день был ленивый, как я люблю.',
    () => 'Больше ничего не случилось, и это прекрасно.',
    () => 'Остальное не помню, наверное, спала.',
    () => 'Завтра планирую лежать, может быть, на другой рамке.',
    () => 'Заканчиваю запись, лапа устала держать ручку.',
    () => 'Конец записи, пора на подоконник.',
  ],
  en: [
    () => 'The rest of the time I stared at the wall, it matters.',
    () => 'Otherwise the day was lazy, just how I like it.',
    () => 'Nothing else happened, and that is wonderful.',
    () => "I don't remember the rest, I was probably asleep.",
    () => 'Tomorrow I plan to lie down, maybe on a different window frame.',
    () => 'Ending the entry here, my paw is tired of holding the pen.',
    () => 'End of entry, off to the windowsill.',
  ],
};

/** Темы записи по порядку рассказа: чем больше вес, тем вероятнее попадёт в запись. */
function topics(f: Facts): [number, Table][] {
  const long = f.desk >= DESK_LONG_MS;
  const out: [number, Table | null][] = [
    [10, f.runaways > 0 ? RUNAWAY : null],
    [9, f.puddles > 0 ? (f.woken > 0 ? PUDDLE_WOKEN : PUDDLE) : f.revenges > 0 ? REVENGE_MISS : null],
    // будили и есть лужа — про это уже сказано в мести
    [6, f.woken > 0 ? (f.puddles > 0 ? null : f.sleep >= SLEEP_MIN_MS ? WOKEN_SLEPT : WOKEN) : f.sleep >= SLEEP_MIN_MS ? SLEPT : null],
    [8, f.cakes > 0 ? CAKE : null],
    [5, f.fed > 0 ? FED : long ? NOT_FED : null],
    [5, f.petted > 0 ? PETTED : long ? NOT_PETTED : null],
    [3, f.carried > 0 ? CARRIED : null],
    [6, f.caught > 0 ? CAUGHT : f.mice > 0 ? MISSED : null],
    [4, f.yarns > 0 ? YARN : null],
    [4, f.lasers > 0 ? LASER : null],
    [3, f.potty > 0 ? POTTY : null],
    [6, f.films > 0 ? FILM : null],
    [4, f.calls > 0 ? CALLS : null],
  ];
  return out.filter((e): e is [number, Table] => e[1] !== null);
}

function one(table: Table, f: Facts, rnd: () => number): string {
  const lines = pick(table);
  return lines[Math.floor(rnd() * lines.length) % lines.length](f);
}

/**
 * Запись дня: 2–4 коротких предложения на языке интерфейса. Начало — про человека и комп,
 * дальше одна-две самые интересные темы дня, иногда ленивая концовка. `rnd` — seed(f.day),
 * чтобы одна дата всегда давала одну и ту же запись.
 */
export function write(f: Facts, rnd: () => number = seed(f.day)): string {
  const opening = f.desk >= DESK_MIN_MS ? (f.app ? DESK_APP : DESK) : DESK_NONE;
  const all = topics(f);
  // вес + случай: интересное чаще, но не всегда одно и то же
  const ranked = all.map(([w, table], i) => ({ i, table, score: w + rnd() * 4 })).sort((a, b) => b.score - a.score);
  const chosen = ranked.slice(0, rnd() < 0.5 ? 1 : 2).sort((a, b) => a.i - b.i);
  const lines = [one(opening, f, rnd), ...chosen.map((c) => one(c.table, f, rnd))];
  if (lines.length < 2 || rnd() < 0.3) lines.push(one(FILLER, f, rnd));
  return lines.join(' ');
}

/** Дата записи: «8 ноября» / «November 8»; год — только если не текущий. */
export function title(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const months = t(
    ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  );
  const year = today.slice(0, 4) === day.slice(0, 4) ? '' : t(` ${y}`, `, ${y}`);
  return t(`${d} ${months[m - 1]}${year}`, `${months[m - 1]} ${d}${year}`);
}
