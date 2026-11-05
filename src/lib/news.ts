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
 */
export async function pickNews(invoke: Invoke, topics: readonly string[]): Promise<NewsItem | null> {
  try {
    const v = await invoke('news_pick', { topics: [...topics] });
    return isNewsItem(v) ? v : null;
  } catch {
    return null;
  }
}

/** Реплика для облачка: «Пишут: <заголовок> (Источник)»; про английские — с пометкой. */
export function newsLine(item: NewsItem): string {
  const head = item.lang === 'en' ? 'Пишут (англ.):' : 'Пишут:';
  return `${head} ${item.title.trim()} (${item.source})`;
}
