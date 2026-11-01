// Маршрут кошки по рабочему столу: где стоит, куда идёт, прыжки и падения.
// Мир приходит от Rust: мониторы и открытые куски верхних кромок окон. Кошка ходит по полу
// (низ рабочей области монитора) и по рамкам окон, запрыгивает наверх, спрыгивает вниз,
// едет вместе с окном-насестом и падает, если окно убрали из-под лап.
// Всё в физических пикселях рабочего стола, y вниз; логические константы умножаются на scale монитора.
// Чистые функции: без DOM, без часов, случайность — параметром. Приложение зовёт `step` на каждом кадре,
// разница времени обрезается до [0, MAX_DT_MS] — после сна ПК кошка не телепортируется.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** work — без панели задач, scale = DPI/96. */
export interface Monitor {
  rect: Rect;
  work: Rect;
  scale: number;
  primary: boolean;
}
/** Открытый (не закрытый окнами выше) кусок верхней кромки окна; у окна может быть несколько кусков. */
export interface Ledge {
  hwnd: number;
  y: number;
  left: number;
  right: number;
  frame: Rect;
}
/** Основной монитор первым. */
export interface World {
  monitors: Monitor[];
  ledges: Ledge[];
  /** Окно, в котором работает человек; null — рабочий стол, панель задач или ничего. */
  active?: number | null;
  /** Полосы заголовков развёрнутых окон левее кнопок «свернуть/закрыть»: только поспать. */
  strips?: Ledge[];
}

/** Сторона спрайта в логических px: 32 клетки × 4. */
export const SIDE = 128;
/** Скорость шага, логич. px/с. */
export const WALK = 40;
/** Ускорение падения, логич. px/с². */
export const GRAVITY = 2400;
/** Предел скорости падения, логич. px/с. */
export const MAX_FALL = 1600;
/** Отступ от края рамки или экрана: вплотную не садится. */
export const EDGE_GAP = 16;
/** Прыжок: база длительности, мс... */
export const JUMP_MS = 500;
/** ...плюс столько мс на логический px расстояния... */
export const JUMP_MS_PER_PX = 0.4;
/** ...но не дольше. */
export const JUMP_MAX_MS = 1100;
/** Больше за кадр не засчитывается: сон ПК, подвисание. */
export const MAX_DT_MS = 200;
/** Рост спящей кошки от ушей до лап, логич. px (ряды 17..27 по 4): на полосе заголовка уши у самой кромки. */
export const STRIP_DEPTH = 44;
/** Разница уровней полов соседних мониторов, которую переходит, не замечая. */
const SEAM = 1;

export interface Surface {
  id: string;
  kind: 'floor' | 'ledge';
  y: number;
  left: number;
  right: number;
  monitor: number;
  hwnd?: number;
  /** Полоса заголовка развёрнутого окна: туда только спать. */
  strip?: true;
}

/** out — целиком за внешним краем экрана, не видна. */
export type Move = 'still' | 'walk' | 'jump' | 'fall' | 'out';
/** Куда идти: id поверхности и x лап. */
export interface Goal {
  surface: string;
  x: number;
}
export interface Jump {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Мс с начала прыжка. */
  t: number;
  /** Длительность прыжка, мс. */
  ms: number;
  /** id поверхности приземления. */
  to: string;
}
/** Точка лап: x — середина спрайта, y — линия, на которой стоят лапы (низ окна питомца). */
export interface Pet {
  x: number;
  y: number;
  move: Move;
  /** 1 — вправо (все спрайты нарисованы вправо). */
  facing: 1 | -1;
  /** id поверхности под лапами; null — в воздухе или за краем. */
  on: string | null;
  /** Окно-насест, если стоит на карнизе. */
  hwnd: number | null;
  /** x − frame.left окна-насеста: окно двигают — кошка едет вместе с ним. */
  dx: number;
  goal: Goal | null;
  /** Уходит за внешний край в эту сторону; у ушедшей ('out') — сторона, за которой она сидит. */
  exit: 1 | -1 | 0;
  jump: Jump | null;
  /** Скорость падения, физ. px/с. */
  vy: number;
}
/**
 * arrived — дошла до цели; landed — приземлилась после прыжка или падения; fell — невольно сорвалась
 * (насест пропал из-под лап, цель прыжка исчезла); gone — скрылась за краем; back — вернулась из-за края
 * целиком на экран (раньше, чем дойдёт до цели — потом отдельно придёт 'arrived').
 */
