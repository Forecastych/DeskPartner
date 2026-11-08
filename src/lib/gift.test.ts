import { describe, expect, it } from 'vitest';
import {
  accept,
  ANNOUNCE_MS,
  carrying,
  type Cue,
  due,
  EAT_MS,
  FETCH_MS,
  fresh,
  GIFT_AT,
  GIFT_GAP,
  GIVE_UP,
  given,
  load,
  lying,
  moved,
  owns,
  type Phase,
  pose,
  PURR_MS,
  putAt,
  remove,
  save,
  start,
  takeBack,
  thank,
  tick,
  type Visit,
  WAIT_MS,
} from './gift';
import { giftAt, litterAt, type Monitor, type Pet, type Place, SIDE, spawn, type World } from './roam';

const FRAME = 40;
const HOUR = 3_600_000;

function monitor(left: number, w: number): Monitor {
  const rect = { left, top: 0, right: left + w, bottom: 1080 };
  return { rect, work: { ...rect, bottom: 1040 }, scale: 1, primary: left === 0 };
}

const empty: World = { monitors: [monitor(0, 1920)], ledges: [] };
const at = (w: World, x: number): Pet => ({ ...spawn(w), x });

/** Гоняет сценку до конца; `place` — где лежит подарок в момент t. */
function run(w: World, v: Visit, pet: Pet, t0: number, place: (t: number) => Place | null = () => null) {
  const phases: Phase[] = [v.phase];
  const cues: [Cue, number, Pet][] = [];
  const poses = new Set<string>();
  let carried = false;
  let t = t0;
  for (t = t0 + FRAME; t < t0 + 20 * GIVE_UP && owns(v); t += FRAME) {
    let cue: Cue | null;
    [v, pet, cue] = tick(v, w, pet, place(t), t, FRAME);
    if (cue) cues.push([cue, t, pet]);
    if (v.phase !== phases[phases.length - 1]) phases.push(v.phase);
    const ps = pose(v, pet, t);
    if (ps) poses.add(ps);
    if (carrying(v) && pet.move !== 'out') carried = true;
  }
  return { v, pet, phases, cues, poses, carried, t };
}

describe('когда дарить', () => {
  it('с 2400 часов вместе и только раз', () => {
    expect(GIFT_AT).toBe(2400 * HOUR);
    expect(due(fresh(), GIFT_AT - 1)).toBe(false);
    expect(due(fresh(), GIFT_AT)).toBe(true);
    // давно за 2400 (старые пользователи после обновления) — тоже раз
    expect(due(fresh(), 5000 * HOUR)).toBe(true);
    for (const g of [given({ x: 1, y: 2 }), accept(given({ x: 1, y: 2 })), remove()]) expect(due(g, 5000 * HOUR)).toBe(false);
  });
});

describe('подарок на диске', () => {
  it('переживает перезапуск с местом', () => {
    const kept = moved(accept(given({ x: 300, y: 1040 })), { x: 640, y: 900 });
    expect(load(save(kept))).toEqual({ state: 'kept', place: { x: 640, y: 900 } });
    expect(load(save(given({ x: 5, y: 6 })))).toEqual({ state: 'given', place: { x: 5, y: 6 } });
    expect(load(save(remove()))).toEqual({ state: 'gone', place: null });
    expect(load(save(fresh()))).toEqual(fresh());
  });

  it('на рамке окна помнит окно, а на диск пишет только точку', () => {
    const g = given({ x: 10.4, y: 20.6, hwnd: 7, dx: 3 });
    expect(g.place).toEqual({ x: 10.4, y: 20.6, hwnd: 7, dx: 3 });
    expect(load(save(g))).toEqual({ state: 'given', place: { x: 10, y: 21 } });
    expect(moved(g, { x: 1, y: 2 }).place).toEqual({ x: 1, y: 2 });
  });

  it('мусор — как будто не дарила, лежащий без места — убран', () => {
    for (const j of [null, '', '{', '42', '{"state":"zzz"}']) expect(load(j)).toEqual(fresh());
    expect(load('{"state":"kept"}')).toEqual(remove());
    expect(load('{"state":"given","x":"1","y":2}')).toEqual(remove());
  });

  it('лежит, пока ждёт решения или принят; убранный не двигается', () => {
    expect(lying(given({ x: 1, y: 2 }))).toBe(true);
    expect(lying(accept(given({ x: 1, y: 2 })))).toBe(true);
    expect(lying(remove())).toBe(false);
    expect(lying(fresh())).toBe(false);
    expect(moved(remove(), { x: 1, y: 2 })).toEqual(remove());
    // принять можно только то, что ждёт
    expect(accept(remove())).toEqual(remove());
  });
});

