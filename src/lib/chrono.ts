// Хронотип кошки: подстраивается под человека. Копим, в какие часы суток он сидит за компьютером
// с кошкой дома (stats.hours), и по «центру тяжести» этих часов решаем: жаворонок, голубь или сова.
// В «не свои» часы кошка устаёт быстрее и чаще спит. Часы считаем по кругу: 23 и 1 — соседи.

import { t } from './i18n';

const HOUR = 3_600_000;

export type Chrono = 'lark' | 'dove' | 'owl';

/** Меньше этого вместе — характер ещё не сложился. */
export const KNOWN_MS = 10 * HOUR;
/** В «не свои» часы устаёт во столько раз быстрее. */
export const OFF_TIRED = 1.5;
/** Активность размазана по суткам ровнее этого — ни сова, ни жаворонок. */
const SPREAD = 0.15;

/**
 * Средний час активности по кругу и насколько он выражен (0 — ровно по всем суткам, 1 — один час).
 * null — данных нет.
 */
export function center(hours: readonly number[]): { hour: number; focus: number } | null {
  let x = 0;
  let y = 0;
  let total = 0;
  hours.forEach((w, h) => {
    if (!(w > 0) || h > 23) return;
    const a = ((h + 0.5) / 24) * 2 * Math.PI;
    x += w * Math.cos(a);
    y += w * Math.sin(a);
    total += w;
  });
  if (total === 0) return null;
  const hour = (((Math.atan2(y, x) / (2 * Math.PI)) * 24) + 24) % 24;
  return { hour, focus: Math.hypot(x, y) / total };
}

/** Кто она по часам человека; null — знакомы меньше KNOWN_MS. */
export function kind(hours: readonly number[]): Chrono | null {
  const total = hours.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  const c = center(hours);
  if (total < KNOWN_MS || !c) return null;
  if (c.focus < SPREAD) return 'dove';
  if (c.hour >= 3 && c.hour < 12.5) return 'lark';
  if (c.hour >= 12.5 && c.hour < 16) return 'dove';
  return 'owl';
}

/** «Не свои» часы: жаворонок клюёт носом вечером, сова — утром, голубь — глубокой ночью. */
export function off(k: Chrono | null, hour: number): boolean {
  if (k === 'lark') return hour >= 21 || hour < 5;
  if (k === 'owl') return hour >= 6 && hour < 12;
  if (k === 'dove') return hour >= 1 && hour < 6;
  return false;
}

/** Множитель усталости для sleep.step. */
export function tired(hours: readonly number[], hour: number): number {
  return off(kind(hours), hour) ? OFF_TIRED : 1;
}

/** Строка для окна статистики. */
export function describe(k: Chrono | null): { value: string; hint: string } {
  if (k === 'lark') return t({ value: 'жаворонок', hint: 'клюёт носом по вечерам' }, { value: 'early bird', hint: 'nods off in the evening' });
  if (k === 'owl') return t({ value: 'сова', hint: 'отсыпается по утрам' }, { value: 'night owl', hint: 'sleeps in in the morning' });
  if (k === 'dove') return t({ value: 'голубь', hint: 'спит глубокой ночью' }, { value: 'in between', hint: 'sleeps late at night' });
  // value — крупным моноширинным в узкой карточке: одно длинное слово туда не влезает
  return t({ value: 'пока неясно', hint: 'присматривается, нужно 10 ч вместе' }, { value: 'not yet clear', hint: 'still figuring out, needs 10 h together' });
}
