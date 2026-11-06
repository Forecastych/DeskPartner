/**
 * «Кино вместе»: человек смотрит фильм — кошка садится в угол у края и смотрит с ним.
 * Что видео идёт и где громко, говорит Rust (media.rs, поле `media` в senses). Здесь только
 * решения по времени: когда считать, что сеанс начался и кончился, когда кошке пора заскучать
 * и уйти спать за край, когда выглянуть на громкой сцене.
 *
 * Чистые функции, как sleep.ts: на вход состояние и прошедшие мс, на выход новое состояние и событие.
 */

import type { Verdict } from './reviews';
import { EDGE_GAP, side, surfaces, type Goal, type Pet, type World } from './roam';

const MIN = 60_000;

/** Видео идёт столько подряд — это сеанс, а не ролик в ленте или реклама перед ним. */
export const START_MS = 10_000;
/** Видео нет столько подряд — сеанс кончился; пауза на чай короче. */
export const END_MS = 30_000;
/** Первые 20 минут фильма кошка не спит никогда, каким бы скучным он ни был. */
export const AWAKE_MS = 20 * MIN;
/** Не скучный или неизвестный фильм: задуматься о сне можно не раньше часа. */
export const LONG_MS = 60 * MIN;
/** Шанс уснуть на скучном фильме: не на каждом. */
export const DULL_DOZE = 0.6;
/** Шанс уснуть на долгом обычном фильме. */
export const LONG_DOZE = 0.2;
/** Решила уснуть — уходит не сразу, а через столько: 0..DOZE_SPREAD_MS. */
export const DOZE_SPREAD_MS = 10 * MIN;

export interface Movie {
  /** Мс подряд, что видео идёт (пока сеанс не начался). */
  on: number;
  /** Мс подряд, что видео нет (пока сеанс идёт). */
  off: number;
  /** Сеанс идёт: кошка в углу. */
  active: boolean;
  /** Мс сеанса. */
  watched: number;
  /**
   * Сон на этом сеансе: 'later' — ещё не решала, число — мс сеанса, когда уйдёт,
   * 'no' — решила не спать или уже поспала.
   */
  doze: 'later' | 'no' | number;
}

export type MovieEvent = 'start' | 'end' | 'doze';

export function fresh(): Movie {
  return { on: 0, off: 0, active: false, watched: 0, doze: 'later' };
}

/** С какой минуты сеанса задумываться о сне при таком вердикте. */
export const thinkAt = (v: Verdict): number => (v === 'dull' ? AWAKE_MS : LONG_MS);

/**
 * Один шаг. `playing` — media.watching из senses, `v` — вердикт отзывов (или 'unknown'),
 * `rnd` — Math.random. Событие 'doze' приходит один раз за сеанс.
 */
export function step(m: Movie, ms: number, playing: boolean, v: Verdict, rnd: () => number): [Movie, MovieEvent | null] {
  const dt = Math.max(ms, 0) || 0;
  if (!m.active) {
    const on = playing ? m.on + dt : 0;
    if (on < START_MS) return [{ ...m, on }, null];
    return [{ ...fresh(), active: true, watched: on }, 'start'];
  }
  const off = playing ? 0 : m.off + dt;
  if (off >= END_MS) return [fresh(), 'end'];
  const watched = m.watched + dt;
  let doze = m.doze;
  if (doze === 'later' && watched >= thinkAt(v)) {
    const chance = v === 'dull' ? DULL_DOZE : LONG_DOZE;
    doze = rnd() < chance ? watched + rnd() * DOZE_SPREAD_MS : 'no';
  }
  if (typeof doze === 'number' && watched >= doze) return [{ ...m, off, watched, doze: 'no' }, 'doze'];
  return [{ ...m, off, watched, doze }, null];
}

/** Выспалась или выглянула на громкой сцене: досматривает, больше на этом сеансе не уснёт. */
export const awake = (m: Movie): Movie => ({ ...m, doze: 'no' });

/** Монитор под точкой; мимо всех — основной. */
function monitorAt(world: World, x: number, y: number): number {
  const i = world.monitors.findIndex((m) => x >= m.rect.left && x < m.rect.right && y >= m.rect.top && y < m.rect.bottom);
  return i >= 0 ? i : 0;
}

/** Монитор, где стоит кошка. */
export const petScreen = (world: World, pet: Pet): number => monitorAt(world, pet.x, pet.y - 1);

/**
 * Монитор, целиком накрытый окном (кино на весь экран); такого нет — null. Смотрим и полосы
 * заголовков: Chrome, развёрнутый до перехода на весь экран, Windows так и считает развёрнутым.
 */
function fullscreen(world: World): number | null {
  for (const { frame: f } of [...world.ledges, ...(world.strips ?? [])]) {
    const i = world.monitors.findIndex(({ rect: r }) => f.left <= r.left && f.top <= r.top && f.right >= r.right && f.bottom >= r.bottom);
    if (i >= 0) return i;
  }
  return null;
}

/**
 * Монитор фильма. Окно на весь экран решает всегда: фильм развернули или перетащили — кошка следом,
 * и фокус ему для этого не нужен. Иначе держится выбранного раньше (`prev`): клик по окну на другом
 * мониторе фильм туда не переносит. В начале сеанса без окна на весь экран — монитор активного
 * окна (только что нажали «играть»), а нет его — тот, где кошка.
 */
export function screen(world: World, pet: Pet, prev: number | null): number {
  const full = fullscreen(world);
  if (full !== null) return full;
  if (prev !== null && prev < world.monitors.length) return prev;
  const frame = [...world.ledges, ...(world.strips ?? [])].find((l) => l.hwnd === world.active)?.frame;
  return frame ? monitorAt(world, (frame.left + frame.right) / 2, (frame.top + frame.bottom) / 2) : petScreen(world, pet);
}

/**
 * Куда сесть смотреть: пол того монитора, где фильм, у ближнего к кошке края — середину
 * и субтитры не закрывает. На весь экран пол опущен до края монитора (world.rs), так что
 * в полноэкранном она у самого низа.
 */
export function seat(world: World, pet: Pet, i: number): Goal {
  const floor = surfaces(world).find((s) => s.kind === 'floor' && s.monitor === i)!;
  const half = side(world.monitors[i]) / 2 + EDGE_GAP;
  const left = floor.left + half;
  const right = floor.right - half;
  // на другом мониторе — к его ближнему краю; по умолчанию правый, как появляется
  const x = pet.x - left < right - pet.x ? left : right;
  return { surface: floor.id, x };
}

/** Сидит на месте у фильма: дошла и смотрит. */
export const seated = (pet: Pet, g: Goal): boolean => pet.on === g.surface && Math.abs(pet.x - g.x) < 1 && pet.move === 'still';
