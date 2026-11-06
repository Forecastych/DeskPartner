// Новости по увлечениям: Rust качает ленты в фоне (src-tauri/src/news), фронт берёт
// по одной командой news_pick и превращает в реплику для облачка.

import { count, lang, t } from './i18n';

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

/** Реплика для облачка: «Пишут: <заголовок> (Источник)»; новость не на языке интерфейса — с пометкой. */
export function newsLine(item: NewsItem): string {
  const head = item.lang === lang() ? t('Пишут:', 'In the news:') : t('Пишут (англ.):', 'In the news (Russian):');
  const raw = item.title.trim();
  const title = raw.length > MAX_TITLE ? `${raw.slice(0, MAX_TITLE - 1).trimEnd()}…` : raw;
  return `${head} ${title} (${item.source})`;
}

/** Пометка языка у ленты в настройках — только когда он не совпадает с языком интерфейса. */
export function langMark(l: 'ru' | 'en'): string {
  if (l === lang()) return '';
  return l === 'en' ? t(' (англ.)', ' (English)') : t(' (рус.)', ' (Russian)');
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
  return count(n, ['новость', 'новости', 'новостей'], ['story', 'stories']);
}

/** Время по местным часам: сегодня — «14:05», раньше — «5 нояб. 14:05». */
export function clock(unix: number, now: number): string {
  const d = new Date(unix * 1000);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now * 1000).toDateString() === d.toDateString();
  return today ? hm : `${d.toLocaleDateString(t('ru-RU', 'en-US'), { day: 'numeric', month: 'short' })} ${hm}`;
}

/** Состояние одной ленты для настроек. */
export function feedState(f: FeedStatus, now: number, busy: boolean): string {
  if (f.at === null) return busy ? t('качается…', 'downloading…') : t('ещё не качалась', 'not downloaded yet');
  const when = clock(f.at, now);
  if (!f.ok) {
    if (f.next === null) return t(`не ответила в ${when}`, `no answer at ${when}`);
    const again = clock(f.next, now);
    return t(`не ответила в ${when}, повтор в ${again}`, `no answer at ${when}, retry at ${again}`);
  }
  const taste = f.weight > 1 ? t(' · по лайкам — чаще', ' · liked: more often') : f.weight < 1 ? t(' · по дизам — реже', ' · disliked: less often') : '';
  return `${t('обновлена в', 'updated at')} ${when} · ${newsCount(f.items)}${taste}`;
}

/** Общая строка над списком: качается, когда следующая проверка, сколько не отвечает. */
export function newsSummary(st: NewsStatus): string {
  if (!st.feeds.length) return t('Темы не выбраны — ленты не качаются.', 'No topics chosen, so no feeds are downloaded.');
  if (st.busy) return t('Сейчас обновляются…', 'Updating now…');
  const failed = st.feeds.filter((f) => f.ok === false).length;
  const bad = failed ? t(` Не отвечают: ${failed} из ${st.feeds.length}.`, ` Not answering: ${failed} of ${st.feeds.length}.`) : '';
  const next = st.feeds.map((f) => f.next ?? 0).reduce((a, b) => Math.min(a, b), Infinity);
  // поток просыпается раз в 10 минут: подошёл срок — скачает на ближайшем проходе
  const when = next <= st.now ? t('Скоро обновятся.', 'Updating soon.') : t(`Следующее обновление в ${clock(next, st.now)}.`, `Next update at ${clock(next, st.now)}.`);
  return when + bad;
}
