import { describe, expect, it } from 'vitest';
import { change, DIG_MS, drop, freshBox, GAP_MAX, GAP_MIN, gap, GIVE_UP, loadBox, owns, pose, scoop, SQUAT_MS, start, tick, used, type Visit, wear, WEAR_VISITS } from './litter';
import { atLitter, bedAt, litterAt, type Monitor, type Pet, type Place, SIDE, spawn, type World } from './roam';

const FRAME = 40;

function monitor(left: number, w: number): Monitor {
  const rect = { left, top: 0, right: left + w, bottom: 1080 };
  return { rect, work: { ...rect, bottom: 1040 }, scale: 1, primary: left === 0 };
}

const empty: World = { monitors: [monitor(0, 1920)], ledges: [] };
const at = (w: World, x: number): Pet => ({ ...spawn(w), x });

function run(w: World, cat: Pet, place: (t: number) => Place | null = () => null) {
  let [v, pet] = start(w, cat, place(0), 0)!;
  const phases = [v.phase];
  const poses = new Set<string>();
  let sat: Pet | null = null;
  let t = 0;
  for (t = FRAME; t < 10 * GIVE_UP && owns(v); t += FRAME) {
    [v, pet] = tick(v, w, pet, place(t), t, FRAME);
    if (v.phase !== phases[phases.length - 1]) phases.push(v.phase);
    if (v.phase === 'squat') sat ??= pet;
    const ps = pose(v, pet);
    if (ps) poses.add(ps);
  }
  return { v, pet, phases, poses, sat, t };
}

describe('место лотка', () => {
  it('по умолчанию у левого угла, правее лежака и не на нём', () => {
    const l = litterAt(empty)!;
    const b = bedAt(empty)!;
    expect(l.surface).toBe(b.surface);
    expect(l.x - b.x).toBeGreaterThanOrEqual(SIDE);
  });
});

describe('поход в лоток', () => {
  it('идёт, сидит в лотке, закапывает, носится', () => {
    const r = run(empty, at(empty, 1500));
    expect(r.phases).toEqual(['go', 'squat', 'dig', 'leave', 'done']);
    expect(atLitter(r.sat!, empty)).toBe(true);
    for (const p of ['walk', 'potty', 'dig', 'run']) expect(r.poses.has(p)).toBe(true);
    expect(Math.abs(r.pet.x - r.sat!.x)).toBeGreaterThan(SIDE);
  });

  it('сидит SQUAT_MS и закапывает DIG_MS', () => {
    let [v, pet] = start(empty, at(empty, litterAt(empty)!.x), null, 0)!;
    let t = 0;
    while (v.phase === 'go') [v, pet] = tick(v, empty, pet, null, (t += FRAME), FRAME);
    const sat = t;
    let squatted = pet;
    while (v.phase === 'squat') [v, pet] = tick(v, empty, (squatted = pet), null, (t += FRAME), FRAME);
    expect(t - sat).toBeGreaterThanOrEqual(SQUAT_MS);
    const dug = t;
    // закапывать развернулась на месте: то, что под крупом, теперь под лапой
    expect(pet.facing).toBe(-squatted.facing);
    expect(pet.x).toBe(squatted.x);
    while (v.phase === 'dig') [v, pet] = tick(v, empty, pet, null, (t += FRAME), FRAME);
    expect(t - dug).toBeGreaterThanOrEqual(DIG_MS);
    expect(v.phase).toBe('leave');
  });

  it('лоток перетащили по дороге — идёт к новому месту', () => {
    const moved: Place = { x: 900, y: 1040 };
    const r = run(empty, at(empty, 1500), (t) => (t < 1000 ? null : moved));
    expect(r.phases).toEqual(['go', 'squat', 'dig', 'leave', 'done']);
    expect(atLitter(r.sat!, empty, moved)).toBe(true);
  });

  it('не дошла за GIVE_UP — бросает', () => {
    let [v, pet] = start(empty, at(empty, 1500), null, 0)!;
    [v, pet] = tick(v, empty, pet, null, GIVE_UP, FRAME);
    expect(v.phase).toBe('done');
    expect(owns(v)).toBe(false);
  });

  it('прервали — правит приложение', () => {
    const [v] = start(empty, at(empty, 1500), null, 0)!;
    const d: Visit = drop(v);
    expect(owns(d)).toBe(false);
    expect(tick(d, empty, at(empty, 1500), null, 1, FRAME)[0]).toBe(d);
  });

  it('за краем — без позы', () => {
    const [v, pet] = start(empty, at(empty, 1500), null, 0)!;
    expect(pose(v, { ...pet, move: 'out' })).toBeNull();
  });

  it('между походами полтора-три часа', () => {
    expect(gap(() => 0)).toBe(GAP_MIN);
    expect(gap(() => 0.999)).toBeLessThan(GAP_MAX);
    expect(gap(() => 0.5)).toBeGreaterThan(GAP_MIN);
  });
});

describe('что в лотке', () => {
  it('каждый поход — комочек; «Убрать» вычерпывает, а наполнитель стареет дальше', () => {
    let b = freshBox();
    for (let i = 0; i < WEAR_VISITS; i++) b = used(b);
    expect(b.clumps).toBe(WEAR_VISITS);
    expect(wear(b)).toBe(1);
    b = scoop(b);
    expect(b.clumps).toBe(0);
    expect(wear(b)).toBe(1);
    expect(wear(used(b))).toBe(1);
  });

  it('«Поменять» — всё свежее', () => {
    expect(change()).toEqual(freshBox());
    expect(wear(change())).toBe(0);
  });

  it('из файла: место рядом не мешает, мусор — свежий лоток', () => {
    expect(loadBox(JSON.stringify({ x: 10, y: 20, clumps: 2, visits: 9 }))).toEqual({ clumps: 2, visits: 9 });
    expect(loadBox(JSON.stringify({ x: 10, y: 20 }))).toEqual(freshBox());
    expect(loadBox(JSON.stringify({ clumps: -3, visits: 'много' }))).toEqual(freshBox());
    expect(loadBox('{')).toEqual(freshBox());
    expect(loadBox(null)).toEqual(freshBox());
  });
});