export type RoamEvent = 'arrived' | 'landed' | 'fell' | 'gone' | 'back';

/** Сторона спрайта на мониторе, физ. px. */
export const side = (m: Monitor): number => SIDE * m.scale;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
/** Зажать в [lo, hi]; если отрезок вывернут (места нет) — его середина. */
const fit = (v: number, lo: number, hi: number): number => (lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2);
const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.left && x < r.right && y >= r.top && y < r.bottom;
/** Под лапами ли поверхность: right исключителен, как у Rect. */
const covers = (s: Surface, x: number): boolean => x >= s.left && x < s.right;
/** Ближайшая к x точка поверхности. */
const onto = (s: Surface, x: number): number => clamp(x, s.left, s.right - 1);
const floorId = (i: number): string => `floor:${i}`;

/** Пол и карнизы. Пол — по одному на монитор, первыми; карниз режется по work каждого монитора. */
export function surfaces(world: World): Surface[] {
  const out: Surface[] = world.monitors.map((m, i) => ({
    id: floorId(i),
    kind: 'floor',
    y: m.work.bottom,
    left: m.work.left,
    right: m.work.right,
    monitor: i,
  }));
  for (const l of world.ledges) {
    world.monitors.forEach((m, i) => {
      const w = m.work;
      if (l.y < w.top || l.y >= w.bottom) return;
      const left = Math.max(l.left, w.left);
      const right = Math.min(l.right, w.right);
      const s = side(m);
      // Над кромкой нет места, кромка почти на полу или кошке негде встать.
      if (l.y - s < w.top || l.y >= w.bottom - s / 2 || right - left < s) return;
      out.push({ id: `ledge:${l.hwnd}:${left}`, kind: 'ledge', y: l.y, left, right, monitor: i, hwnd: l.hwnd });
    });
  }
  // Полоса — не кромка: кошка лежит поверх заголовка, места сверху не нужно. Только у правого
  // конца, поближе к кнопкам: на вкладках и меню слева она мешала бы.
  for (const l of world.strips ?? []) {
    world.monitors.forEach((m, i) => {
      const w = m.work;
      if (l.y < w.top || l.y >= w.bottom) return;
      const right = Math.min(l.right, w.right);
      const left = Math.max(l.left, w.left, right - side(m) - 2 * EDGE_GAP);
      if (right - left < side(m) + 2 * EDGE_GAP) return;
      const y = l.y + STRIP_DEPTH * m.scale;
      out.push({ id: `strip:${l.hwnd}`, kind: 'ledge', y, left, right, monitor: i, hwnd: l.hwnd, strip: true });
    });
  }
  return out;
}

/**
 * Монитор точки лап: тот, в чей rect попадает (x, y − 1). Уходящая или ушедшая за внешний край
 * стоит вне всех rect — тогда ближайший по горизонтали монитор не дальше стороны спрайта.
 * −1 — потерялась.
 */
function monitorAt(world: World, x: number, y: number): number {
  const p = y - 1;
  const i = world.monitors.findIndex((m) => inRect(m.rect, x, p));
  if (i >= 0) return i;
  let best = -1;
  let bestD = Infinity;
  world.monitors.forEach((m, k) => {
    if (p < m.rect.top || p >= m.rect.bottom) return;
    const d = x < m.rect.left ? m.rect.left - x : x - m.rect.right + 1;
    if (d <= side(m) && d < bestD) [best, bestD] = [k, d];
  });
  return best;
}

