import { describe, expect, it } from 'vitest';
import {
  arcY,
  atBowl,
  bowlAt,
  BOWL_INSET,
  EDGE_GAP,
  enter,
  goTo,
  jumpMs,
  JUMP_MAX_MS,
  leave,
  type Ledge,
  MAX_DT_MS,
  type Monitor,
  monitorOf,
  onStrip,
  type Move,
  outside,
  type Pet,
  pickSpot,
  type Rect,
  restore,
  type RoamEvent,
  side,
  SIDE,
  spawn,
  spotOf,
  STRIP_DEPTH,
  step,
  surfaces,
  WALK,
  type World,
} from './roam';

const FRAME = 50;

/** Монитор: панель задач снизу высотой `taskbar`. */
function monitor(left: number, top: number, w: number, h: number, scale = 1, taskbar = 40): Monitor {
  const rect = { left, top, right: left + w, bottom: top + h };
  return { rect, work: { ...rect, bottom: rect.bottom - taskbar }, scale, primary: false };
}

/** Кусок кромки окна; рамка по умолчанию — ровно по куску. */
function ledge(hwnd: number, left: number, top: number, right: number, frame?: Rect): Ledge {
  return { hwnd, y: top, left, right, frame: frame ?? { left, top, right, bottom: top + 400 } };
}

/** Мир: первый монитор — основной. */
const world = (monitors: Monitor[], ledges: Ledge[] = []): World => ({
  monitors: monitors.map((m, i) => ({ ...m, primary: i === 0 })),
  ledges,
});

/** Прожить `ms` кадрами по 50 мс: события по порядку и смена режимов движения (без повторов подряд). */
function run(pet: Pet, w: World, ms: number): [Pet, RoamEvent[], Move[]] {
  const events: RoamEvent[] = [];
  const moves: Move[] = [pet.move];
  for (let left = ms; left > 0; left -= FRAME) {
    const [next, e] = step(pet, w, Math.min(FRAME, left));
    pet = next;
    if (e) events.push(e);
    if (moves[moves.length - 1] !== pet.move) moves.push(pet.move);
  }
  return [pet, events, moves];
}

