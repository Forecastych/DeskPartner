// Привязанность 0..100 — считается из статистики, своего хранилища у неё нет. Забота и игры
// поднимают, побег от голода, месть и побудки опускают. Рост замедляется к сотне: первые
// кормёжки дают много, дальше — понемногу, чтобы «обожает» надо было заслужить.

import type { Stats } from './stats';

const HOUR = 3_600_000;

/** Очки до насыщения: столько набрать — примерно 63 из 100. */
const SCALE = 200;

const PLUS: Partial<Record<keyof Stats, number>> = {
  fed: 3,
  petted: 2,
  carried: 1,
  mice: 1,
  yarns: 2,
  lasers: 2,
  films: 4,
};

const MINUS: Partial<Record<keyof Stats, number>> = {
  runaways: 60,
  revenges: 4,
  woken: 1,
};

function points(s: Stats, w: Partial<Record<keyof Stats, number>>): number {
  let p = 0;
  for (const [k, v] of Object.entries(w)) p += (Number(s[k as keyof Stats]) || 0) * (v ?? 0);
  return p;
}

/** 0..100, целое. Час рядом на экране — одно очко. */
export function level(s: Stats): number {
  const score = points(s, PLUS) + s.together / HOUR - points(s, MINUS);
  if (!(score > 0)) return 0;
  return Math.round(100 * (1 - Math.exp(-score / SCALE)));
}

/** Словами: для подписи под шкалой. */
export function word(n: number): string {
  if (n < 15) return 'присматривается';
  if (n < 40) return 'привыкает';
  if (n < 65) return 'доверяет';
  if (n < 90) return 'обожает';
  return 'жить без тебя не может';
}
