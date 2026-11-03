// Настройки человека. Всё, что выбрано на первом запуске, живёт здесь и потом меняется в меню.
// По умолчанию — осторожная версия: всё, что лезет в игры, браузер или сеть, выключено.
// Исключение — «прятать от записи экрана»: питомец в чужом скриншоте выдаёт больше, чем хотелось бы.

export const TOPICS = ['футбол', 'космос', 'аниме', 'история', 'животные', 'кино', 'игры', 'музыка', 'наука', 'техника'] as const;
export type Topic = (typeof TOPICS)[number];

export const MODES = ['calm', 'pranks'] as const;
export type Mode = (typeof MODES)[number];

export const CHATTER = ['quiet', 'sometimes', 'often'] as const;
export type Chatter = (typeof CHATTER)[number];

/** Где охотник гоняется за курсором: только по панели задач или по всему экрану. */
export const HUNTER_AREAS = ['taskbar', 'screen'] as const;
export type HunterArea = (typeof HUNTER_AREAS)[number];

export interface Settings {
  /** Кормушка: насыпал порций — кошка ест сама, когда проголодается. */
  feeder: boolean;
  /** Лежак на полу: кошка чаще спит в нём, чем на рамках окон. */
  bed: boolean;
  /** Не попадать в скриншоты и запись экрана (WDA_EXCLUDEFROMCAPTURE). */
  hideFromCapture: boolean;
  /** «Охотник»: кошка гоняется за курсором, как за лазером, только без Ctrl. */
  hunter: boolean;
  hunterArea: HunterArea;
  /** Пока только кошка; собака и дракон позже. */
  pet: 'cat';
  topics: Topic[];
  mode: Mode;
  chatter: Chatter;
  /** «Заходить в окно игры». */
  gameWindow: boolean;
  /** «Узнавать сайты в браузере»: заголовок сверяется со списком и сразу забывается. */
  sites: boolean;
  /** «Подтягивать отзывы о фильмах»; без ключа TMDB не работает. */
  reviews: boolean;
  /** Ключ TMDB вводит человек: свой ключ в открытый код не кладём. */
  tmdbKey: string;
}

export function defaults(): Settings {
  return {
    feeder: false,
    bed: false,
    hideFromCapture: true,
    hunter: false,
    hunterArea: 'taskbar',
    pet: 'cat',
    topics: [],
    mode: 'calm',
    chatter: 'sometimes',
    gameWindow: false,
    sites: false,
    reviews: false,
    tmdbKey: '',
  };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/**
 * Разбор с диска. Битое поле заменяется значением по умолчанию поштучно, а не сбрасывает всё:
 * одна опечатка в руками поправленном файле не должна выключать человеку кормушку и темы.
 */
export function parse(raw: string | null): Settings {
  const d = defaults();
  let o: unknown;
  try {
    o = JSON.parse(raw ?? 'null');
  } catch {
    return d;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return d;
  const s = o as Record<string, unknown>;
  return {
    feeder: bool(s.feeder, d.feeder),
    bed: bool(s.bed, d.bed),
    hideFromCapture: bool(s.hideFromCapture, d.hideFromCapture),
    hunter: bool(s.hunter, d.hunter),
    hunterArea: oneOf(HUNTER_AREAS, s.hunterArea, d.hunterArea),
    pet: 'cat',
    topics: Array.isArray(s.topics) ? TOPICS.filter((t) => (s.topics as unknown[]).includes(t)) : d.topics,
    mode: oneOf(MODES, s.mode, d.mode),
    chatter: oneOf(CHATTER, s.chatter, d.chatter),
    gameWindow: bool(s.gameWindow, d.gameWindow),
    sites: bool(s.sites, d.sites),
    reviews: bool(s.reviews, d.reviews),
    tmdbKey: typeof s.tmdbKey === 'string' ? s.tmdbKey.trim() : d.tmdbKey,
  };
}

export function serialize(s: Settings): string {
  return JSON.stringify(s);
}
