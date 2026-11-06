import { describe, expect, it } from 'vitest';
import {
  AWAKE_MS,
  awake,
  DOZE_SPREAD_MS,
  END_MS,
  fresh,
  LONG_MS,
  type Movie,
  type MovieEvent,
  screen,
  seat,
  START_MS,
  step,
} from './movie';
import type { Verdict } from './reviews';
import { EDGE_GAP, type Monitor, type Pet, SIDE, spawn, type World } from './roam';

const MIN = 60_000;
const TICK = 2000;

/** Прожить `ms` шагами по 2 с (как опрос senses) и собрать события. */
function run(m: Movie, ms: number, playing: boolean, v: Verdict = 'unknown', rnd = () => 0): [Movie, MovieEvent[]] {
  const events: MovieEvent[] = [];
  for (let left = ms; left > 0; left -= TICK) {
    const [next, e] = step(m, Math.min(TICK, left), playing, v, rnd);
    m = next;
    if (e) events.push(e);
  }
  return [m, events];
}

describe('сеанс', () => {
  it('ролик короче START_MS сеансом не считается', () => {
    const [m, events] = run(fresh(), START_MS - TICK, true);
    expect(events).toEqual([]);
    expect(m.active).toBe(false);
    // прервался — отсчёт заново
    const [again] = run(m, TICK, false);
    expect(again.on).toBe(0);
  });

  it('начинается через START_MS и кончается после END_MS без видео', () => {
    const [m, events] = run(fresh(), START_MS, true);
    expect(events).toEqual(['start']);
    expect(m.active).toBe(true);
    // пауза на чай короче END_MS — сеанс идёт
    const [paused, none] = run(m, END_MS - TICK, false);
    expect(none).toEqual([]);
    const [resumed] = run(paused, TICK, true);
    expect(resumed.off).toBe(0);
    const [, end] = run(resumed, END_MS, false);
    expect(end).toEqual(['end']);
  });
});

describe('сон на фильме', () => {
  const started = (): Movie => run(fresh(), START_MS, true)[0];

  it('первые 20 минут не спит даже на скучном', () => {
    const [, events] = run(started(), AWAKE_MS - START_MS - TICK, true, 'dull', () => 0);
    expect(events).toEqual([]);
  });

  it('скучный: после 20 минут уходит спать, если повезло, и один раз за сеанс', () => {
    // rnd 0: решила спать и уходит сразу
    const [m, events] = run(started(), AWAKE_MS, true, 'dull', () => 0);
    expect(events).toEqual(['doze']);
    const [, more] = run(m, 2 * LONG_MS, true, 'dull', () => 0);
    expect(more).toEqual([]);
  });

  it('скучный, но не повезло — досматривает', () => {
    const [, events] = run(started(), 3 * LONG_MS, true, 'dull', () => 0.99);
    expect(events).toEqual([]);
  });

  it('уход растянут на DOZE_SPREAD_MS', () => {
    const rolls = [0, 0.5];
    const rnd = () => rolls.shift() ?? 0;
    const [m] = run(started(), AWAKE_MS, true, 'dull', rnd);
    expect(typeof m.doze).toBe('number');
    expect(m.doze as number).toBeGreaterThanOrEqual(AWAKE_MS + DOZE_SPREAD_MS / 2 - TICK);
  });

  it('обычный или неизвестный — не раньше часа и реже', () => {
    for (const v of ['fine', 'unknown'] as const) {
      const [m, early] = run(started(), LONG_MS - START_MS - TICK, true, v, () => 0);
      expect(early).toEqual([]);
      const [, late] = run(m, 2 * TICK, true, v, () => 0);
      expect(late).toEqual(['doze']);
    }
    // 0.3 больше шанса долгого фильма, но меньше шанса скучного
    const [, fine] = run(started(), 2 * LONG_MS, true, 'fine', () => 0.3);
    expect(fine).toEqual([]);
    const [, dull] = run(started(), 2 * LONG_MS, true, 'dull', () => 0.3);
    expect(dull).toEqual(['doze']);
  });

  it('выглянула — больше не уснёт', () => {
    const [, events] = run(awake(started()), 3 * LONG_MS, true, 'dull', () => 0);
    expect(events).toEqual([]);
  });
});

describe('место', () => {
  const mon = (left: number): Monitor => {
    const rect = { left, top: 0, right: left + 1920, bottom: 1080 };
    return { rect, work: { ...rect, bottom: 1040 }, scale: 1, primary: left === 0 };
  };
  const two: World = { monitors: [mon(0), mon(1920)], ledges: [] };
  const at = (w: World, x: number): Pet => ({ ...spawn(w), x, y: 1040 });
  const half = SIDE / 2 + EDGE_GAP;

  const win = (hwnd: number, left: number, top: number, right: number, bottom: number) => ({
    hwnd,
    y: top,
    left,
    right,
    frame: { left, top, right, bottom },
  });

  it('к ближнему краю пола своего монитора', () => {
    expect(seat(two, at(two, 300), screen(two, at(two, 300), null))).toEqual({ surface: 'floor:0', x: half });
    expect(seat(two, at(two, 1700), 0)).toEqual({ surface: 'floor:0', x: 1920 - half });
  });

  it('фильм на другом мониторе — туда, к краю, ближнему к кошке', () => {
    const w: World = { ...two, ledges: [win(7, 2000, 100, 3000, 900)], active: 7 };
    expect(screen(w, at(w, 300), null)).toBe(1);
    expect(seat(w, at(w, 300), 1)).toEqual({ surface: 'floor:1', x: 1920 + half });
  });

  it('клик по окну на другом мониторе фильм не переносит', () => {
    const w: World = { ...two, ledges: [win(7, 2000, 100, 3000, 900)], active: 7 };
    expect(screen(w, at(w, 300), 0)).toBe(0);
  });

  it('окно на весь экран решает и без фокуса', () => {
    const w: World = { ...two, ledges: [win(7, 2000, 100, 3000, 900), win(9, 0, 0, 1920, 1080)], active: 7 };
    expect(screen(w, at(w, 2500), 1)).toBe(0);
    // развёрнутое до панели задач — не весь экран
    const max: World = { ...two, ledges: [win(9, -8, -8, 1928, 1040)], active: 9 };
    expect(screen(max, at(max, 2500), 1)).toBe(1);
    // Chrome на весь экран из развёрнутого — в полосах заголовков, не в кромках
    const strip: World = { ...two, ledges: [win(7, 2000, 100, 3000, 900)], strips: [win(9, 0, 0, 1920, 1080)], active: 7 };
    expect(screen(strip, at(strip, 2500), null)).toBe(0);
    // а Chrome на весь экран недобирает снизу строку в 1 px
    const chrome: World = { ...two, ledges: [win(7, 2000, 100, 3000, 900)], strips: [win(9, 0, 0, 1920, 1079)], active: 7 };
    expect(screen(chrome, at(chrome, 2500), 1)).toBe(0);
  });
});
