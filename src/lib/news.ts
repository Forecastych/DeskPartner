// Новости по увлечениям: Rust качает ленты в фоне (src-tauri/src/news), фронт берёт
// по одной командой news_pick и превращает в реплику для облачка.

export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface NewsItem {
  topic: string;
  title: string;
  link: string;
  /** Короткое имя источника: «Чемпионат», «N + 1». */
  source: string;
  lang: 'ru' | 'en';
  /** Unix-время публикации, секунды. */
  date: number;
}

function isNewsItem(v: unknown): v is NewsItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.topic === 'string' &&
    typeof o.title === 'string' &&
    o.title.trim() !== '' &&
    typeof o.link === 'string' &&
    typeof o.source === 'string' &&
    (o.lang === 'ru' || o.lang === 'en') &&
    typeof o.date === 'number'
  );
}

/**
 * Свежая непоказанная новость по одной из тем или null. Темы остаются на машине:
 * Rust по ним решает, какие ленты качать, в запросы к лентам они не попадают.
 * Выданная новость считается показанной и больше не придёт. Ошибки — тоже null.
 * `weights` — веса тем из chatter: по лайкам тема выпадает чаще.
 */
export async function pickNews(
  invoke: Invoke,
  topics: readonly string[],
  weights: Record<string, number> = {},
): Promise<NewsItem | null> {
  try {
    const v = await invoke('news_pick', { topics: [...topics], weights });
    return isNewsItem(v) ? v : null;
  } catch {
    return null;
  }
}

/** Длиннее заголовок обрезаем: облачко не должно разрастись во всю кошку. */
export const MAX_TITLE = 120;

/** Реплика для облачка: «Пишут: <заголовок> (Источник)»; про английские — с пометкой. */
export function newsLine(item: NewsItem): string {
  const head = item.lang === 'en' ? 'Пишут (англ.):' : 'Пишут:';
  const t = item.title.trim();
  const title = t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
  return `${head} ${title} (${item.source})`;
}

/** Строка статуса лент из news_status: одна на адрес ленты. Время — unix, секунды. */
export interface FeedStatus {
  source: string;
  lang: 'ru' | 'en';
  topics: string[];
  /** Последняя попытка скачать; null — ещё не качалась. */
  at: number | null;
  ok: boolean | null;
  /** Когда снова; null — при первом же проходе. */
  next: number | null;
  /** Новостей источника в запасе. */
  items: number;
  /** Вес по лайкам/дизам: больше 1 — чаще, меньше — реже. */
  weight: number;
}

export interface NewsStatus {
  /** Ленты качаются прямо сейчас. */
  busy: boolean;
  now: number;
  feeds: FeedStatus[];
}

/** Статус лент или null — нет бэкенда, ошибка или странный ответ. */
export async function newsStatus(invoke: Invoke): Promise<NewsStatus | null> {
  try {
    const v = (await invoke('news_status')) as NewsStatus | null;
    return v && typeof v.busy === 'boolean' && typeof v.now === 'number' && Array.isArray(v.feeds) ? v : null;
  } catch {
    return null;
  }
}

/** 1 новость, 3 новости, 5 новостей. */
export function newsCount(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'новость' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'новости' : 'новостей';
  return `${n} ${word}`;
}

/** Время по местным часам: сегодня — «14:05», раньше — «5 нояб. 14:05». */
export function clock(unix: number, now: number): string {
  const d = new Date(unix * 1000);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now * 1000).toDateString() === d.toDateString();
  return today ? hm : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${hm}`;
}

/** Состояние одной ленты для настроек. */
export function feedState(f: FeedStatus, now: number, busy: boolean): string {
  if (f.at === null) return busy ? 'качается…' : 'ещё не качалась';
  const when = clock(f.at, now);
  if (!f.ok) return f.next === null ? `не ответила в ${when}` : `не ответила в ${when}, повтор в ${clock(f.next, now)}`;
  const taste = f.weight > 1 ? ' · по лайкам — чаще' : f.weight < 1 ? ' · по дизам — реже' : '';
  return `обновлена в ${when} · ${newsCount(f.items)}${taste}`;
}

/** Общая строка над списком: качается, когда следующая проверка, сколько не отвечает. */
export function newsSummary(st: NewsStatus): string {
  if (!st.feeds.length) return 'Темы не выбраны — ленты не качаются.';
  if (st.busy) return 'Сейчас обновляются…';
  const failed = st.feeds.filter((f) => f.ok === false).length;
  const bad = failed ? ` Не отвечают: ${failed} из ${st.feeds.length}.` : '';
  const next = st.feeds.map((f) => f.next ?? 0).reduce((a, b) => Math.min(a, b), Infinity);
  // поток просыпается раз в 10 минут: подошёл срок — скачает на ближайшем проходе
  const when = next <= st.now ? 'Скоро обновятся.' : `Следующее обновление в ${clock(next, st.now)}.`;
  return when + bad;
}