/** Соседний монитор в сторону dir: rect'ы касаются вертикальной кромкой и пересекаются по y. −1 — нет. */
function neighbor(world: World, i: number, dir: 1 | -1): number {
  const r = world.monitors[i].rect;
  return world.monitors.findIndex(
    (m, k) =>
      k !== i &&
      (dir > 0 ? m.rect.left === r.right : m.rect.right === r.left) &&
      m.rect.top < r.bottom &&
      r.top < m.rect.bottom,
  );
}

const floorOf = (all: Surface[], i: number): Surface => all.find((s) => s.id === floorId(i))!;

/** Окно-насест: frame.left для dx. */
const frameLeft = (world: World, hwnd: number): number | null =>
  world.ledges.find((l) => l.hwnd === hwnd)?.frame.left ?? null;

/** Встать на поверхность: y, on, насест и dx. */
function standOn(pet: Pet, world: World, s: Surface, x: number): Pet {
  const fl = s.hwnd === undefined ? null : frameLeft(world, s.hwnd);
  return {
    ...pet,
    x,
    y: s.y,
    on: s.id,
    hwnd: fl === null ? null : s.hwnd!,
    dx: fl === null ? 0 : x - fl,
    jump: null,
    vy: 0,
  };
}

/** Есть куда идти — идёт, нет — стоит. */
const restMove = (pet: Pet): Move => (pet.goal || pet.exit !== 0 ? 'walk' : 'still');

/** Сорвалась или сошла с края: дальше падает из (x, y). */
const drop = (pet: Pet, x: number, y: number): Pet => ({
  ...pet,
  x,
  y,
  move: 'fall',
  on: null,
  hwnd: null,
  dx: 0,
  jump: null,
  vy: 0,
});

/** Появиться на полу основного монитора у правого края. */
export function spawn(world: World): Pet {
  const base: Pet = {
    x: 0,
    y: 0,
    move: 'still',
    facing: -1,
    on: null,
    hwnd: null,
    dx: 0,
    goal: null,
    exit: 0,
    jump: null,
    vy: 0,
  };
  const m = world.monitors[0];
  if (!m) return base;
  return { ...base, x: m.work.right - side(m) - EDGE_GAP, y: m.work.bottom, on: floorId(0) };
}

/** Монитор, на котором кошка (или за чьим краем сидит); null — потерялась. */
export function monitorOf(world: World, pet: Pet): Monitor | null {
  return world.monitors[monitorAt(world, pet.x, pet.y)] ?? null;
}

/**
 * Сразу за краем, не видна: программу запустили, пока кошка в отлучке или в обиде. Край — тот,
 * за который она ушла бы сама из `from` (по умолчанию — с места появления); `enter` вернёт её оттуда.
 */
export function outside(world: World, from?: Pet): Pet {
  const pet = from ?? spawn(world);
  if (!world.monitors[0]) return pet;
  // у основного нет внешнего края — leave повёл бы её по полу к другому монитору, за его край
  const left = leave(pet, world);
  const target = left.goal && surfaces(world).find((s) => s.id === left.goal?.surface);
  const m = world.monitors[target ? target.monitor : Math.max(0, monitorAt(world, pet.x, pet.y))];
  const dir = left.exit || 1;
  const half = side(m) / 2;
  const x = dir > 0 ? m.work.right + half : m.work.left - half;
  return { ...pet, x, y: m.work.bottom, move: 'out', on: null, exit: dir, facing: dir };
}

/** Лежит на полосе заголовка развёрнутого окна. */
export const onStrip = (pet: Pet): boolean => pet.on?.startsWith('strip:') ?? false;

/** Где кошка была: линия лап и сторона ухода. Хранится между запусками. */
export type Spot = { x: number; y: number; exit: 1 | -1 | 0 };

export const spotOf = (pet: Pet): Spot => ({ x: Math.round(pet.x), y: Math.round(pet.y), exit: pet.exit });

