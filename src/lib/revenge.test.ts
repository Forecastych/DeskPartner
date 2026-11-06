import { describe, expect, it } from 'vitest';
import {
  aim,
  allowed,
  begin,
  CHANCE,
  COOLDOWN,
  cooling,
  dare,
  DRY_MS,
  dryUp,
  follow,
  fresh,
  GIVE_UP,
  GRUDGE_MS,
  holds,
  kindOf,
  LIFE_MAX,
  LIFE_MIN,
  load,
  type Mission,
  owns,
  PATIENCE,
  PESTER_CLICKS,
  PESTER_MS,
  poked,
  pose,
  provoke,
  type Puddle,
  ready,
  type Revenge,
  save,
  spill,
  SPILL_MS,
  stage,
  start,
  tick,
  view,
  gone,
} from './revenge';
import { PUDDLE_FRAMES, PUDDLE_H, PUDDLE_W } from './sprite';
import { type Ledge, type Monitor, type Pet, type Rect, SIDE, spawn, surfaces, type World } from './roam';

const FRAME = 40;
const CELL = SIDE / 32;
const T0 = 1_800_000_000_000;

function monitor(left: number, w: number, scale = 1): Monitor {
  const rect = { left, top: 0, right: left + w, bottom: 1080 };
  return { rect, work: { ...rect, bottom: 1040 }, scale, primary: left === 0 };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const always = () => 0;
const never = () => 0.999;
const ledge = (hwnd: number, frame: Rect): Ledge => ({ hwnd, y: frame.top, left: frame.left, right: frame.right, frame });

const empty: World = { monitors: [monitor(0, 1920)], ledges: [] };
/** Окно слева внизу, над полом, вне центра экрана. */
const NOTE: Rect = { left: 40, top: 500, right: 600, bottom: 900 };
const withNote: World = { ...empty, ledges: [ledge(7, NOTE)], active: 7 };

const at = (w: World, x: number): Pet => ({ ...spawn(w), x });
const puddleOf = (x: number, bottom: number) => ({ left: x - (PUDDLE_W / 2) * CELL, right: x + (PUDDLE_W / 2) * CELL, top: bottom - PUDDLE_H * CELL, bottom });

describe('обида', () => {
  it('только в «Шалостях»', () => {
    expect(holds(provoke(fresh(), 'angry', T0, always, 'calm'), T0)).toBe(false);
    const r = provoke(fresh(), 'angry', T0, always, 'pranks');
    expect(holds(r, T0)).toBe(true);
    expect(holds(r, T0 + GRUDGE_MS - 1)).toBe(true);
    expect(holds(r, T0 + GRUDGE_MS)).toBe(false);
  });

  it('выспавшуюся разбудили — не обижается; злую — чаще, чем вялую', () => {
    expect(CHANCE.wake).toBe(0);
    expect(holds(provoke(fresh(), 'wake', T0, always, 'pranks'), T0)).toBe(false);
    expect(CHANCE.groggy).toBeLessThan(CHANCE.angry);
    expect(CHANCE.angry).toBeLessThan(CHANCE.leave);
  });

  it('не всегда: из тысячи злых побудок обижается примерно в доле CHANCE.angry', () => {
    const rnd = seeded(42);
    let n = 0;
    for (let i = 0; i < 1000; i++) if (holds(provoke(fresh(), 'angry', T0, rnd, 'pranks'), T0)) n++;
    expect(n).toBeGreaterThan(1000 * CHANCE.angry - 80);
    expect(n).toBeLessThan(1000 * CHANCE.angry + 80);
    expect(n).toBeLessThan(1000);
  });

  it('во время перезарядки не обижается, обиду не продлевают', () => {
    const cool = begin(fresh(), T0);
    expect(holds(provoke(cool, 'leave', T0 + COOLDOWN - 1, always, 'pranks'), T0 + COOLDOWN - 1)).toBe(false);
    expect(holds(provoke(cool, 'leave', T0 + COOLDOWN, always, 'pranks'), T0 + COOLDOWN)).toBe(true);
    const r = provoke(fresh(), 'angry', T0, always, 'pranks');
    expect(provoke(r, 'angry', T0 + 60_000, always, 'pranks')).toBe(r);
  });

  it(`долго тыкать: ${PESTER_CLICKS} кликов за ${PESTER_MS / 1000} с — обида, ласка — нет`, () => {
    let r: Revenge = fresh();
    // гладят раз в две секунды — сколько угодно
    for (let i = 0; i < 20; i++) r = poked(r, T0 + i * 2000, always, 'pranks');
    expect(holds(r, T0 + 40_000)).toBe(false);
    // тычут чаще
    r = fresh();
    for (let i = 0; i < PESTER_CLICKS - 1; i++) r = poked(r, T0 + i * 1000, always, 'pranks');
    expect(holds(r, T0 + 5000)).toBe(false);
    r = poked(r, T0 + 5500, always, 'pranks');
    expect(holds(r, T0 + 5500)).toBe(true);
    expect(r.clicks).toEqual([]);
  });

  it('тычки в спокойном режиме и при неудачном броске — без обиды, счёт сначала', () => {
    let r: Revenge = fresh();
    for (let i = 0; i < PESTER_CLICKS; i++) r = poked(r, T0 + i * 500, never, 'pranks');
    expect(holds(r, T0 + 3000)).toBe(false);
    expect(r.clicks).toEqual([]);
    r = fresh();
    for (let i = 0; i < PESTER_CLICKS; i++) r = poked(r, T0 + i * 500, always, 'calm');
    expect(holds(r, T0 + 3000)).toBe(false);
  });
});

describe('перезарядка', () => {
  it(`не чаще раза в ${COOLDOWN / 60_000} минут (не меньше 10)`, () => {
    expect(COOLDOWN).toBeGreaterThanOrEqual(10 * 60_000);
    const r = begin(provoke(fresh(), 'angry', T0, always, 'pranks'), T0);
    expect(holds(r, T0)).toBe(false);
    expect(cooling(r, T0 + COOLDOWN - 1)).toBe(true);
    expect(cooling(r, T0 + COOLDOWN)).toBe(false);
  });

  it('автокликер: тычет без остановки — мстит не чаще перезарядки', () => {
    const gate = { mode: 'pranks', quiet: 'no' };
    let r: Revenge = fresh();
    const starts: number[] = [];
    for (let t = T0; t < T0 + 60 * 60_000; t += 200) {
      r = poked(r, t, always, 'pranks');
      if (ready(r, t, gate, true)) {
        starts.push(t);
        r = begin(r, t);
      }
    }
    expect(starts.length).toBeGreaterThan(1);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(COOLDOWN);
  });

  it('переживает перезапуск: хранится время последней мести', () => {
    const r = load(save(begin(fresh(), T0)), T0 + 1000);
    expect(r.last).toBe(T0);
    expect(cooling(r, T0 + 1000)).toBe(true);
    expect(holds(r, T0 + 1000)).toBe(false);
  });

  it('битое и «из будущего» в хранилище', () => {
    expect(load(null, T0)).toEqual(fresh());
    expect(load('{', T0)).toEqual(fresh());
    expect(load('{"last":"x"}', T0)).toEqual(fresh());
    expect(load('{"last":-5}', T0)).toEqual(fresh());
    expect(load(JSON.stringify({ last: T0 + 1e12 }), T0).last).toBe(T0);
  });
});

describe('запреты', () => {
  const r = provoke(fresh(), 'angry', T0, always, 'pranks');

  it('quiet, созвон, спокойный режим', () => {
    expect(allowed({ mode: 'pranks', quiet: 'no' })).toBe(true);
    expect(allowed({ mode: 'pranks', quiet: 'no', call: false })).toBe(true);
    expect(allowed({ mode: 'pranks', quiet: 'no', call: true })).toBe(false);
    expect(allowed({ mode: 'pranks', quiet: 'game' })).toBe(false);
    expect(allowed({ mode: 'pranks' })).toBe(false);
    expect(allowed({ mode: 'calm', quiet: 'no' })).toBe(false);
  });

  it('ждёт важную программу, но не дольше PATIENCE', () => {
    const gate = { mode: 'pranks', quiet: 'no' };
    expect(ready(r, T0, gate, true)).toBe(true);
    expect(ready(r, T0 + PATIENCE - 1, gate, false)).toBe(false);
    expect(ready(r, T0 + PATIENCE, gate, false)).toBe(true);
    expect(ready(r, T0, { ...gate, call: true }, true)).toBe(false);
    expect(ready(fresh(), T0, gate, true)).toBe(false);
  });

  it('dare из трея: сразу, мимо шанса и перезарядки, но не мимо quiet', () => {
    const d = dare(begin(fresh(), T0), T0 + 1000);
    expect(ready(d, T0 + 1000, { mode: 'pranks', quiet: 'no' }, false)).toBe(true);
    expect(ready(d, T0 + 1000, { mode: 'pranks', quiet: 'fullscreen' }, false)).toBe(false);
  });

  it.each([
    ['KeePassXC', 'secret'],
    ['KeePass Password Safe', 'secret'],
    ['1Password', 'secret'],
    ['Bitwarden', 'secret'],
    ['LastPass', 'secret'],
    ['Dashlane', 'secret'],
    ['Enpass', 'secret'],
    ['Сбербанк Онлайн', 'secret'],
    ['Тинькофф', 'secret'],
    ['Telegram Desktop', 'secret'],
    ['WhatsApp', 'secret'],
    ['Signal', 'secret'],
    ['Viber', 'secret'],
    ['Skype', 'secret'],
    ['Discord', 'secret'],
    ['Microsoft Outlook', 'secret'],
    ['Google Chrome', 'browser'],
    ['Microsoft Edge', 'browser'],
    ['msedge.exe', 'browser'],
    ['Firefox', 'browser'],
    ['Opera Internet Browser', 'browser'],
    ['Yandex', 'browser'],
    ['Brave Browser', 'browser'],
    ['Vivaldi', 'browser'],
    ['Visual Studio Code', 'ok'],
    ['Microsoft Word', 'ok'],
    ['Knowledge Base', 'ok'],
    ['Operator Console', 'ok'],
    ['Блокнот', 'ok'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('%s — %s', (app, kind) => {
    expect(kindOf(app)).toBe(kind);
  });
});

describe('цель', () => {
  it('активное окно обычной программы: лужа в его нижней части, вне центра экрана', () => {
    const a = aim(withNote, at(withNote, 1500), 'Visual Studio Code')!;
    expect(a.target).not.toBeNull();
    expect(a.target!.hwnd).toBe(7);
    const x = NOTE.left + a.target!.dx;
    const bottom = NOTE.bottom + a.target!.dyb;
    const p = puddleOf(x, bottom);
    // целиком внутри окна, в нижней половине
    expect(p.left).toBeGreaterThanOrEqual(NOTE.left);
    expect(p.right).toBeLessThanOrEqual(NOTE.right);
    expect(p.bottom).toBeLessThanOrEqual(NOTE.bottom);
    expect(p.top).toBeGreaterThan((NOTE.top + NOTE.bottom) / 2);
    // кошка идёт на верхнюю кромку этого окна
    expect(a.spot.surface).toBe(`ledge:7:${NOTE.left}`);
  });

  it('окно у самого пола — кошка садится на пол рядом с лужей', () => {
    const low: Rect = { left: 100, top: 600, right: 700, bottom: 1035 };
    const w: World = { ...empty, ledges: [ledge(3, low)], active: 3 };
    const a = aim(w, at(w, 1500), 'Блокнот')!;
    expect(a.target?.hwnd).toBe(3);
    expect(a.spot.surface).toBe('floor:0');
    expect(Math.abs(a.spot.x - (low.left + a.target!.dx))).toBeLessThan(SIDE);
  });

  it('большое окно на весь центр: лужа уезжает к краю, центр не закрыт', () => {
    const big: Rect = { left: 0, top: 200, right: 1920, bottom: 700 };
    const w: World = { ...empty, ledges: [ledge(5, big)], active: 5 };
    const a = aim(w, at(w, 960), 'Visual Studio Code')!;
    expect(a.target).not.toBeNull();
    const p = puddleOf(big.left + a.target!.dx, big.bottom + a.target!.dyb);
    const overlapsCenter = p.left < 1280 && p.right > 640 && p.top < 1040 - 1040 / 3 && p.bottom > 1040 / 3;
    expect(overlapsCenter).toBe(false);
  });

  it('браузер, переписка, пароли, неизвестное — пол рядом с кошкой', () => {
    for (const app of ['Google Chrome', 'Telegram Desktop', 'KeePassXC', null]) {
      const a = aim(withNote, at(withNote, 1500), app)!;
      expect(a.target).toBeNull();
      expect(a.spot.surface).toBe('floor:0');
      expect(Math.abs(a.spot.x - 1500)).toBeLessThan(1);
    }
  });

  it('нет активного окна или оно мелкое — пол', () => {
    expect(aim(empty, at(empty, 800), 'Блокнот')!.target).toBeNull();
    const tiny: Rect = { left: 100, top: 800, right: 100 + PUDDLE_W * CELL, bottom: 900 };
    const w: World = { ...empty, ledges: [ledge(9, tiny)], active: 9 };
    expect(aim(w, at(w, 800), 'Блокнот')!.target).toBeNull();
  });

  it('пол у края экрана: кошка не уходит за край', () => {
    const a = aim(empty, at(empty, 5), null)!;
    expect(a.spot.x).toBeGreaterThanOrEqual(SIDE / 2);
  });
});

describe('лужа', () => {
  const cat = at(empty, 800);

  it(`живёт от ${LIFE_MIN / 1000} до ${LIFE_MAX / 1000} с и высыхает сама`, () => {
    const rnd = seeded(7);
    for (let i = 0; i < 200; i++) {
      const p = spill(empty, cat, null, T0, rnd)!;
      const life = p.dry + DRY_MS - p.born;
      expect(life).toBeGreaterThanOrEqual(LIFE_MIN);
      expect(life).toBeLessThanOrEqual(LIFE_MAX);
      expect(gone(p, p.dry + DRY_MS)).toBe(true);
      expect(view(p, p.dry + DRY_MS)).toBeNull();
    }
  });

  it('кадры: растёт, держится, сохнет, пропадает', () => {
    const p = spill(empty, cat, null, T0, () => 0.5)!;
    expect(p.born).toBe(T0 + SPILL_MS);
    expect(stage(p, T0)).toBeNull();
    const frames: number[] = [];
    for (let t = p.born; t < p.dry + DRY_MS; t += 100) {
      const f = stage(p, t)!;
      if (frames[frames.length - 1] !== f) frames.push(f);
    }
    expect(frames).toEqual([0, 1, 2, 3, 4]);
    expect(frames.every((f) => PUDDLE_FRAMES[f] !== undefined)).toBe(true);
  });

  it('на полу — у лап кошки', () => {
    const p = spill(empty, cat, null, T0, always)!;
    expect(p.x).toBe(cat.x);
    expect(p.hwnd).toBeNull();
    expect(p.bottom - PUDDLE_H * CELL).toBeLessThan(cat.y);
    expect(p.bottom).toBeGreaterThan(cat.y);
  });

  it('на окне — едет за ним; окно закрыли или загородили — сохнет', () => {
    const a = aim(withNote, at(withNote, 1500), 'Блокнот')!;
    const p = spill(withNote, at(withNote, 300), a.target, T0, always)!;
    expect(p.hwnd).toBe(7);
    const moved: Rect = { ...NOTE, left: NOTE.left + 100, right: NOTE.right + 100 };
    const q = follow(p, { ...withNote, ledges: [ledge(7, moved)] }, T0 + 1000);
    expect(q.x).toBe(p.x + 100);
    expect(q.dry).toBe(p.dry);
    // закрыли
    const closed = follow(p, empty, T0 + 2000);
    expect(closed.dry).toBe(T0 + 2000);
    // загородило окно выше по z-order
    const cover = ledge(8, { left: 0, top: 400, right: 900, bottom: 1000 });
    const hidden = follow(p, { ...withNote, ledges: [cover, ledge(7, NOTE)] }, T0 + 3000);
    expect(hidden.dry).toBe(T0 + 3000);
    // а окно ниже — не мешает
    expect(follow(p, { ...withNote, ledges: [ledge(7, NOTE), cover] }, T0 + 3000).dry).toBe(p.dry);
  });

  it('dryUp не продлевает уже сохнущую', () => {
    const p: Puddle = { x: 0, bottom: 0, hwnd: null, dx: 0, dyb: 0, born: T0, dry: T0 + 10 };
    expect(dryUp(p, T0 + 100)).toBe(p);
    expect(dryUp(p, T0 + 5).dry).toBe(T0 + 5);
  });
});

describe('месть целиком', () => {
  function run(w: World, cat: Pet, app: string | null) {
    const s = start(w, cat, app, 0)!;
    let [m, pet] = s;
    const phases = [m.phase];
    const poses = new Set<string>();
    let puddle: Puddle | null = null;
    let squatAt: Pet | null = null;
    let t = 0;
    for (t = FRAME; t < 10 * GIVE_UP && owns(m); t += FRAME) {
      let p: Puddle | null;
      [m, pet, , p] = tick(m, w, pet, t, FRAME, seeded(1));
      if (p) {
        expect(puddle).toBeNull();
        puddle = p;
        squatAt = pet;
      }
      if (m.phase !== phases[phases.length - 1]) phases.push(m.phase);
      const ps = pose(m, pet);
      if (ps) poses.add(ps);
    }
    return { m, pet, phases, poses, puddle, squatAt, t };
  }

  it('на пол: шипит, идёт, присаживается, довольна, уходит', () => {
    const r = run(empty, at(empty, 1500), 'Google Chrome');
    expect(r.phases).toEqual(['hiss', 'go', 'squat', 'smug', 'leave', 'done']);
    expect(r.puddle).not.toBeNull();
    expect(r.puddle!.hwnd).toBeNull();
    expect(Math.abs(r.pet.x - r.squatAt!.x)).toBeGreaterThan(SIDE);
    for (const p of ['angry', 'squat', 'smug', 'strut']) expect(r.poses.has(p)).toBe(true);
  });

  it('на окно: доходит до кромки, лужа на окне', () => {
    const r = run(withNote, at(withNote, 1500), 'Visual Studio Code');
    expect(r.phases).toEqual(['hiss', 'go', 'squat', 'smug', 'leave', 'done']);
    expect(r.puddle!.hwnd).toBe(7);
    expect(r.squatAt!.on).toBe(`ledge:7:${NOTE.left}`);
    expect(r.poses.has('jump')).toBe(true);
  });

  it('уходит, даже если отходить некуда', () => {
    const narrow: World = { monitors: [{ ...monitor(0, 400) }], ledges: [] };
    const r = run(narrow, at(narrow, 200), null);
    expect(r.m.phase).toBe('done');
    expect(r.puddle).not.toBeNull();
  });

  it('месть не дольше полуминуты-минуты', () => {
    const r = run(withNote, at(withNote, 1880), 'Visual Studio Code');
    expect(r.t).toBeLessThan(60_000);
  });

  it('за краем — бросает', () => {
    const s = start(empty, at(empty, 800), null, 0)!;
    const [m, out] = tick(s[0], empty, { ...s[1], move: 'out' }, FRAME, FRAME, always);
    expect(m.phase).toBe('done');
    expect(pose(m as Mission, out)).toBeNull();
  });

  it('поверхности мира не тронуты', () => {
    expect(surfaces(withNote).length).toBe(2);
  });
});
