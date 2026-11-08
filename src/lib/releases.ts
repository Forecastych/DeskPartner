// Что вышло у своего: патчи и анонсы игр из Steam (по тому, во что человек играет) и новые серии
// аниме из AniList (по списку в настройках). Качает и помнит Rust (src-tauri/src/news/releases.rs),
// фронт берёт по одной командой release_pick и говорит её на отдыхе, не во время игры.
// Клик «Глянем» открывает ссылку в браузере — тоже через Rust, и только Steam или AniList.

import { t } from './i18n';
import { MAX_TITLE, type Invoke } from './news';

export interface ReleasePick {
  kind: 'game' | 'anime';
  /** Игра или тайтл на языке интерфейса. */
  name: string;
  /** Заголовок анонса; у серий пусто. */
  title: string;
  episode: number | null;
  /** Анонс — обновление игры. */
  patch: boolean;
  link: string;
}

function isReleasePick(v: unknown): v is ReleasePick {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.kind === 'game' || o.kind === 'anime') &&
    typeof o.name === 'string' &&
    o.name.trim() !== '' &&
    typeof o.title === 'string' &&
    (o.episode === null || o.episode === undefined || typeof o.episode === 'number') &&
    typeof o.patch === 'boolean' &&
    typeof o.link === 'string' &&
    o.link.startsWith('https://')
  );
}

/**
 * Свежий анонс или серия, ещё не рассказанные, или null. Выданное Rust помечает рассказанным.
 * Во время игры Rust отвечает null сам. Ошибки и странные ответы — тоже null.
 */
export async function pickRelease(invoke: Invoke): Promise<ReleasePick | null> {
  try {
    const v = await invoke('release_pick');
    if (!isReleasePick(v)) return null;
    return { ...v, episode: v.episode ?? null };
  } catch {
    return null;
  }
}

/** Тема для chatter: под ней реплика встаёт в очередь фактов. */
export function releaseTopic(r: ReleasePick): 'игры' | 'аниме' {
  return r.kind === 'game' ? 'игры' : 'аниме';
}

export function releaseSource(r: ReleasePick): 'Steam' | 'AniList' {
  return r.kind === 'game' ? 'Steam' : 'AniList';
}

function cut(s: string): string {
  const raw = s.trim();
  return raw.length > MAX_TITLE ? `${raw.slice(0, MAX_TITLE - 1).trimEnd()}…` : raw;
}

/** Реплика для облачка: «В Dota 2 вышел патч «7.39» — глянем?», «Вышла 5-я серия «Фрирен» — посмотрим?». */
export function releaseLine(r: ReleasePick): string {
  const name = cut(r.name);
  if (r.kind === 'anime') {
    if (r.episode) return t(`Вышла ${r.episode}-я серия «${name}» — посмотрим?`, `Episode ${r.episode} of “${name}” is out. Watch it?`);
    return t(`Вышла новая серия «${name}» — посмотрим?`, `A new episode of “${name}” is out. Watch it?`);
  }
  const title = cut(r.title);
  if (r.patch) return t(`В ${name} вышел патч «${title}» — глянем?`, `${name} got a patch: “${title}”. Take a look?`);
  return t(`${name}: «${title}» — глянем?`, `${name}: “${title}”. Take a look?`);
}