/**
 * Вернуть кошку туда, где её оставили: на ту же кромку, если она ещё есть, иначе на пол того
 * монитора, не ближе side/2 + EDGE_GAP к краю. В отлучке — за ближний внешний край оттуда же.
 * Без места или если монитора больше нет — как при первом запуске.
 */
export function restore(world: World, spot: Spot | null, away: boolean): Pet {
  const fresh = spawn(world);
  const i = spot ? monitorAt(world, spot.x, spot.y) : -1;
  if (!spot || i < 0) return away ? outside(world) : fresh;
  const all = surfaces(world);
  const s = all.find((c) => Math.abs(c.y - spot.y) <= 1 && covers(c, spot.x));
  const f = floorOf(all, i);
  const h = side(world.monitors[i]) / 2 + EDGE_GAP;
  const pet = s ? standOn(fresh, world, s, spot.x) : standOn(fresh, world, f, fit(spot.x, f.left + h, f.right - h));
  return away ? outside(world, { ...pet, x: fit(spot.x, f.left + h, f.right - h), y: f.y, on: f.id, hwnd: null, dx: 0 }) : pet;
}

/**
 * Опора под стоящей или идущей кошкой в новом мире. На карнизе — следует за окном (x = frame.left + dx);
 * карниза под ней больше нет — падает с 'fell'. На полу — y подтягивается к work.bottom.
 * Возвращает [кошка, опора, событие]; опора null — шаг на этом закончен (упала или появилась заново).
 */
function ground(pet: Pet, world: World, all: Surface[]): [Pet, Surface | null, RoamEvent | null] {
  if (pet.hwnd !== null) {
    const fl = frameLeft(world, pet.hwnd);
    if (fl === null) return [drop(pet, pet.x, pet.y), null, 'fell'];
    const x = fl + pet.dx;
    const under = all.filter((s) => s.hwnd === pet.hwnd && covers(s, x));
    const s = under.find((u) => u.id === pet.on) ?? under[0];
    if (!s) return [drop(pet, x, pet.y), null, 'fell'];
    return [{ ...pet, x, y: s.y, on: s.id }, s, null];
  }
  if (pet.on === null) return [drop(pet, pet.x, pet.y), null, null];
  // Полоса заголовка не возит (развёрнутое окно не двигают), но может пропасть: окно свернули
  // или закрыли другим — тогда падает, а не оказывается на полу.
  if (pet.on.startsWith('strip:')) {
    const s = all.find((c) => c.id === pet.on);
    if (!s || !covers(s, pet.x)) return [drop(pet, pet.x, pet.y), null, 'fell'];
    return [{ ...pet, y: s.y }, s, null];
  }
  const i = monitorAt(world, pet.x, pet.y);
  if (i < 0) return [spawn(world), null, null];
  const f = floorOf(all, i);
  const x = pet.move === 'still' ? onto(f, pet.x) : pet.x;
  return [{ ...pet, x, y: f.y, on: f.id }, f, null];
}

/** Длительность прыжка по расстоянию в логических px. */
export const jumpMs = (dist: number): number => Math.min(JUMP_MS + JUMP_MS_PER_PX * dist, JUMP_MAX_MS);

/** Начать прыжок с места кошки на поверхность `to` в точку x1. */
function leap(pet: Pet, world: World, to: Surface, x1: number): Pet {
  const i = monitorAt(world, pet.x, pet.y);
  const scale = world.monitors[i >= 0 ? i : to.monitor].scale;
  const ms = jumpMs(Math.hypot(x1 - pet.x, to.y - pet.y) / scale);
  const facing = x1 === pet.x ? pet.facing : x1 > pet.x ? 1 : -1;
  return {
    ...pet,
    move: 'jump',
    facing,
    on: null,
    hwnd: null,
    dx: 0,
    vy: 0,
    jump: { x0: pet.x, y0: pet.y, x1, y1: to.y, t: 0, ms, to: to.id },
  };
}

/** Точка приземления на цели: ближайшая к x и не ближе EDGE_GAP к краю. */
const landX = (world: World, t: Surface, x: number): number => {
  const h = side(world.monitors[t.monitor]) / 2 + EDGE_GAP;
  return fit(x, t.left + h, t.right - h);
};

