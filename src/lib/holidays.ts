// Праздники кошки. Тортики — за чистое время рядом на экране (stats.together), годовщина — по
// дате знакомства (stats.since). Что уже отмечено, лежит в stats (cakes, years): каждый праздник
// раз в жизни. Наряд — по календарю: шапка на Новый год, тыква на Хэллоуин.

import type { Outfit } from './sprite';
import { plural, type Stats } from './stats';

const HOUR = 3_600_000;

/** Тортики за столько часов вместе. */
export const CAKES = [24, 168, 360, 720, 2400] as const;

const CAKE_LINES: Record<(typeof CAKES)[number], string> = {
  24: 'Сутки рядом на экране! Где мой тортик?',
  168: 'Неделя вместе! Это надо отметить',
  360: 'Пятнадцать дней вместе! Тортик, пожалуйста',
  720: 'Месяц вместе! Праздничный тортик',
  2400: 'Сто дней вместе! Самый большой тортик',
};

/** Сколько вех по времени вместе уже пройдено. */
export function cakesReached(together: number): number {
  return CAKES.filter((h) => together >= h * HOUR).length;
}

/** Полных лет со знакомства. */
export function years(since: number, now: number): number {
  const a = new Date(since);
  const b = new Date(now);
  let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
  return Math.max(0, y);
}

/**
 * Пора ли праздновать: [stats с отмеченным праздником, что сказать] или null. Годовщина важнее
 * тортика. Пропущенные вехи (старый файл, давно не запускали) не празднуются по очереди:
 * отмечаем самую свежую, остальные засчитываем молча.
 */
export function celebrate(s: Stats, now: number): [Stats, string] | null {
  const y = years(s.since, now);
  if (y > s.years) {
    const text = y === 1 ? 'Год, как мы знакомы! С годовщиной' : `${y} ${plural(y, ['год', 'года', 'лет'])}, как мы знакомы!`;
    return [{ ...s, years: y }, text];
  }
  const c = cakesReached(s.together);
  if (c > s.cakes) return [{ ...s, cakes: c }, CAKE_LINES[CAKES[c - 1]]];
  return null;
}

/** Наряд на сегодня: шапка с 24 декабря по 7 января, тыква с 28 октября по 1 ноября. */
export function outfit(d: Date): Outfit | null {
  const m = d.getMonth();
  const day = d.getDate();
  if ((m === 11 && day >= 24) || (m === 0 && day <= 7)) return 'hat';
  if ((m === 9 && day >= 28) || (m === 10 && day === 1)) return 'pumpkin';
  return null;
}
