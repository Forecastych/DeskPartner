// Язык интерфейса: русский или английский. Какой — решает Rust при запуске (настройка `lang`,
// «auto» — как в Windows), main.ts спрашивает его до первой отрисовки окна. Смена языка в
// настройках перезапускает программу: ни одно окно не останется на старом.
//
// Строки лежат парами рядом с местом показа: t('Покормили', 'Fed'). Таблицы на уровне модуля
// (реплики, факты) — Record<Lang, …> и выбираются pick() в момент показа, а не при импорте:
// модули грузятся раньше, чем main.ts узнаёт язык.

export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** Что выбрано в настройках: язык или «как в Windows». */
export const LANG_PREFS = ['auto', 'ru', 'en'] as const;
export type LangPref = (typeof LANG_PREFS)[number];

let current: Lang = 'ru';

export function setLang(l: unknown): void {
  current = l === 'en' ? 'en' : 'ru';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export const lang = (): Lang => current;

/** Строка (или что угодно) на текущем языке. */
export function t<T>(ru: T, en: T): T {
  return current === 'en' ? en : ru;
}

/** Таблица на оба языка → её половина на текущем. */
export function pick<T>(table: Record<Lang, T>): T {
  return table[current];
}

/** Русская форма числа: 1 раз, 2 раза, 5 раз, 11 раз, 21 раз. */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** «5 раз» / «5 times»: число и слово в нужной форме на текущем языке. */
export function count(n: number, ru: readonly [string, string, string], en: readonly [string, string]): string {
  return `${n} ${current === 'en' ? (n === 1 ? en[0] : en[1]) : plural(n, ru)}`;
}