/**
 * Высота дуги в момент u ∈ [0, 1]: парабола через (0, y0) и (1, y1) с вершиной на `lift` выше
 * более высокой из точек. Вершина в u* = √p / (√p + √q), где p, q — глубины концов под вершиной.
 */
export function arcY(y0: number, y1: number, lift: number, u: number): number {
  const top = Math.min(y0, y1) - lift;
  const sp = Math.sqrt(y0 - top);
  const sq = Math.sqrt(y1 - top);
  return y0 - 2 * sp * (sp + sq) * u + (sp + sq) ** 2 * u * u;
}

/** Шаг к точке px по своей поверхности. [кошка, дошла]. */
function walkTo(pet: Pet, px: number, v: number): [Pet, boolean] {
  const d = px - pet.x;
  if (Math.abs(d) <= v) return [{ ...pet, x: px }, true];
  const dir = d > 0 ? 1 : -1;
  return [{ ...pet, x: pet.x + dir * v, facing: dir }, false];
}

/** Шагнуть в сторону dir и сойти с края поверхности c: x вышел за [left, right] — падает. */
function stepOff(pet: Pet, c: Surface, dir: 1 | -1, v: number): Pet {
  const x = pet.x + dir * v;
  const moved: Pet = { ...pet, x, facing: dir };
  return covers(c, x) ? moved : drop(moved, x, pet.y);
}

/** На другой монитор: с карниза — вниз, по полу — к общему краю и через него. */
function crossTo(pet: Pet, world: World, all: Surface[], c: Surface, mt: number, v: number): Pet {
  const ms = c.monitor;
  const a = world.monitors[ms].rect;
  const b = world.monitors[mt].rect;
  const dir: 1 | -1 = b.left + b.right >= a.left + a.right ? 1 : -1;
  if (c.kind === 'ledge') return stepOff(pet, c, dir, v);

  // Появиться на полу f у ближнего края и идти дальше — чтобы не застревать там, где не дойти.
  const appear = (p: Pet, f: Surface): Pet => {
    const h = side(world.monitors[f.monitor]) / 2 + EDGE_GAP;
    return { ...standOn(p, world, f, dir > 0 ? f.left + h : f.right - h), move: 'walk', facing: dir };
  };
  const n = neighbor(world, ms, dir);
  if (n < 0) return appear(pet, floorOf(all, mt));
  const nf = floorOf(all, n);
  const dy = nf.y - c.y;
  // Стоп у самого края своего монитора (right исключителен — на пиксель внутри).
  const [p, at] = walkTo(pet, dir > 0 ? c.right - 1 : c.left, v);
  if (!at) return p;
  const over = dir > 0 ? nf.left : nf.right - 1;
  // Вровень — шов, просто переходит; ниже — шагает и падает, если с этой высоты она уже над соседом.
  if (Math.abs(dy) <= SEAM) return { ...standOn(p, world, nf, over), facing: dir };
  if (dy > 0 && world.monitors[n].rect.top <= c.y - 1) return drop({ ...p, facing: dir }, over, p.y);
  if (dy < 0 && -dy <= side(world.monitors[ms])) return leap(p, world, nf, landX(world, nf, p.x));
  return appear(p, nf);
}

/** Край, с которого сходить вниз к gx: короче путь «до края + от края до цели». */
function downDir(x: number, c: Surface, gx: number): 1 | -1 {
  const viaLeft = Math.abs(x - c.left) + Math.abs(c.left - gx);
  const viaRight = Math.abs(x - c.right) + Math.abs(c.right - gx);
  return viaRight < viaLeft ? 1 : -1;
}

/** Внешний край пола: соседа с этой стороны нет. */
const outer = (world: World, f: Surface, dir: 1 | -1): boolean => neighbor(world, f.monitor, dir) < 0;

