import { describe, expect, it } from 'vitest';
import {
  arena,
  bolt,
  CHASE_MAX,
  CHASE_MIN,
  type Chase,
  GIVE_UP,
  SCARE,
  type HuntEvent,
  owns,
  start,
  tick,
  view,
} from './mouse';
import { spawn, type Ledge, type Monitor, type Pet, SIDE, type World } from './roam';

const FRAME = 40;

function monitor(left: number, w: number): Monitor {
  const rect = { left, top: 0, right: left + w, bottom: 1080 };
  return { rect, work: { ...rect, bottom: 1040 }, scale: 1, primary: left === 0 };
}

/** Окно 400..1400 с кромкой на 500 и полка внутри него на 800. */
const win: Ledge = { hwnd: 7, y: 500, left: 400, right: 1400, frame: { left: 400, top: 500, right: 1400, bottom: 1000 } };
const shelf: Ledge = { hwnd: 8, y: 800, left: 450, right: 1350, frame: { left: 450, top: 800, right: 1350, bottom: 990 } };
const world: World = { monitors: [monitor(0, 1920)], ledges: [win] };

/** Детерминированный генератор (LCG), как Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Run {
  c: Chase;
  cat: Pet;
  t: number;
  events: [number, HuntEvent][];
  /** Самая длинная серия кадров подряд, в конце которых мышь стоит, а кошка ближе SCARE. */
  caught: number;
  /** Поверхности под мышью за всю погоню. */
  on: Set<string>;
  /** Сколько раз мышь пропадала за краем, пока шла погоня. */
  hid: number;
  phases: Set<string>;
}

/** Прогнать погоню до конца (или до limit мс) кадрами по FRAME мс. */
function run(seed: number, w: World = world, limit = CHASE_MAX + 2 * GIVE_UP + 60_000): Run {
  const rand = seeded(seed);
  let c = start(w, 0, rand);
  let cat = spawn(w);
  const r: Run = { c, cat, t: 0, events: [], caught: 0, on: new Set(), hid: 0, phases: new Set() };
  let close = 0;
  let wasOut = c.mouse.move === 'out';
  for (let t = FRAME; t <= limit && c.phase !== 'done'; t += FRAME) {
    let e: HuntEvent | null;
    [c, cat, e] = tick(c, w, cat, t, FRAME, rand);
    r.t = t;
    r.phases.add(c.phase);
    if (e) r.events.push([t, e]);
    if (c.mouse.on) r.on.add(c.mouse.on);
    const out = c.mouse.move === 'out';
    if (out && !wasOut && c.phase === 'hunt') r.hid++;
    wasOut = out;
    const near = Math.hypot(cat.x - c.mouse.x, cat.y - c.mouse.y) < SCARE * SIDE;
    close = c.phase === 'hunt' && !out && c.mouse.move === 'still' && cat.move !== 'out' && near ? close + 1 : 0;
    r.caught = Math.max(r.caught, close);
  }
  return { ...r, c, cat };
}

const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
const runs = seeds.map((s) => run(s, arena(world, 'screen', [shelf])));

describe('mouse', () => {
  it('мышь выходит из-за края, погоня — от 2 до 4 минут', () => {
    for (const s of seeds) {
      const c = start(world, 1000, seeded(s));
      expect(c.phase).toBe('hunt');
      expect(c.until).toBeGreaterThanOrEqual(1000 + CHASE_MIN);
      expect(c.until).toBeLessThan(1000 + CHASE_MAX);
      expect(c.mouse.move).toBe('walk');
      expect(c.mouse.x < 0 || c.mouse.x > 1920).toBe(true);
    }
  });

  it('погоня кончается после until и не позже чем через минуту с небольшим', () => {
    for (const r of runs) {
      expect(r.c.phase).toBe('done');
      expect(r.t).toBeGreaterThanOrEqual(r.c.until);
      expect(r.t).toBeLessThan(r.c.until + 2 * GIVE_UP + 10_000);
    }
  });

  it('мышь никогда не ловят: кошка рядом — стоящая мышь удирает на следующем же кадре', () => {
    // кошка в прыжке или падении может долететь за кадр, но мышь уже не стоит
    for (const r of runs) expect(r.caught).toBeLessThanOrEqual(1);
  });

  it('бывают оба финала; вместе — кошка уходит за край и возвращается облизываясь', () => {
    const together = runs.filter((r) => r.c.end === 'together');
    const escape = runs.filter((r) => r.c.end === 'escape');
    expect(together.length).toBeGreaterThan(0);
    expect(escape.length).toBeGreaterThan(0);
    for (const r of together) {
      expect(r.phases.has('away')).toBe(true);
      expect(r.events.at(-1)?.[1]).toBe('lick');
      expect(r.cat.move).not.toBe('out');
    }
    for (const r of escape) {
      expect(r.phases.has('away')).toBe(false);
      expect(r.events.at(-1)?.[1]).toBe('done');
      expect(r.cat.hunt).toBeUndefined();
    }
  });

  it('каждая погоня своя: кромки, полка в окне, уходы за край, заносы кошки', () => {
    expect(runs.some((r) => r.on.has('ledge:7:400'))).toBe(true);
    expect(runs.some((r) => r.on.has('ledge:8:450'))).toBe(true);
    expect(runs.every((r) => r.hid > 0 || r.on.size > 1)).toBe(true);
    expect(runs.some((r) => r.hid > 0)).toBe(true);
    expect(runs.some((r) => r.events.some(([, e]) => e === 'skid'))).toBe(true);
    // разные зерна — разные маршруты
    const routes = new Set(runs.map((r) => [...r.on].sort().join(',') + r.hid));
    expect(routes.size).toBeGreaterThan(1);
  });

  it('у панели задач мышь только на полу', () => {
    for (const s of seeds.slice(0, 4)) {
      const r = run(s, arena(world, 'taskbar', [shelf]));
      expect([...r.on].every((id) => id.startsWith('floor:'))).toBe(true);
    }
  });

  it('прервали — мышь уходит за край, кошку не трогает', () => {
    const rand = seeded(3);
    let c = start(world, 0, rand);
    const cat = spawn(world);
    for (let t = FRAME; t <= 5000; t += FRAME) [c] = tick(c, world, cat, t, FRAME, rand);
    c = bolt(c, world, cat, rand);
    expect(owns(c)).toBe(false);
    let t = 5000;
    while (c.phase !== 'done' && t < 60_000) {
      t += FRAME;
      const [n, p, e] = tick(c, world, cat, t, FRAME, rand);
      expect(p).toBe(cat);
      expect(e).toBeNull();
      c = n;
    }
    expect(c.phase).toBe('done');
    expect(view(c)).toBeNull();
  });

  it('view: бежит или сидит, за краем — не видна', () => {
    const c = start(world, 0, seeded(1));
    expect(view({ ...c, mouse: { ...c.mouse, move: 'out' } })).toBeNull();
    expect(view({ ...c, phase: 'done' })).toBeNull();
    const shown = { ...c, mouse: { ...c.mouse, x: 900, y: 1040, move: 'still' as const } };
    expect(view(shown)).toMatchObject({ x: 900, y: 1040, anim: 'sit' });
    expect(view({ ...shown, mouse: { ...shown.mouse, move: 'walk' } })?.anim).toBe('run');
  });
});