describe('приносит подарок', () => {
  it('уходит за край, возвращается с мышью в зубах, кладёт перед собой и ждёт', () => {
    const cat = at(empty, 600);
    const [v, pet] = start(empty, cat, 0)!;
    const r = run(empty, v, pet, 0);
    expect(r.phases).toEqual(['fetch', 'away', 'bring', 'wait', 'done']);
    expect(r.carried).toBe(true);
    const [cue, , sat] = r.cues[0];
    expect(cue).toBe('put');
    expect(r.cues).toHaveLength(1);
    // ушла за левый край (он ближе) и вернулась оттуда же, вглубь, не в угол к лотку
    expect(sat.x).toBeLessThan(960);
    expect(sat.x - litterAt(empty)!.x).toBeGreaterThan(SIDE);
    // мышь — перед мордой, на той же поверхности
    const p = putAt(empty, sat)!;
    expect(p.x - sat.x).toBeCloseTo(sat.facing * GIFT_GAP * SIDE);
    expect(giftAt(empty, p)!.surface).toBe(sat.on);
    for (const ps of ['walk', 'announce', 'sit']) expect(r.poses.has(ps)).toBe(true);
  });

  it('за краем ищет FETCH_MS, ждёт у подарка WAIT_MS, сначала зовёт посмотреть', () => {
    let [v, pet] = start(empty, at(empty, 300), 0)!;
    let t = 0;
    while (v.phase === 'fetch') [v, pet] = tick(v, empty, pet, null, (t += FRAME), FRAME);
    const gone = t;
    while (v.phase === 'away') [v, pet] = tick(v, empty, pet, null, (t += FRAME), FRAME);
    expect(t - gone).toBeGreaterThanOrEqual(FETCH_MS);
    while (v.phase === 'bring') [v, pet] = tick(v, empty, pet, null, (t += FRAME), FRAME);
    const put = t;
    expect(pose(v, pet, put + ANNOUNCE_MS - 1)).toBe('announce');
    expect(pose(v, pet, put + ANNOUNCE_MS)).toBe('sit');
    while (v.phase === 'wait') [v, pet] = tick(v, empty, pet, null, (t += FRAME), FRAME);
    expect(t - put).toBeGreaterThanOrEqual(WAIT_MS);
  });

  it('в прыжке, падении и за краем не начинает', () => {
    const cat = at(empty, 600);
    for (const move of ['jump', 'fall', 'out'] as const) expect(start(empty, { ...cat, move }, 0)).toBeNull();
  });
});

describe('приняли подарок', () => {
  it('мурлычет PURR_MS, где стоит', () => {
    const cat = { ...at(empty, 600), move: 'walk' as const, goal: { surface: spawn(empty).on!, x: 900 } };
    const [v, pet] = thank(cat, 0);
    expect(pet.move).toBe('still');
    expect(pet.goal).toBeNull();
    expect(pose(v, pet, 0)).toBe('petted');
    const r = run(empty, v, pet, 0);
    expect(r.phases).toEqual(['purr', 'done']);
    expect(r.t).toBeGreaterThanOrEqual(PURR_MS);
    expect(r.pet.x).toBe(600);
    expect(r.cues).toEqual([]);
  });
});

describe('убрали подарок', () => {
  it('идёт к мышке, забирает, уносит за край, ест там и засыпает', () => {
    const place = { x: 700, y: 1040 };
    const [v, pet] = takeBack(empty, at(empty, 400), place, 0)!;
    const r = run(empty, v, pet, 0, () => place);
    expect(r.phases).toEqual(['take', 'carry', 'eat', 'done']);
    expect(r.cues.map(([c]) => c)).toEqual(['took', 'eat', 'nap']);
    const [, tookAt, took] = r.cues[0];
    expect(Math.abs(took.x - giftAt(empty, place)!.x)).toBeLessThan(1);
    expect(r.carried).toBe(true);
    const [, ateAt, ate] = r.cues[1];
    expect(ate.move).toBe('out');
    expect(ateAt).toBeGreaterThan(tookAt);
    expect(r.cues[2][1] - ateAt).toBeGreaterThanOrEqual(EAT_MS);
    // за краем её не видно — позы нет
    expect(pose(r.v, ate, r.t)).toBeNull();
  });

  it('мышку перетащили, пока шла, — идёт к новому месту', () => {
    const [v0, pet0] = takeBack(empty, at(empty, 400), { x: 700, y: 1040 }, 0)!;
    let [v, pet] = [v0, pet0];
    let t = 0;
    for (let i = 0; i < 5; i++) [v, pet] = tick(v, empty, pet, { x: 700, y: 1040 }, (t += FRAME), FRAME);
    const moved = { x: 1200, y: 1040 };
    let cue: Cue | null = null;
    while (v.phase === 'take') [v, pet, cue] = tick(v, empty, pet, moved, (t += FRAME), FRAME);
    expect(cue).toBe('took');
    expect(Math.abs(pet.x - giftAt(empty, moved)!.x)).toBeLessThan(SIDE);
  });

  it('не дошла за GIVE_UP — забирает с того места, где стоит', () => {
    const [v, pet] = takeBack(empty, at(empty, 400), { x: 1800, y: 1040 }, 0)!;
    const stuck = { ...pet, move: 'still' as const };
    const [next, , cue] = tick(v, empty, stuck, { x: 1800, y: 1040 }, GIVE_UP, FRAME);
    expect(next.phase).toBe('carry');
    expect(cue).toBe('took');
  });

  it('за краем или в воздухе — нечего забирать', () => {
    const cat = at(empty, 400);
    expect(takeBack(empty, { ...cat, move: 'out' }, { x: 700, y: 1040 }, 0)).toBeNull();
    expect(takeBack({ monitors: [], ledges: [] }, cat, { x: 700, y: 1040 }, 0)).toBeNull();
  });
});