/** Кошка хотя бы частично за внешним краем пола f. */
function peeking(world: World, f: Surface, x: number, half: number): boolean {
  return (x + half > f.right && outer(world, f, 1)) || (x - half < f.left && outer(world, f, -1));
}

function walkStep(pet: Pet, world: World, all: Surface[], c: Surface, dt: number): [Pet, RoamEvent | null] {
  const m = world.monitors[c.monitor];
  const half = side(m) / 2;
  const v = (WALK * m.scale * dt) / 1000;

  let next: Pet;
  let event: RoamEvent | null = null;
  const goal = pet.goal;
  if (!goal) {
    if (pet.exit === 0) return [{ ...pet, move: 'still' }, null];
    const dir = pet.exit;
    if (c.kind === 'ledge') {
      const p = stepOff(pet, c, dir, v);
      return [p.on === null ? p : standOn(p, world, c, p.x), null];
    }
    const x = pet.x + dir * v;
    if (dir > 0 ? x - half >= c.right : x + half <= c.left) {
      const out = dir > 0 ? c.right + half : c.left - half;
      return [{ ...pet, x: out, facing: dir, move: 'out', on: null, hwnd: null, dx: 0 }, 'gone'];
    }
    return [{ ...pet, x, facing: dir }, null];
  }

  const t = all.find((s) => s.id === goal.surface);
  if (!t) return [{ ...pet, goal: null, move: pet.exit !== 0 ? 'walk' : 'still' }, null];
  const sameWindow = c.kind === 'ledge' && t.kind === 'ledge' && c.hwnd === t.hwnd;

  if (t.id === c.id) {
    const [p, at] = walkTo(pet, onto(c, goal.x), v);
    next = p;
    if (at) {
      // Цель «по дороге за край» — не остановка: идёт дальше наружу.
      if (pet.exit !== 0) next = { ...p, goal: null };
      else [next, event] = [{ ...p, goal: null, move: 'still' }, 'arrived'];
    }
  } else if (t.monitor !== c.monitor && !sameWindow) {
    next = crossTo(pet, world, all, c, t.monitor, v);
  } else if (t.y <= c.y) {
    // Выше (или вровень через щель): дойти до точки старта и прыгнуть.
    const sx = fit(goal.x, c.left + half, c.right - half);
    const [p, at] = walkTo(pet, sx, v);
    next = at ? leap(p, world, t, landX(world, t, p.x)) : p;
  } else {
    next = stepOff(pet, c, downDir(pet.x, c, goal.x), v);
  }

  // Ступила целиком на экран из-за внешнего края — вернулась; это важнее прихода.
  if (
    c.kind === 'floor' &&
    next.on === c.id &&
    pet.exit === 0 &&
    peeking(world, c, pet.x, half) &&
    !peeking(world, c, next.x, half)
  )
    event = 'back';
  if (next.on !== null) next = standOn(next, world, all.find((s) => s.id === next.on)!, next.x);
  return [next, event];
}

function jumpStep(pet: Pet, world: World, all: Surface[], dt: number): [Pet, RoamEvent | null] {
  const j = pet.jump;
  if (!j) return [drop(pet, pet.x, pet.y), null];
  const t = j.t + dt;
  if (t < j.ms) {
    const i = monitorAt(world, j.x0, j.y0);
    const lift = (i >= 0 ? side(world.monitors[i]) : SIDE) / 2;
    const u = t / j.ms;
    return [{ ...pet, x: j.x0 + (j.x1 - j.x0) * u, y: arcY(j.y0, j.y1, lift, u), jump: { ...j, t } }, null];
  }
  const s = all.find((a) => a.id === j.to);
  if (!s) return [drop(pet, j.x1, j.y1), 'fell'];
  const landed = standOn(pet, world, s, onto(s, j.x1));
  return [{ ...landed, move: restMove(landed) }, 'landed'];
}

