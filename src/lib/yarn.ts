// Клубок: спокойная игра вместо погони. Раз в час-два кошка уходит за край экрана, выходит
// оттуда, толкая перед собой клубок, и пару минут катает его по полу (над панелью задач):
// подходит, припадает, бьёт лапой — клубок катится, тормозит, от краёв экрана отскакивает.
// В конце закатывает его за тот же край, бежит следом и через пару секунд возвращается одна.
// Чистые функции: без DOM и часов, `now` и `rand` — параметрами. Приложение зовёт `tick` вместо
// `roam.step`, пока игра не 'done'. Клубок рисует окно мыши — вместе они не бывают.

import { enter, exits, goTo, leaveBy, monitorOf, RUN, side, SIDE, step, surfaces, WALK, type Exit, type Pet, type RoamEvent, type Surface, type World } from './roam';

/** Игра длится от PLAY_MIN до PLAY_MAX мс — с выхода с клубком до последнего удара. */
export const PLAY_MIN = 2 * 60_000;
export const PLAY_MAX = 3 * 60_000;
/** За клубком за край — от FETCH_MIN до FETCH_MAX мс; столько же сидит там, укатив его в конце. */
export const FETCH_MIN = 2000;
export const FETCH_MAX = 4000;
/** Припала перед ударом от AIM_MIN до AIM_MAX мс. */
export const AIM_MIN = 600;
export const AIM_MAX = 1600;
/** Ударила — смотрит, как катится, хотя бы WATCH_MIN..WATCH_MAX мс и пока не встанет. */
export const WATCH_MIN = 500;
export const WATCH_MAX = 1500;
/** Скорость клубка после удара, логич. px/с. Финальный — с запасом до края, но не быстрее BAT_TOP. */
export const BAT_MIN = 120;
export const BAT_MAX = 260;
export const BAT_OUT = 320;
export const BAT_TOP = 700;
/** Торможение клубка о пол, логич. px/с². */
export const DECEL = 140;
/** От края экрана отскакивает с такой долей скорости. */
export const BOUNCE = 0.5;
/** К клубку — рысцой, не бегом: это игра, а не охота. */
export const TROT = 2 * WALK;
/** Иногда обходит клубок, чтобы ударить в другую сторону: так он гуляет по всему полу. */
export const GO_ROUND = 0.3;
/** Центр клубка от лап кошки, доля стороны спрайта: у передних лап. */
export const REACH = 0.28;
/** Радиус клубка, доля стороны спрайта (8 клеток из 32). */
export const RADIUS = 0.125;
/** Кошка не дошла до края или обратно за столько мс — игра кончается без неё. */
export const GIVE_UP = 20_000;

/**
 * fetch — идёт за край за клубком; away — там; enter — выходит, толкая клубок; play — катает;
 * out — финальный удар, клубок укатывается; follow — кошка бежит за ним; gone — за краем;
 * return — возвращается; drop — игру прервали, клубок докатывается сам, кошкой правит
 * приложение; done — всё.
 */
export type Phase = 'fetch' | 'away' | 'enter' | 'play' | 'out' | 'follow' | 'gone' | 'return' | 'drop' | 'done';
/** В игре: идёт к клубку, припала перед ударом, смотрит, как катится. */
export type Act = 'walk' | 'aim' | 'watch';

export interface Ball {
  /** Центр по x, физ. px; низ — на полу. */
  x: number;
  /** Физ. px/с, знак — направление. */
  v: number;
  /** Сколько прокатился всего, физ. px: от этого крутится узор. */
  turn: number;
}

export interface Game {
  phase: Phase;
  /** Край, из-за которого выходит с клубком и за который его укатывает. */
  door: Exit;
  /** null — клубка на экране нет. */
  ball: Ball | null;
  act: Act;
  /** Когда кончить игру, мс. */
  until: number;
  /** Срок текущего дела: припала до, смотрит до, сидит за краем до, сдаётся в. */
  t: number;
}

/** Что рисовать в окне мыши: клубок в (x, y) физ. px, кадр узора, куда тянется нитка. */
export interface YarnView {
  x: number;
  y: number;
  anim: 'yarn';
  frame: number;
  facing: 1 | -1;
}

const roll = (rand: () => number): number => Math.min(Math.max(rand() || 0, 0), 0.999999);
const between = (rand: () => number, lo: number, hi: number): number => lo + roll(rand) * (hi - lo);