/** Детерминированный rnd: линейный конгруэнтный генератор. */
function lcg(seed: number): () => number {
  let s = Math.imul(seed, 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FHD = monitor(0, 0, 1920, 1080); // пол на 1040
const HALF = SIDE / 2;

/** Стоит на полу монитора i в точке x. */
const standing = (w: World, x: number, i = 0): Pet => ({
  ...spawn(w),
  x,
  y: w.monitors[i].work.bottom,
  on: `floor:${i}`,
});

describe('surfaces', () => {
  it('пол — низ рабочей области каждого монитора', () => {
    const w = world([FHD, monitor(1920, 0, 1280, 1024, 1, 0)]);
    expect(surfaces(w)).toEqual([
      { id: 'floor:0', kind: 'floor', y: 1040, left: 0, right: 1920, monitor: 0 },
      { id: 'floor:1', kind: 'floor', y: 1024, left: 1920, right: 3200, monitor: 1 },
    ]);
  });

  it('карниз обрезается по work монитора', () => {
    const [, l] = surfaces(world([FHD], [ledge(5, -100, 300, 500)]));
    expect(l).toEqual({ id: 'ledge:5:0', kind: 'ledge', y: 300, left: 0, right: 500, monitor: 0, hwnd: 5 });
  });

  it('кромка через два монитора — два карниза', () => {
    const w = world([FHD, monitor(1920, 0, 1920, 1080)], [ledge(6, 1500, 300, 2500)]);
    const ls = surfaces(w).filter((s) => s.kind === 'ledge');
    expect(ls.map((s) => [s.id, s.left, s.right, s.monitor])).toEqual([
      ['ledge:6:1500', 1500, 1920, 0],
      ['ledge:6:1920', 1920, 2500, 1],
    ]);
  });

  it('отбраковка: нет места сверху, почти на полу, короче кошки, вне экрана', () => {
    const ids = (ls: Ledge[]) =>
      surfaces(world([FHD], ls))
        .filter((s) => s.kind === 'ledge')
        .map((s) => s.id);
    expect(ids([ledge(1, 100, SIDE - 1, 600), ledge(2, 100, SIDE, 600)])).toEqual(['ledge:2:100']);
    expect(ids([ledge(1, 100, 1040 - HALF, 600), ledge(2, 100, 1040 - HALF - 1, 600)])).toEqual(['ledge:2:100']);
    expect(ids([ledge(1, 100, 500, 100 + SIDE - 1), ledge(2, 100, 500, 100 + SIDE)])).toEqual(['ledge:2:100']);
    expect(ids([ledge(1, 100, 1100, 600), ledge(2, 2000, 500, 2600)])).toEqual([]);
  });

  it('порог места сверху масштабируется: на 150% нужна 192 px', () => {
    const w = world([monitor(0, 0, 1920, 1080, 1.5)], [ledge(1, 100, 191, 900), ledge(2, 100, 192, 900)]);
    expect(surfaces(w).filter((s) => s.kind === 'ledge').map((s) => s.id)).toEqual(['ledge:2:100']);
  });
});

describe('spawn', () => {
  it('на полу основного монитора у правого края, стоит', () => {
    const p = spawn(world([FHD, monitor(-1920, 0, 1920, 1080)]));
    expect(p).toMatchObject({ x: 1920 - SIDE - EDGE_GAP, y: 1040, on: 'floor:0', move: 'still', goal: null });
    expect(p).toMatchObject({ hwnd: null, exit: 0, jump: null, vy: 0 });
  });

  it('сторона спрайта по scale основного монитора', () => {
    expect(spawn(world([monitor(0, 0, 1920, 1080, 1.5)])).x).toBe(1920 - 1.5 * SIDE - EDGE_GAP);
  });
});

describe('ходьба по полу', () => {
  const w = world([FHD]);

  it('идёт к цели со скоростью WALK, дошла — arrived и стоит', () => {
    const p = goTo(spawn(w), w, { surface: 'floor:0', x: 1576 });
    expect(p.move).toBe('walk');
    const [almost, e1] = run(p, w, 4900);
    expect(e1).toEqual([]);
    expect(almost.x).toBe(1580);
    expect(almost.facing).toBe(-1);
    const [s, e2] = run(almost, w, 100);
    expect(e2).toEqual(['arrived']);
    expect(s).toMatchObject({ x: 1576, move: 'still', goal: null, on: 'floor:0' });
  });

  it('смотрит в сторону шага', () => {
    const [s] = run(goTo(standing(w, 500), w, { surface: 'floor:0', x: 900 }), w, 1000);
    expect(s.facing).toBe(1);
    expect(s.x).toBe(540);
  });

  it('dt обрезан: огромный — как MAX_DT_MS, отрицательный и NaN — ничего', () => {
    const p = goTo(standing(w, 500), w, { surface: 'floor:0', x: 1500 });
    expect(step(p, w, 60_000)[0].x).toBe(500 + (WALK * MAX_DT_MS) / 1000);
    expect(step(p, w, -1000)[0].x).toBe(500);
    expect(step(p, w, Number.NaN)[0].x).toBe(500);
  });

  it('на 150% идёт в 1.5 раза быстрее', () => {
    const big = world([monitor(0, 0, 1920, 1080, 1.5)]);
    const [a] = run(goTo(standing(w, 500), w, { surface: 'floor:0', x: 1500 }), w, 1000);
    const [b] = run(goTo(standing(big, 500), big, { surface: 'floor:0', x: 1500 }), big, 1000);
    expect(a.x - 500).toBe(WALK);
    expect(b.x - 500).toBe(WALK * 1.5);
  });

  it('цель исчезла — бросает её и стоит', () => {
    const w2 = world([FHD], [ledge(7, 600, 600, 1100)]);
    const p = goTo(standing(w2, 1500), w2, { surface: 'ledge:7:600', x: 800 });
    const [s, e] = step(p, w, FRAME);
    expect(e).toBeNull();
    expect(s).toMatchObject({ goal: null, move: 'still' });
  });

  it('goTo на несуществующую поверхность цель не ставит', () => {
    expect(goTo(standing(w, 500), w, { surface: 'ledge:1:1', x: 0 })).toMatchObject({ goal: null, move: 'still' });
  });

  it('не меняет входной объект', () => {
    const p = goTo(standing(w, 500), w, { surface: 'floor:0', x: 1500 });
    const copy = structuredClone(p);
    step(p, w, FRAME);
    leave(p, w);
    pickSpot(w, p, 'rest', lcg(1));
    expect(p).toEqual(copy);
  });
});

describe('карнизы', () => {
  const w = world([FHD], [ledge(7, 600, 600, 1100)]);
  /** Сидит на карнизе окна 7 в x = 800. */
  const perched = (): Pet => {
    const [s] = run(goTo(spawn(w), w, { surface: 'ledge:7:600', x: 800 }), w, 30_000);
    return s;
  };

  it('прыжок на карниз: дошла до точки старта, прыгнула, приземлилась, пришла', () => {
    const [s, events, moves] = run(goTo(spawn(w), w, { surface: 'ledge:7:600', x: 800 }), w, 30_000);
    expect(events).toEqual(['landed', 'arrived']);
    expect(moves).toEqual(['walk', 'jump', 'walk', 'still']);
    expect(s).toMatchObject({ x: 800, y: 600, on: 'ledge:7:600', hwnd: 7, dx: 200, move: 'still' });
  });

  it('дуга прыжка: вершина на side/2 выше верхней точки, длительность по расстоянию', () => {
    let p = goTo(standing(w, 800), w, { surface: 'ledge:7:600', x: 800 });
    [p] = step(p, w, FRAME);
    expect(p.move).toBe('jump');
    expect(p.jump!.ms).toBe(jumpMs(440));
    let top = Infinity;
    while (p.move === 'jump') {
      [p] = step(p, w, 10);
      top = Math.min(top, p.y);
    }
    expect(top).toBeGreaterThanOrEqual(600 - HALF);
    expect(top).toBeLessThan(600 - HALF + 1);
    expect(jumpMs(10_000)).toBe(JUMP_MAX_MS);
  });

  it('arcY: концы на месте, вершина ровно на lift выше', () => {
    expect(arcY(1040, 600, 64, 0)).toBe(1040);
    expect(arcY(1040, 600, 64, 1)).toBeCloseTo(600, 9);
    let top = Infinity;
    for (let i = 0; i <= 10_000; i++) top = Math.min(top, arcY(1040, 600, 64, i / 10_000));
    expect(top).toBeCloseTo(536, 3);
    // Вниз — тоже с подскоком над стартом.
    let top2 = Infinity;
    for (let i = 0; i <= 10_000; i++) top2 = Math.min(top2, arcY(600, 1040, 64, i / 10_000));
    expect(top2).toBeCloseTo(536, 3);
  });

  it('спуск на пол: сходит с ближнего к цели края, падает, приземляется и идёт', () => {
    const [s, events, moves] = run(goTo(perched(), w, { surface: 'floor:0', x: 300 }), w, 20_000);
    expect(events).toEqual(['landed', 'arrived']);
    expect(moves).toEqual(['walk', 'fall', 'walk', 'still']);
    expect(s).toMatchObject({ x: 300, y: 1040, on: 'floor:0', hwnd: null });
  });

  it('окно-насест сдвинули — кошка едет вместе с ним', () => {
    const moved = world([FHD], [ledge(7, 700, 450, 1200)]);
    const [s, e] = step(perched(), moved, FRAME);
    expect(e).toBeNull();
    expect(s).toMatchObject({ x: 900, y: 450, on: 'ledge:7:700', hwnd: 7, dx: 200, move: 'still' });
  });

  it('окно закрыли — fell и приземление на пол', () => {
    const gone = world([FHD]);
    const [f, e] = step(perched(), gone, FRAME);
    expect(e).toBe('fell');
    expect(f).toMatchObject({ move: 'fall', on: null, hwnd: null });
    const [s, events] = run(f, gone, 2000);
    expect(events).toEqual(['landed']);
    expect(s).toMatchObject({ x: 800, y: 1040, on: 'floor:0', move: 'still' });
  });

  it('окно закрыли — приземлилась на нижний карниз под ней', () => {
    const lower = world([FHD], [ledge(8, 500, 800, 1000)]);
    const [s, events] = run(perched(), lower, 2000);
    expect(events).toEqual(['fell', 'landed']);
    expect(s).toMatchObject({ x: 800, y: 800, on: 'ledge:8:500', hwnd: 8, dx: 300 });
  });

  it('другое окно закрыло кромку под лапами — fell', () => {
    const frame = { left: 600, top: 600, right: 1100, bottom: 1000 };
    const covered = world([FHD], [ledge(7, 600, 600, 750, frame), ledge(7, 900, 600, 1100, frame)]);
    expect(step(perched(), covered, FRAME)[1]).toBe('fell');
  });
});

describe('пол и мониторы меняются', () => {
  it('автоскрытие панели задач — y подтягивается к новому низу', () => {
    const p = standing(world([FHD]), 500);
    const [s, e] = step(p, world([monitor(0, 0, 1920, 1080, 1, 2)]), FRAME);
    expect(e).toBeNull();
    expect(s.y).toBe(1078);
  });

  it('монитор отключили — появляется на основном', () => {
    const two = world([FHD, monitor(1920, 0, 1920, 1080)]);
    const one = world([FHD]);
    const [s, e] = step(standing(two, 2600, 1), one, FRAME);
    expect(e).toBeNull();
    expect(s).toEqual(spawn(one));
  });

  it('падение мимо всех поверхностей не проваливается ниже монитора', () => {
    // Панель задач справа: под x в её полосе пола нет.
    const m = { ...FHD, work: { ...FHD.work, right: 1860, bottom: 1080 } };
    const w = world([m]);
    const p: Pet = { ...spawn(w), x: 1900, y: 500, move: 'fall', on: null };
    const [s, events] = run(p, w, 3000);
    expect(events).toEqual(['landed']);
    expect(s).toMatchObject({ on: 'floor:0', y: 1080, x: 1859 });
  });
});

describe('переход между мониторами', () => {
  const left = FHD;

  it('справа пол ниже — дошла до края, шагнула и упала на чужой пол', () => {
    const w = world([left, monitor(1920, 0, 1920, 1200)]);
    const [s, events, moves] = run(goTo(spawn(w), w, { surface: 'floor:1', x: 2500 }), w, 20_000);
    expect(events).toEqual(['landed', 'arrived']);
    expect(moves).toEqual(['walk', 'fall', 'walk', 'still']);
    expect(s).toMatchObject({ x: 2500, y: 1160, on: 'floor:1' });
  });

  it('справа пол выше, но не больше чем на side — запрыгивает', () => {
    const w = world([left, monitor(1920, -50, 1920, 1080)]);
    const [s, events, moves] = run(goTo(spawn(w), w, { surface: 'floor:1', x: 2500 }), w, 20_000);
    expect(events).toEqual(['landed', 'arrived']);
    expect(moves).toEqual(['walk', 'jump', 'walk', 'still']);
    expect(s).toMatchObject({ x: 2500, y: 990, on: 'floor:1' });
  });

  it('обратно налево, пол там выше на 120 — тоже прыжок', () => {
    const w = world([left, monitor(1920, 0, 1920, 1200)]);
    const [s, events, moves] = run(goTo(standing(w, 2500, 1), w, { surface: 'floor:0', x: 1000 }), w, 60_000);
    expect(events).toEqual(['landed', 'arrived']);
    expect(moves).toEqual(['walk', 'jump', 'walk', 'still']);
    expect(s).toMatchObject({ x: 1000, y: 1040, on: 'floor:0' });
  });

  it('пол вровень — шов переходит без прыжков и падений', () => {
    const w = world([left, monitor(1920, 0, 1920, 1080)]);
    const [s, events, moves] = run(goTo(spawn(w), w, { surface: 'floor:1', x: 2500 }), w, 30_000);
    expect(events).toEqual(['arrived']);
    expect(moves).toEqual(['walk', 'still']);
    expect(s).toMatchObject({ x: 2500, y: 1040, on: 'floor:1' });
  });

  it('пол сильно выше или мониторы не соседи — появляется на чужом полу у ближнего края', () => {
    for (const m of [monitor(1920, -300, 1920, 1080), monitor(2500, 0, 1920, 1080)]) {
      const w = world([left, m]);
      const [s, events, moves] = run(goTo(spawn(w), w, { surface: 'floor:1', x: 3000 }), w, 60_000);
      expect(events).toEqual(['arrived']);
      expect(moves).toEqual(['walk', 'still']);
      expect(s).toMatchObject({ x: 3000, y: m.work.bottom, on: 'floor:1' });
    }
  });

  it('с карниза на другой монитор: спуск, пол, переход', () => {
    const w = world([left, monitor(1920, 0, 1920, 1080)], [ledge(7, 600, 600, 1100)]);
    const p: Pet = { ...standing(w, 800), y: 600, on: 'ledge:7:600', hwnd: 7, dx: 200 };
    const [s, events] = run(goTo(p, w, { surface: 'floor:1', x: 2500 }), w, 60_000);
    expect(events).toEqual(['landed', 'arrived']);
    expect(s).toMatchObject({ x: 2500, on: 'floor:1' });
  });
});

describe('уход и возвращение', () => {
  const w = world([FHD]);

  it('leave: к ближнему внешнему краю и за него — gone, дальше out и ничего не делает', () => {
    const p = leave(spawn(w), w);
    expect(p).toMatchObject({ exit: 1, move: 'walk', goal: null });
    const [out, events] = run(p, w, 10_000);
    expect(events).toEqual(['gone']);
    expect(out).toMatchObject({ move: 'out', on: null, x: 1920 + HALF, exit: 1 });
    const [same, rest] = run(out, w, 10_000);
    expect(rest).toEqual([]);
    expect(same).toEqual(out);
    expect(goTo(out, w, { surface: 'floor:0', x: 100 })).toBe(out);
  });

  it('enter: выходит из-за того же края; back — когда целиком на экране, потом arrived у края', () => {
    const [out] = run(leave(spawn(w), w), w, 10_000);
    const p = enter(out, w);
    expect(p).toMatchObject({ move: 'walk', x: 1920 + HALF, y: 1040, on: 'floor:0', facing: -1, exit: 0 });
    expect(p.goal).toEqual({ surface: 'floor:0', x: 1920 - HALF - EDGE_GAP });
    const [peek, e0] = run(p, w, 3150);
    expect(e0).toEqual([]);
    const [inside, e1] = step(peek, w, FRAME);
    expect(e1).toBe('back');
    expect(inside.x + HALF).toBe(1920);
    const [s, e2] = run(inside, w, 2000);
    expect(e2).toEqual(['arrived']);
    expect(s).toMatchObject({ x: 1920 - HALF - EDGE_GAP, move: 'still', on: 'floor:0' });
  });

  it('с карниза: спрыгивает и уходит за ближний к ней край', () => {
    const w2 = world([FHD], [ledge(7, 600, 600, 1100)]);
    const p: Pet = { ...standing(w2, 800), y: 600, on: 'ledge:7:600', hwnd: 7, dx: 200 };
    const [s, events] = run(leave(p, w2), w2, 30_000);
    expect(events).toEqual(['landed', 'gone']);
    expect(s).toMatchObject({ move: 'out', x: -HALF, exit: -1 });
    expect(enter(s, w2)).toMatchObject({ x: -HALF, facing: 1, goal: { surface: 'floor:0', x: HALF + EDGE_GAP } });
  });

  it('край со стороны соседа не внешний: уходит в другую сторону', () => {
    const two = world([FHD, monitor(1920, 0, 1920, 1080)]);
    expect(leave(spawn(two), two).exit).toBe(-1);
  });

  it('внешних краёв у монитора нет — идёт к правому краю самого правого и уходит там', () => {
    const three = world([FHD, monitor(-1920, 0, 1920, 1080), monitor(1920, 0, 1920, 1080)]);
    const p = leave(spawn(three), three);
    expect(p.exit).toBe(1);
    expect(p.goal).toEqual({ surface: 'floor:2', x: 3840 - HALF - EDGE_GAP });
    const [s, events] = run(p, three, 60_000);
    expect(events).toEqual(['gone']);
    expect(s).toMatchObject({ move: 'out', x: 3840 + HALF });
  });

  it('outside: сразу за внешним краем основного, и enter выводит её оттуда', () => {
    const p = outside(w);
    expect(p).toMatchObject({ move: 'out', on: null, x: 1920 + HALF, y: 1040, exit: 1 });
    expect(step(p, w, FRAME)).toEqual([p, null]);
    expect(enter(p, w)).toMatchObject({ x: 1920 + HALF, facing: -1, goal: { surface: 'floor:0', x: 1920 - HALF - EDGE_GAP } });
  });

  it('outside: справа сосед — за левым краем', () => {
    const two = world([FHD, monitor(1920, 0, 1920, 1080)]);
    expect(outside(two)).toMatchObject({ x: -HALF, exit: -1, facing: -1 });
  });

  it('outside: у основного внешних краёв нет — за правым краем самого правого, на его полу', () => {
    const three = world([FHD, monitor(-1920, 0, 1920, 1080), monitor(1920, 0, 1920, 1200, 1, 60)]);
    const p = outside(three);
    expect(p).toMatchObject({ x: 3840 + HALF, y: 1140, exit: 1 });
    expect(monitorOf(three, p)).toBe(three.monitors[2]);
  });

  it('restore: на ту же кромку, иначе на пол того монитора, не вплотную к краю', () => {
    const ww = world([FHD, monitor(1920, 0, 1920, 1080)], [ledge(7, 100, 300, 900)]);
    expect(restore(ww, { x: 300, y: 300, exit: 0 }, false)).toMatchObject({ x: 300, y: 300, on: 'ledge:7:100', hwnd: 7, move: 'still' });
    // окно закрыли — на полу под тем же местом
    expect(restore(world([FHD]), { x: 300, y: 300, exit: 0 }, false)).toMatchObject({ x: 300, y: 1040, on: 'floor:0' });
    // была на втором мониторе
    expect(restore(ww, { x: 3000, y: 1040, exit: 0 }, false)).toMatchObject({ x: 3000, y: 1040, on: 'floor:1' });
    // за левым краем — на пол у края, не за ним
    expect(restore(ww, { x: -HALF, y: 1040, exit: -1 }, false)).toMatchObject({ x: HALF + EDGE_GAP, y: 1040, on: 'floor:0' });
  });

  it('restore в отлучке: за ближний к прежнему месту внешний край, а не вправо', () => {
    const ww = world([FHD, monitor(1920, -240, 1920, 1080)], [ledge(7, 100, 300, 900)]);
    expect(restore(ww, { x: 300, y: 300, exit: 0 }, true)).toMatchObject({ x: -HALF, y: 1040, move: 'out', exit: -1 });
    expect(restore(ww, { x: 3800, y: 800, exit: 0 }, true)).toMatchObject({ x: 3840 + HALF, y: 800, move: 'out', exit: 1 });
  });

  it('restore без места или когда монитора больше нет — как первый запуск', () => {
    expect(restore(w, null, false)).toEqual(spawn(w));
    expect(restore(w, null, true)).toEqual(outside(w));
    expect(restore(w, { x: 9000, y: 1040, exit: 0 }, false)).toEqual(spawn(w));
  });

  it('spotOf: целые пиксели и сторона ухода', () => {
    expect(spotOf({ ...spawn(w), x: 10.6, y: 1040.2, exit: -1 })).toEqual({ x: 11, y: 1040, exit: -1 });
  });

  it('outside и monitorOf без мониторов: кошка нигде', () => {
    const none = world([]);
    expect(outside(none)).toEqual(spawn(none));
    expect(monitorOf(none, spawn(none))).toBeNull();
  });

  it('monitorOf: монитор под кошкой, а у ушедшей — тот, за чьим краем она сидит', () => {
    const two = world([FHD, monitor(1920, 0, 1920, 1080, 1.5)]);
    expect(monitorOf(two, standing(two, 2500, 1))).toBe(two.monitors[1]);
    const [out] = run(leave(spawn(w), w), w, 10_000);
    expect(monitorOf(w, out)).toBe(w.monitors[0]);
  });

  it('пока за краем монитор отключили — появляется на основном', () => {
    const two = world([FHD, monitor(1920, 0, 1920, 1080)]);
    const out: Pet = { ...standing(two, 1920 + 1920 + HALF, 1), move: 'out', on: null, exit: 1 };
    expect(step(out, world([FHD]), FRAME)[0]).toEqual(spawn(world([FHD])));
  });
});

describe('pickSpot', () => {
  const center = (x: number, m: Monitor) => {
    const w = m.work.right - m.work.left;
    return x > m.work.left + 0.3 * w && x < m.work.left + 0.7 * w;
  };

  it('rest без карнизов: всегда пол у края, никогда не центр', () => {
    for (const m of [FHD, monitor(0, 0, 1280, 720), monitor(0, 0, 3840, 2160, 1.5)]) {
      const w = world([m]);
      const width = m.work.right - m.work.left;
      for (let seed = 1; seed <= 1000; seed++) {
        const g = pickSpot(w, spawn(w), 'rest', lcg(seed));
        expect(g.surface).toBe('floor:0');
        expect(center(g.x, m)).toBe(false);
        const d = Math.min(g.x - m.work.left, m.work.right - g.x);
        expect(d).toBeGreaterThanOrEqual(side(m) / 2 + EDGE_GAP);
        expect(d).toBeLessThanOrEqual(0.2 * width);
      }
    }
  });

  it('rest: чаще пол, иногда карниз текущего монитора у его конца', () => {
    const w = world([FHD], [ledge(7, 600, 600, 1100)]);
    let onLedge = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const g = pickSpot(w, spawn(w), 'rest', lcg(seed));
      if (g.surface === 'floor:0') {
        expect(center(g.x, FHD)).toBe(false);
        continue;
      }
      onLedge++;
      expect(g.surface).toBe('ledge:7:600');
      const d = Math.min(g.x - 600, 1100 - g.x);
      expect(d).toBeGreaterThanOrEqual(HALF + EDGE_GAP);
      expect(d).toBeLessThanOrEqual(0.25 * 500);
    }
    expect(onLedge).toBeGreaterThan(200);
    expect(onLedge).toBeLessThan(400);
  });

  it('sleep: всегда карниз, широкие вероятнее; узкий — середина', () => {
    const w = world([FHD], [ledge(1, 100, 300, 300), ledge(2, 700, 500, 1700)]);
    let wide = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const g = pickSpot(w, spawn(w), 'sleep', lcg(seed));
      expect(g.surface).toMatch(/^ledge:/);
      if (g.surface === 'ledge:2:700') wide++;
      else expect(g.x).toBe(200);
    }
    expect(wide).toBeGreaterThan(750);
  });

  it('sleep: карниз текущего монитора важнее, нет своих — чужой, нет никаких — пол у края', () => {
    const second = monitor(1920, 0, 1920, 1080);
    const both = world([FHD, second], [ledge(1, 2200, 400, 2800), ledge(2, 300, 400, 800)]);
    const only = world([FHD, second], [ledge(1, 2200, 400, 2800)]);
    const none = world([FHD, second]);
    for (let seed = 1; seed <= 200; seed++) {
      expect(pickSpot(both, spawn(both), 'sleep', lcg(seed)).surface).toBe('ledge:2:300');
      expect(pickSpot(only, spawn(only), 'sleep', lcg(seed)).surface).toBe('ledge:1:2200');
      const g = pickSpot(none, spawn(none), 'sleep', lcg(seed));
      expect(g.surface).toBe('floor:0');
      expect(center(g.x, FHD)).toBe(false);
    }
  });

  it('rnd вне [0, 1) не ломает выбор', () => {
    const w = world([FHD]);
    for (const r of [0, 1, 5, -1, Number.NaN]) {
      const g = pickSpot(w, spawn(w), 'rest', () => r);
      expect(center(g.x, FHD)).toBe(false);
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x).toBeLessThanOrEqual(1920);
    }
  });
});