function fallStep(pet: Pet, world: World, all: Surface[], dt: number): [Pet, RoamEvent | null] {
  const i = monitorAt(world, pet.x, pet.y);
  if (i < 0) return [spawn(world), null];
  const m = world.monitors[i];
  const sec = dt / 1000;
  const vy = Math.min(pet.vy + GRAVITY * m.scale * sec, MAX_FALL * m.scale);
  const y = pet.y + vy * sec;
  let s: Surface | undefined;
  for (const a of all)
    if (pet.y <= a.y && a.y <= y && covers(a, pet.x) && (!s || a.y < s.y)) s = a;
  let x = pet.x;
  // Мимо всех поверхностей ниже края монитора не проваливается: встаёт на его пол.
  if (!s && y >= m.rect.bottom) {
    s = floorOf(all, i);
    x = onto(s, x);
  }
  if (!s) return [{ ...pet, y, vy }, null];
  const landed = standOn(pet, world, s, x);
  return [{ ...landed, move: restMove(landed) }, 'landed'];
}

/** Один кадр. Чистая функция: возвращает новый объект и событие, вход не трогает. */
export function step(pet: Pet, world: World, dt: number): [Pet, RoamEvent | null] {
  const ms = Math.min(Math.max(dt, 0), MAX_DT_MS) || 0;
  const all = surfaces(world);

  if (pet.move === 'out') {
    // За краем: ничего не делает, только держится уровня пола своего монитора.
    const i = monitorAt(world, pet.x, pet.y);
    if (i < 0) return [spawn(world), null];
    return [{ ...pet, y: floorOf(all, i).y }, null];
  }
  if (pet.move === 'jump') return jumpStep(pet, world, all, ms);
  if (pet.move === 'fall') return fallStep(pet, world, all, ms);

  const [p, c, e] = ground(pet, world, all);
  if (!c) return [p, e];
  if (p.move === 'still') return [p, null];
  return walkStep(p, world, all, c, ms);
}

/** Назначить цель; уход за край отменяется. В прыжке и падении цель подхватится после приземления. */
export function goTo(pet: Pet, world: World, goal: Goal): Pet {
  if (pet.move === 'out') return pet;
  if (!surfaces(world).some((s) => s.id === goal.surface))
    return { ...pet, goal: null, exit: 0, move: pet.move === 'walk' ? 'still' : pet.move };
  return { ...pet, goal, exit: 0, move: pet.move === 'still' ? 'walk' : pet.move };
}

/**
 * Уйти за ближайший внешний край текущего монитора (снаружи нет соседа на уровне пола).
 * Внешних нет — к правому краю самого правого монитора: туда сначала цель по полу, потом наружу.
 */
export function leave(pet: Pet, world: World): Pet {
  if (pet.move === 'out') return pet;
  const all = surfaces(world);
  let i = monitorAt(world, pet.x, pet.y);
  if (i < 0) [pet, i] = [spawn(world), 0];
  if (!world.monitors[i]) return pet;
  const f = floorOf(all, i);
  const r = outer(world, f, 1);
  const l = outer(world, f, -1);
  const walking: Move = pet.move === 'still' ? 'walk' : pet.move;
  if (r || l) {
    const dir: 1 | -1 = r && l ? (f.right - pet.x <= pet.x - f.left ? 1 : -1) : r ? 1 : -1;
    return { ...pet, exit: dir, goal: null, move: walking };
  }
  let k = 0;
  world.monitors.forEach((m, j) => {
    if (m.rect.right > world.monitors[k].rect.right) k = j;
  });
  const tf = floorOf(all, k);
  const goal = { surface: tf.id, x: tf.right - side(world.monitors[k]) / 2 - EDGE_GAP };
  return { ...pet, exit: 1, goal, move: walking };
}

/**
 * Вернуться из-за того же края: встать на пол сразу за work (x на side/2 снаружи) и идти внутрь
 * до точки side/2 + EDGE_GAP от края. 'back' — когда целиком на экране, потом 'arrived'.
 */