const floorAt = (world: World, i: number): Surface | undefined => surfaces(world).find((s) => s.kind === 'floor' && s.monitor === i);
const scaleOf = (world: World, g: Game): number => world.monitors[g.door.monitor]?.scale ?? 1;
const sideOf = (world: World, g: Game): number => {
  const m = world.monitors[g.door.monitor];
  return m ? side(m) : 0;
};

/** Ближайший внешний край монитора кошки; у среднего из трёх мониторов — ближайший вообще. */
function nearestDoor(world: World, cat: Pet): Exit | null {
  const doors = exits(world);
  if (!doors.length) return null;
  const mon = monitorOf(world, cat);
  const i = mon ? world.monitors.indexOf(mon) : -1;
  const dist = (e: Exit): number => {
    const m = world.monitors[e.monitor];
    return Math.abs((e.dir > 0 ? m.work.right : m.work.left) - cat.x) + (e.monitor === i ? 0 : 1e6);
  };
  return doors.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

/** Начать: кошка идёт за клубком за ближайший край. Внешних краёв нет — null, играть негде. */
export function start(world: World, cat: Pet, now: number): [Game, Pet] | null {
  const door = nearestDoor(world, cat);
  if (!door || !floorAt(world, door.monitor)) return null;
  const game: Game = { phase: 'fetch', door, ball: null, act: 'walk', until: 0, t: now + GIVE_UP };
  return [game, leaveBy(cat, world, door)];
}

/**
 * Клубок катится сам: тормозит о пол, от краёв пола отскакивает. `open` — край, за который он
 * может укатиться (финал): там не отскакивает.
 */
function rollBall(b: Ball, f: Surface, r: number, scale: number, dt: number, open: 1 | -1 | 0): Ball {
  const s = Math.min(Math.max(dt, 0), 200) / 1000 || 0;
  const dv = DECEL * scale * s;
  let v = Math.abs(b.v) <= dv ? 0 : b.v - Math.sign(b.v) * dv;
  let x = b.x + ((b.v + v) / 2) * s;
  const lo = f.left + r;
  const hi = f.right - r;
  if (x > hi && open !== 1) [x, v] = [Math.max(hi - (x - hi) * BOUNCE, lo), -Math.abs(v) * BOUNCE];
  if (x < lo && open !== -1) [x, v] = [Math.min(lo + (lo - x) * BOUNCE, hi), Math.abs(v) * BOUNCE];
  return { x, v, turn: b.turn + (x - b.x) };
}

/** Где встать, чтобы клубок был у передних лап со стороны `dir` от кошки; у края экрана — как выйдет. */
function spotBy(f: Surface, ball: Ball, dir: 1 | -1, sd: number): number {
  const half = sd / 2;
  return Math.min(Math.max(ball.x - dir * REACH * sd, f.left + half), f.right - half);
}

const standBy = (cat: Pet, world: World, f: Surface, ball: Ball, dir: 1 | -1, sd: number): Pet =>
  goTo(cat, world, { surface: f.id, x: spotBy(f, ball, dir, sd) });

/** Кошка, идущая к краю `dir`, толкает лежащий клубок перед собой. */
function push(ball: Ball, cat: Pet, dir: 1 | -1, sd: number): Ball {
  const front = cat.x + dir * REACH * sd;
  if (dir * (front - ball.x) <= 0) return ball;
  return { ...ball, x: front, turn: ball.turn + (front - ball.x) };
}

const toward = (cat: Pet, x: number): 1 | -1 => (Math.abs(x - cat.x) < 1 ? cat.facing : x > cat.x ? 1 : -1);

/** Одно дело в игре: подойти, припасть, ударить, посмотреть. */
function play(g: Game, world: World, f: Surface, cat: Pet, now: number, dt: number, rand: () => number): [Game, Pet, RoamEvent | null] {
  const sd = sideOf(world, g);
  const scale = scaleOf(world, g);
  const ball = rollBall(g.ball!, f, RADIUS * sd, scale, dt, 0);
  g = { ...g, ball };
  switch (g.act) {
    case 'walk': {
      const [p, e] = step(cat, world, dt, TROT);
      if (e !== 'arrived') return [g, p, e];
      return [{ ...g, act: 'aim', t: now + between(rand, AIM_MIN, AIM_MAX) }, { ...p, facing: toward(p, ball.x) }, e];
    }
    case 'aim': {
      if (now < g.t) return [g, cat, null];
      // время вышло — последний удар, к краю: сначала зайти с другой стороны клубка. Клубок у
      // дальнего края и зайти некуда — бьёт как обычно: отскочит от края, тогда и укатит
      let last = now >= g.until;
      if (last && cat.facing !== g.door.dir) {
        const x = spotBy(f, ball, g.door.dir, sd);
        if (g.door.dir * (ball.x - x) > 0) return [{ ...g, act: 'walk' }, goTo(cat, world, { surface: f.id, x }), null];
        last = false;
      }
      // клубок забился в угол — выковыривает лапой назад, из-под себя
      const room = cat.facing > 0 ? f.right - ball.x : ball.x - f.left;
      const dir = !last && room < sd / 2 ? -cat.facing : cat.facing;
      // финальный: чтобы докатился до края сам — v² = 2·DECEL·путь, плюс запас
      const toEdge = (g.door.dir > 0 ? f.right - ball.x : ball.x - f.left) / scale + 2 * RADIUS * SIDE;
      const out = Math.min(Math.max(Math.sqrt(2 * DECEL * toEdge) * 1.15, BAT_OUT), BAT_TOP);
      const v = dir * (last ? out : between(rand, BAT_MIN, BAT_MAX)) * scale;
      return [{ ...g, phase: last ? 'out' : 'play', act: 'watch', ball: { ...ball, v }, t: now + between(rand, WATCH_MIN, WATCH_MAX) }, cat, null];
    }
    case 'watch': {
      const p: Pet = { ...cat, facing: toward(cat, ball.x) };
      if (now < g.t || ball.v !== 0) return [g, p, null];
      // к стене не бьёт, а иногда и просто заходит с другой стороны
      let dir = toward(p, ball.x);
      const room = dir > 0 ? f.right - ball.x : ball.x - f.left;
      if (room < 1.5 * sd || roll(rand) < GO_ROUND) dir = -dir as 1 | -1;
      return [{ ...g, act: 'walk' }, standBy(p, world, f, ball, dir, sd), null];
    }
  }
}

/**
 * Один кадр игры. Возвращает игру, кошку и событие roam от кошки. В 'drop' кошка не меняется:
 * ею правит приложение.
 */
export function tick(g: Game, world: World, cat: Pet, now: number, dt: number, rand: () => number): [Game, Pet, RoamEvent | null] {
  const f = floorAt(world, g.door.monitor);
  // монитор с краем пропал — играть негде
  if (!f) return [{ ...g, phase: 'done', ball: null }, g.phase === 'drop' ? cat : halt(cat), null];
  const sd = sideOf(world, g);
  switch (g.phase) {
    case 'fetch': {
      const [p, e] = step(cat, world, dt);
      if (e === 'gone') return [{ ...g, phase: 'away', t: now + between(rand, FETCH_MIN, FETCH_MAX) }, p, null];
      if (now >= g.t) return [{ ...g, phase: 'done' }, halt(p), null];
      return [g, p, e];
    }
    case 'away': {
      if (now < g.t) return [g, step(cat, world, dt)[0], null];
      const p0 = enter(cat, world);
      // выходит подальше обычного: клубку нужно место
      const into = between(rand, 0.15, 0.3) * (f.right - f.left);
      const p = goTo(p0, world, { surface: f.id, x: g.door.dir > 0 ? f.right - into : f.left + into });
      const ball: Ball = { x: p.x + p.facing * REACH * sd, v: 0, turn: 0 };
      return [{ ...g, phase: 'enter', ball, t: now + GIVE_UP }, p, null];
    }
    case 'enter': {
      const [p, e] = step(cat, world, dt, TROT);
      const x = p.x + p.facing * REACH * sd;
      const ball: Ball = { x, v: 0, turn: g.ball!.turn + (x - g.ball!.x) };
      if (e === 'arrived' || now >= g.t) {
        const until = now + between(rand, PLAY_MIN, PLAY_MAX);
        return [{ ...g, phase: 'play', ball, act: 'aim', until, t: now + between(rand, AIM_MIN, AIM_MAX) }, halt(p), e];
      }
      return [{ ...g, ball }, p, e];
    }
    case 'play':
      return play(g, world, f, cat, now, dt, rand);
    case 'out': {
      const ball = rollBall(g.ball!, f, RADIUS * sd, scaleOf(world, g), dt, g.door.dir);
      const gone = g.door.dir > 0 ? ball.x - RADIUS * sd > f.right : ball.x + RADIUS * sd < f.left;
      const p: Pet = { ...cat, facing: toward(cat, ball.x) };
      // покатился — и она за ним, не дожидаясь, пока он скроется
      if (now >= g.t || gone) return [{ ...g, phase: 'follow', ball: gone ? null : ball, t: now + GIVE_UP }, leaveBy(halt(p), world, g.door), null];
      return [{ ...g, ball }, p, null];
    }
    case 'follow': {
      const [p, e] = step(cat, world, dt, RUN);
      // клубок не докатился — догоняет и толкает перед собой за край
      let ball = g.ball && push(rollBall(g.ball, f, RADIUS * sd, scaleOf(world, g), dt, g.door.dir), p, g.door.dir, sd);
      if (ball && (g.door.dir > 0 ? ball.x - RADIUS * sd > f.right : ball.x + RADIUS * sd < f.left)) ball = null;
      if (e === 'gone') return [{ ...g, phase: 'gone', ball: null, t: now + between(rand, FETCH_MIN, FETCH_MAX) }, p, null];
      if (now >= g.t) return [{ ...g, phase: 'done', ball: null }, halt(p), null];
      return [{ ...g, ball }, p, e];
    }
    case 'gone':
      if (now >= g.t) return [{ ...g, phase: 'return', t: now + GIVE_UP }, enter(cat, world), null];
      return [g, step(cat, world, dt)[0], null];
    case 'return': {
      const [p, e] = step(cat, world, dt);
      if (e === 'arrived' || now >= g.t) return [{ ...g, phase: 'done' }, halt(p), e];
      return [g, p, e];
    }
    case 'drop': {
      if (!g.ball) return [{ ...g, phase: 'done' }, cat, null];
      const ball = rollBall(g.ball, f, RADIUS * sd, scaleOf(world, g), dt, g.door.dir);
      const gone = g.door.dir > 0 ? ball.x - RADIUS * sd > f.right : ball.x + RADIUS * sd < f.left;
      if (gone || now >= g.t) return [{ ...g, phase: 'done', ball: null }, cat, null];
      // остановился — укатывается к краю сам: на экране ему без кошки лежать незачем
      return [{ ...g, ball: ball.v === 0 ? { ...ball, v: g.door.dir * BAT_OUT * scaleOf(world, g) } : ball }, cat, null];
    }
    case 'done':
      return [g, cat, null];
  }
}

/** Кошка встала там, где её застал конец: без цели и ухода за край. */
const halt = (p: Pet): Pet => ({ ...p, goal: null, exit: 0, move: p.move === 'walk' ? 'still' : p.move });

/**
 * Игру прервали (взяли на руки, лазер, уснула, проголодалась, клубок выключили): клубок
 * укатывается за край сам, кошкой дальше правит приложение.
 */
export function drop(g: Game, now: number): Game {
  if (g.phase === 'drop' || g.phase === 'done') return g;
  return { ...g, phase: 'drop', t: now + GIVE_UP };
}

/** Кошкой правит игра (а не приложение). */
export const owns = (g: Game | null): boolean => g !== null && g.phase !== 'drop' && g.phase !== 'done';

/** Поза кошки, стоящей в игре: припала перед ударом, иначе стоит и смотрит. */
export const pose = (g: Game): 'crouch' | 'stand' => (g.phase === 'play' && g.act === 'aim' ? 'crouch' : 'stand');

/** Бежит за укатившимся клубком — бегом, а не шагом. */
export const running = (g: Game): boolean => g.phase === 'follow';

/** Клубок на экране: что рисовать; нет — null. */
export function view(g: Game | null, world: World | null): YarnView | null {
  if (!g || !g.ball || !world) return null;
  const f = floorAt(world, g.door.monitor);
  if (!f) return null;
  const cell = sideOf(world, g) / 32;
  const frame = ((Math.floor(g.ball.turn / (2 * cell || 1)) % 4) + 4) % 4;
  // нитка тянется за клубком: катится вправо — хвостик слева
  const facing: 1 | -1 = g.ball.v < 0 ? -1 : g.ball.v > 0 ? 1 : g.door.dir > 0 ? -1 : 1;
  return { x: g.ball.x, y: f.y, anim: 'yarn', frame, facing };
}
