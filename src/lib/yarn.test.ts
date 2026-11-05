import { describe, expect, it } from 'vitest';
import { drop, type Game, GIVE_UP, owns, PLAY_MAX, PLAY_MIN, pose, RADIUS, start, tick, view } from './yarn';
import { spawn, type Monitor, type Pet, SIDE, type World } from './roam';

const FRAME = 40;

function monitor(left: number, w: number, scale = 1): Monitor {
  const rect = { left, top: 0, right: left + w, bottom: 1080 };
  return { rect, work: { ...rect, bottom: 1040 }, scale, primary: left === 0 };
}

const world: World = { monitors: [monitor(0, 1920)], ledges: [] };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Run {
  g: Game;
  cat: Pet;
  t: number;
  phases: string[];
  /** Мс игры с клубком на экране в фазе play. */
  played: number;
  /** Самый левый и правый край клубка за игру. */
  lo: number;
  hi: number;
  bats: number;
}

function run(seed: number, w: World = world, x?: number): Run {
  const rand = seeded(seed);
  let cat = spawn(w);
  if (x !== undefined) cat = { ...cat, x };
  const s = start(w, cat, 0);
  if (!s) throw new Error('no start');
  let [g] = s;
  [, cat] = s;
  const r: Run = { g, cat, t: 0, phases: [g.phase], played: 0, lo: Infinity, hi: -Infinity, bats: 0 };
  const limit = PLAY_MAX + 6 * GIVE_UP;
  for (let t = FRAME; t <= limit && g.phase !== 'done'; t += FRAME) {
    const was = g;
    [g, cat] = tick(g, w, cat, t, FRAME, rand);
    if (g.phase !== r.phases[r.phases.length - 1]) r.phases.push(g.phase);
    if (g.phase === 'play' && was.phase === 'play') r.played += FRAME;
    if (was.act === 'aim' && g.act === 'watch') r.bats++;
    const v = view(g, w);
    if (v && g.phase === 'play') {
      r.lo = Math.min(r.lo, v.x);
      r.hi = Math.max(r.hi, v.x);
    }
    r.t = t;
  }
  return { ...r, g, cat };
}

describe('yarn', () => {
  it('fetches the ball, plays a couple of minutes, rolls it out and comes back', () => {
    for (const seed of [1, 2, 3, 42, 777]) {
      const r = run(seed);
      expect(r.phases).toEqual(['fetch', 'away', 'enter', 'play', 'out', 'follow', 'gone', 'return', 'done']);
      expect(r.played).toBeGreaterThanOrEqual(PLAY_MIN - 1000);
      expect(r.played).toBeLessThan(PLAY_MAX + 2 * GIVE_UP);
      expect(r.bats).toBeGreaterThan(5);
      // вернулась на экран, стоит на полу
      expect(r.cat.move).not.toBe('out');
      expect(r.cat.x).toBeGreaterThan(0);
      expect(r.cat.x).toBeLessThan(1920);
      expect(r.g.ball).toBeNull();
    }
  });

  it('keeps the ball on the floor of the screen while playing', () => {
    for (const seed of [5, 6, 7]) {
      const r = run(seed);
      const rad = RADIUS * SIDE;
      expect(r.lo).toBeGreaterThanOrEqual(rad - 1);
      expect(r.hi).toBeLessThanOrEqual(1920 - rad + 1);
    }
  });

  it('leaves by the nearest edge and rolls the ball out the same way', () => {
    const left = run(9, world, 300);
    expect(left.g.door.dir).toBe(-1);
    const right = run(9, world, 1600);
    expect(right.g.door.dir).toBe(1);
  });

  it('ends even when the ball sits at the far edge at the last bat', () => {
    // много сидов — среди них найдутся концовки с клубком у дальнего края
    for (let seed = 100; seed < 130; seed++) expect(run(seed).phases.at(-1)).toBe('done');
  });

  it('crouches before a bat and stands otherwise', () => {
    const g: Game = { phase: 'play', door: { monitor: 0, dir: 1 }, ball: { x: 500, v: 0, turn: 0 }, act: 'aim', until: 1e9, t: 0 };
    expect(pose(g)).toBe('crouch');
    expect(pose({ ...g, act: 'watch' })).toBe('stand');
  });

  it('drop lets the app take the cat and the ball rolls away by itself', () => {
    const rand = seeded(3);
    let [g, cat] = start(world, spawn(world), 0)!;
    let t = 0;
    while (g.phase !== 'play' && t < 60_000) {
      t += FRAME;
      [g, cat] = tick(g, world, cat, t, FRAME, rand);
    }
    expect(g.phase).toBe('play');
    g = drop(g, t);
    expect(owns(g)).toBe(false);
    const held = cat;
    for (let i = 0; i < 2000 && g.phase !== 'done'; i++) {
      t += FRAME;
      let c2: Pet;
      [g, c2] = tick(g, world, cat, t, FRAME, rand);
      expect(c2).toBe(held);
    }
    expect(g.phase).toBe('done');
    expect(view(g, world)).toBeNull();
  });

  it('cannot start without an outer edge', () => {
    // два монитора замкнуты не бывают, а без мониторов краёв нет
    expect(start({ monitors: [], ledges: [] }, spawn(world), 0)).toBeNull();
  });

  it('scales the ball with the monitor', () => {
    const w2: World = { monitors: [monitor(0, 3840, 2)], ledges: [] };
    const r = run(4, w2);
    expect(r.phases.at(-1)).toBe('done');
    expect(r.lo).toBeGreaterThanOrEqual(RADIUS * SIDE * 2 - 1);
  });

  it('view gives frames 0..3 and the floor line', () => {
    const g: Game = { phase: 'play', door: { monitor: 0, dir: 1 }, ball: { x: 500, v: 50, turn: 0 }, act: 'watch', until: 1e9, t: 0 };
    const seen = new Set<number>();
    for (let turn = -100; turn < 100; turn += 3) {
      const v = view({ ...g, ball: { ...g.ball!, turn } }, world)!;
      seen.add(v.frame);
      expect(v.y).toBe(1040);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});
