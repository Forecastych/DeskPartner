// Настройки человека. Всё, что выбрано на первом запуске, живёт здесь и потом меняется в меню.
// По умолчанию — осторожная версия: всё, что лезет в игры, браузер или сеть, выключено.
// Исключение — «прятать от записи экрана»: питомец в чужом скриншоте выдаёт больше, чем хотелось бы.

import { LANG_PREFS, pick, type Lang, type LangPref } from './i18n';

export const TOPICS = [
  'футбол',
  'хоккей',
  'баскетбол',
  'теннис',
  'формула 1',
  'единоборства',
  'киберспорт',
  'игры',
  'аниме',
  'кино',
  'сериалы',
  'музыка',
  'книги',
  'космос',
  'наука',
  'техника',
  'программирование',
  'история',
  'животные',
  'природа',
  'путешествия',
  'еда',
  'искусство',
  'авто',
] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * Тема — ключ во всех таблицах (факты, правила Википедии, ленты в Rust) и в файле настроек,
 * поэтому остаётся русской. Человеку показываем название на его языке.
 */
const TOPIC_EN: Record<Topic, string> = {
  футбол: 'football',
  хоккей: 'hockey',
  баскетбол: 'basketball',
  теннис: 'tennis',
  'формула 1': 'formula 1',
  единоборства: 'combat sports',
  киберспорт: 'esports',
  игры: 'games',
  аниме: 'anime',
  кино: 'movies',
  сериалы: 'tv series',
  музыка: 'music',
  книги: 'books',
  космос: 'space',
  наука: 'science',
  техника: 'tech',
  программирование: 'programming',
  история: 'history',
  животные: 'animals',
  природа: 'nature',
  путешествия: 'travel',
  еда: 'food',
  искусство: 'art',
  авто: 'cars',
};

export function topicName(t: Topic): string {
  return pick({ ru: t, en: TOPIC_EN[t] });
}

export const MODES = ['calm', 'pranks'] as const;
export type Mode = (typeof MODES)[number];

export const CHATTER = ['quiet', 'sometimes', 'often'] as const;
export type Chatter = (typeof CHATTER)[number];

/** Где охотник гоняется за курсором: только по панели задач или по всему экрану. */
export const HUNTER_AREAS = ['taskbar', 'screen'] as const;
export type HunterArea = (typeof HUNTER_AREAS)[number];

/**
 * Окрас кошки, у каждого свой характер (breed.ts) и палитра (coat.ts). Серая полосатая — та,
 * что была всегда, по умолчанию: у неё все черты ровно 1.
 */
export const BREEDS = ['tabby', 'ginger', 'black', 'tuxedo', 'calico'] as const;
export type Breed = (typeof BREEDS)[number];

/** Длиннее имя не влезет в облачко и меню трея. */
export const NAME_MAX = 20;

/** Подсказки на первом запуске: кошка в репликах — «она», имена ей под стать. */
export const NAMES: Record<Lang, readonly string[]> = {
  ru: ['Мурка', 'Соня', 'Луна', 'Тучка', 'Ириска', 'Пуша', 'Сима', 'Бусинка', 'Дуся', 'Плюшка', 'Фиса', 'Вишня'],
  en: ['Luna', 'Misty', 'Cleo', 'Mochi', 'Ginger', 'Nala', 'Pepper', 'Willow', 'Biscuit', 'Olive', 'Hazel', 'Pumpkin'],
};

/** Случайное имя из подсказок, но не `except` — кнопка «Другое» должна что-то менять. */
export function suggestName(rand: () => number, except = ''): string {
  const pool = pick(NAMES).filter((n) => n !== except);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Имя как его можно показать: без управляющих символов, лишних пробелов и не длиннее NAME_MAX. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('').trim();
}

/** Форма питомца после месяца вместе (src/lib/growth.ts): малыш, подросток или взрослая. */
export const FORMS = ['kitten', 'teen', 'adult'] as const;
export type Form = (typeof FORMS)[number];