export function enter(pet: Pet, world: World): Pet {
  if (pet.move !== 'out') return pet;
  const i = monitorAt(world, pet.x, pet.y);
  if (i < 0) return spawn(world);
  const f = floorOf(surfaces(world), i);
  const half = side(world.monitors[i]) / 2;
  const dir: 1 | -1 = pet.exit !== 0 ? pet.exit : pet.x >= (f.left + f.right) / 2 ? 1 : -1;
  const x = dir > 0 ? f.right + half : f.left - half;
  const gx = dir > 0 ? f.right - half - EDGE_GAP : f.left + half + EDGE_GAP;
  return {
    ...pet,
    x,
    y: f.y,
    move: 'walk',
    facing: dir > 0 ? -1 : 1,
    on: f.id,
    hwnd: null,
    dx: 0,
    goal: { surface: f.id, x: gx },
    exit: 0,
    jump: null,
    vy: 0,
  };
}

/** Число из rnd, зажатое в [0, 1). */
const roll = (rnd: () => number): number => clamp(rnd() || 0, 0, 0.999999);

/** Точка у одного из концов отрезка: от lo до доли `share` длины от конца; места нет — середина. */
function nearEnd(s: Surface, half: number, share: number, rnd: () => number): number {
  const lo = half + EDGE_GAP;
  const hi = share * (s.right - s.left);
  if (hi < lo) return (s.left + s.right) / 2;
  const d = lo + roll(rnd) * (hi - lo);
  return roll(rnd) < 0.5 ? s.left + d : s.right - d;
}

/** Доля ширины пола у края, где сидит. */
const FLOOR_SHARE = 0.2;
/** Доля ширины карниза у конца, где сидит. */
const LEDGE_SHARE = 0.25;
/** Вероятность отдыхать на полу, а не на карнизе. */
const REST_FLOOR = 0.7;
/** Вероятность посидеть на окне, в котором работает человек, если оно годится. */
const REST_ACTIVE = 0.5;

/**
 * Где посидеть ('rest') или поспать ('sleep'). Всегда у края, никогда не в центре монитора.
 * rest: чаще пол у края, иначе случайный карниз текущего монитора у одного из концов.
 * sleep: карниз, широкие вероятнее; предпочтительно на текущем мониторе; карнизов нет — пол у края.
 */
export function pickSpot(world: World, pet: Pet, kind: 'rest' | 'sleep', rnd: () => number): Goal {
  const all = surfaces(world);
  const i = Math.max(monitorAt(world, pet.x, pet.y), 0);
  const half = side(world.monitors[i]) / 2;
  const floor = (): Goal => {
    const f = floorOf(all, i);
    return { surface: f.id, x: nearEnd(f, half, FLOOR_SHARE, rnd) };
  };
  const onLedge = (l: Surface): Goal => ({
    surface: l.id,
    x: nearEnd(l, side(world.monitors[l.monitor]) / 2, LEDGE_SHARE, rnd),
  });
  const ledges = all.filter((s) => s.kind === 'ledge' && !s.strip);
  const here = ledges.filter((s) => s.monitor === i);
  const active = world.active == null ? [] : ledges.filter((s) => s.hwnd === world.active);
  const anyOf = (list: Surface[]): Goal => onLedge(list[Math.floor(roll(rnd) * list.length)]);

  if (kind === 'rest') {
    if (active.length > 0 && roll(rnd) < REST_ACTIVE) return anyOf(active);
    if (roll(rnd) < REST_FLOOR || here.length === 0) return floor();
    return anyOf(here);
  }
  // Спать — на рамке окна, где человек работает; потом на любой рамке; потом на полосе заголовка.
  const strips = all.filter((s) => s.strip);
  const own = strips.filter((s) => s.hwnd === world.active);
  const pool = [active, here, ledges, own, strips].find((list) => list.length > 0) ?? [];
  if (pool.length === 0) return floor();
  const total = pool.reduce((sum, s) => sum + (s.right - s.left), 0);
  let r = roll(rnd) * total;
  for (const s of pool) {
    r -= s.right - s.left;
    if (r < 0) return onLedge(s);
  }
  return onLedge(pool[pool.length - 1]);
}