describe('окно человека и полоса заголовка', () => {
  /** Развёрнутое окно на FHD, кнопки заголовка с 1782. */
  const MAXED: Ledge = ledge(9, 0, 0, 1782, { left: 0, top: 0, right: 1920, bottom: 1040 });

  it('полоса: кусок у кнопок шириной side + 2·EDGE_GAP, лапы на STRIP_DEPTH ниже кромки', () => {
    const w: World = { ...world([FHD]), strips: [MAXED] };
    expect(surfaces(w).find((s) => s.strip)).toEqual({
      id: 'strip:9',
      kind: 'ledge',
      y: STRIP_DEPTH,
      left: 1782 - SIDE - 2 * EDGE_GAP,
      right: 1782,
      monitor: 0,
      hwnd: 9,
      strip: true,
    });
    const hi: World = { ...world([monitor(0, 0, 3840, 2160, 1.5)]), strips: [{ ...MAXED, right: 3700 }] };
    const s = surfaces(hi).find((c) => c.strip)!;
    expect([s.y, s.right - s.left]).toEqual([STRIP_DEPTH * 1.5, SIDE * 1.5 + 2 * EDGE_GAP]);
  });

  it('полоса уже кошки или вне экрана — её нет', () => {
    const narrow: World = { ...world([FHD]), strips: [ledge(9, 0, 0, SIDE + 2 * EDGE_GAP - 1)] };
    expect(surfaces(narrow).some((s) => s.strip)).toBe(false);
    const off: World = { ...world([FHD]), strips: [ledge(9, 0, 2000, 1782)] };
    expect(surfaces(off).some((s) => s.strip)).toBe(false);
  });

  it('спать — на рамке окна человека, даже если есть другие', () => {
    const w: World = { ...world([FHD], [ledge(7, 100, 300, 700), ledge(8, 900, 500, 1500)]), active: 8, strips: [MAXED] };
    for (let seed = 1; seed <= 300; seed++) expect(pickSpot(w, spawn(w), 'sleep', lcg(seed)).surface).toBe('ledge:8:900');
  });

  it('спать на полосе — только когда рамок нет совсем', () => {
    const bare: World = { ...world([FHD]), active: 9, strips: [MAXED] };
    const framed: World = { ...world([FHD], [ledge(7, 100, 300, 700)]), active: 9, strips: [MAXED] };
    for (let seed = 1; seed <= 300; seed++) {
      expect(pickSpot(bare, spawn(bare), 'sleep', lcg(seed)).surface).toBe('strip:9');
      expect(pickSpot(framed, spawn(framed), 'sleep', lcg(seed)).surface).toBe('ledge:7:100');
    }
    // из двух полос — полоса окна, где работает человек
    const two: World = { ...world([FHD, monitor(1920, 0, 1920, 1080)]), active: 5, strips: [MAXED, ledge(5, 1920, 0, 3700)] };
    for (let seed = 1; seed <= 100; seed++) expect(pickSpot(two, spawn(two), 'sleep', lcg(seed)).surface).toBe('strip:5');
  });

  it('отдых: на полосу никогда, на окно человека — примерно в половине случаев', () => {
    const w: World = { ...world([FHD], [ledge(7, 100, 300, 700), ledge(8, 900, 500, 1500)]), active: 8, strips: [MAXED] };
    let onActive = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const g = pickSpot(w, spawn(w), 'rest', lcg(seed));
      expect(g.surface).not.toBe('strip:9');
      if (g.surface === 'ledge:8:900') onActive++;
    }
    expect(onActive).toBeGreaterThan(450);
    expect(onActive).toBeLessThan(750);
  });

  it('с пола запрыгивает на полосу и лежит на ней', () => {
    const w: World = { ...world([FHD]), active: 9, strips: [MAXED] };
    const goal = pickSpot(w, spawn(w), 'sleep', lcg(1));
    const [p, events] = run(goTo(spawn(w), w, goal), w, 20_000);
    expect(events).toContain('arrived');
    expect(p).toMatchObject({ on: 'strip:9', y: STRIP_DEPTH, move: 'still' });
    expect(onStrip(p)).toBe(true);
    expect(onStrip(spawn(w))).toBe(false);
    // окно свернули — полоса пропала, кошка падает на пол, а не перескакивает туда
    const gone: World = { ...w, strips: [] };
    const [q, after, moves] = run(p, gone, 5_000);
    expect(after[0]).toBe('fell');
    expect(moves).toContain('fall');
    expect(q).toMatchObject({ on: 'floor:0', y: 1040 });
  });
});

describe('миска', () => {
  it('на полу основного монитора у правого угла, с отступом на наклон кошки', () => {
    const w = world([monitor(-1920, 0, 1920, 1080), monitor(0, 0, 2560, 1440, 1.5)]);
    w.monitors[0].primary = false;
    w.monitors[1].primary = true;
    const b = bowlAt(w)!;
    expect(b.surface).toBe('floor:1');
    expect(b.x).toBe(2560 - SIDE * 1.5 * (0.5 + BOWL_INSET) - EDGE_GAP);
  });

  it('без мониторов миски нет', () => {
    expect(bowlAt(world([]))).toBeNull();
  });

  it('дошла до миски — стоит у миски; по дороге — ещё нет', () => {
    const w = world([monitor(0, 0, 1920, 1080)]);
    let pet = goTo(spawn(w), w, { surface: 'floor:0', x: 200 });
    [pet] = run(pet, w, 60_000);
    expect(atBowl(pet, w)).toBe(false);
    pet = goTo(pet, w, bowlAt(w)!);
    expect(atBowl(pet, w)).toBe(false);
    [pet] = run(pet, w, 60_000);
    expect(atBowl(pet, w)).toBe(true);
  });
});