export interface Settings {
  /** Язык интерфейса; «auto» — как в Windows. Смена перезапускает программу (i18n.ts). */
  lang: LangPref;
  /** Имя питомца; пусто — ещё не назвали (настройки из версий без имени). */
  name: string;
  /** Кормушка: насыпал порций — кошка ест сама, когда проголодается. */
  feeder: boolean;
  /** Лежак на полу: кошка чаще спит в нём, чем на рамках окон. */
  bed: boolean;
  /** Лоток на полу: кошка сама в него ходит; ПКМ по нему — убрать или поменять. */
  litter: boolean;
  /** Не попадать в скриншоты и запись экрана (WDA_EXCLUDEFROMCAPTURE). */
  hideFromCapture: boolean;
  /** «Охотник»: кошка гоняется за курсором, как за лазером, только без Ctrl. */
  hunter: boolean;
  hunterArea: HunterArea;
  /** «Клубок»: раз в час-два кошка выносит из-за края клубок и пару минут катает его по полу. */
  yarn: boolean;
  /** Пока только кошка; собака и дракон позже. */
  pet: 'cat';
  /** Окрас и вместе с ним характер. */
  breed: Breed;
  topics: Topic[];
  mode: Mode;
  chatter: Chatter;
  /** «Заходить в окно игры». */
  gameWindow: boolean;
  /** «Узнавать сайты в браузере»: заголовок сверяется со списком и сразу забывается. */
  sites: boolean;
  /** «Подтягивать отзывы о фильмах»: без ключа — Wikidata и Википедия (src/lib/reviews.ts), с ключом — ещё TMDB. */
  reviews: boolean;
  /** Ключ TMDB вводит человек: свой ключ в открытый код не кладём. */
  tmdbKey: string;
  /** «Новости любимых игр»: анонсы Steam для игр, в которые играешь (наружу — только номер игры в Steam). */
  gameNews: boolean;
  /** «Новые серии»: расписание из AniList для тайтлов из `animeTitles` (наружу — сам список). */
  anime: boolean;
  /** Названия или ссылки Shikimori / MyAnimeList / AniList через запятую. */
  animeTitles: string;
  /** Раз в несколько часов спрашивать GitHub, нет ли версии новее (src-tauri/src/update.rs). Ставит всё равно человек. */
  updates: boolean;
  /** Как выглядит питомец, когда выбор формы открыт; до этого не действует. Меняет только внешность. */
  form: Form;
}

/** Длина строки тайтлов: десяток ссылок с запасом. */
export const ANIME_TITLES_MAX = 1000;

/** Что отдать команде releases_setup: выключенное — пустой список. */
export function releasesSetup(s: Settings): { steam: boolean; anime: string } {
  return { steam: s.gameNews, anime: s.anime ? s.animeTitles.trim() : '' };
}

export function defaults(): Settings {
  return {
    lang: 'auto',
    name: '',
    feeder: false,
    bed: false,
    litter: false,
    hideFromCapture: true,
    hunter: false,
    hunterArea: 'taskbar',
    // клубок тихий — не носится и не мешает, поэтому включён сразу
    yarn: true,
    pet: 'cat',
    breed: 'tabby',
    topics: [],
    mode: 'calm',
    chatter: 'sometimes',
    gameWindow: false,
    sites: false,
    reviews: false,
    tmdbKey: '',
    gameNews: false,
    anime: false,
    animeTitles: '',
    // без обновлений исправления до людей не доедут; спрашиваем только версию, ставим по клику
    updates: true,
    form: 'adult',
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
    lang: oneOf(LANG_PREFS, s.lang, d.lang),
    name: cleanName(s.name),
    feeder: bool(s.feeder, d.feeder),
    bed: bool(s.bed, d.bed),
    litter: bool(s.litter, d.litter),
    hideFromCapture: bool(s.hideFromCapture, d.hideFromCapture),
    hunter: bool(s.hunter, d.hunter),
    hunterArea: oneOf(HUNTER_AREAS, s.hunterArea, d.hunterArea),
    yarn: bool(s.yarn, d.yarn),
    pet: 'cat',
    breed: oneOf(BREEDS, s.breed, d.breed),
    topics: Array.isArray(s.topics) ? TOPICS.filter((t) => (s.topics as unknown[]).includes(t)) : d.topics,
    mode: oneOf(MODES, s.mode, d.mode),
    chatter: oneOf(CHATTER, s.chatter, d.chatter),
    gameWindow: bool(s.gameWindow, d.gameWindow),
    sites: bool(s.sites, d.sites),
    reviews: bool(s.reviews, d.reviews),
    tmdbKey: typeof s.tmdbKey === 'string' ? s.tmdbKey.trim() : d.tmdbKey,
    gameNews: bool(s.gameNews, d.gameNews),
    anime: bool(s.anime, d.anime),
    animeTitles: typeof s.animeTitles === 'string' ? s.animeTitles.trim().slice(0, ANIME_TITLES_MAX) : d.animeTitles,
    updates: bool(s.updates, d.updates),
    form: oneOf(FORMS, s.form, d.form),
  };
}

export function serialize(s: Settings): string {
  return JSON.stringify(s);
}
