// Лоток: раз в полтора-три часа кошка сама идёт в свой лоток, сидит в нём, закапывает и, как
// положено кошке, с топотом носится после. Опция, по умолчанию выключена. Лоток — вещь, как миска
// и лежак: своё окно, его можно перетащить мышью, место запоминается. После каждого похода в лотке
// прибавляется комочек, а наполнитель понемногу стареет: ПКМ по лотку — «Убрать» (комочки) или
// «Поменять» (весь наполнитель).
//
// Чистые функции: без DOM и часов, `now` и `rnd` — параметрами. Пока визит идёт, приложение зовёт
// `tick` вместо `roam.step` (как у мести и клубка).

import { RUN, WALK, atLitter, goTo, litterAt, step, stepAside, type Goal, type Pet, type Place, type RoamEvent, type World } from './roam';

const MIN = 60_000;

/** Между походами в лоток — от GAP_MIN до GAP_MAX. */
export const GAP_MIN = 90 * MIN;
export const GAP_MAX = 180 * MIN;
/** Сидит в лотке, мс. */
export const SQUAT_MS = 6000;
/** Закапывает, мс: на совесть, чтобы ничего не торчало. */
export const DIG_MS = 4500;
/** Не дошла до лотка или не набегалась за столько мс — бросает. */
export const GIVE_UP = 40_000;
/** После лотка носится на столько сторон спрайта. */
export const ZOOM_SIDES = 5;

export type Phase = 'go' | 'squat' | 'dig' | 'leave' | 'done';

export interface Visit {
  phase: Phase;
  /** Когда кончается фаза (или когда бросить идти), мс. */
  t: number;
  /** Куда встать: в лоток. */
  spot: Goal;
}

/** Что в лотке: комочков (по одному за поход) и сколько походов с последней смены наполнителя. */
export interface Box {
  clumps: number;
  visits: number;
}

/** Наполнитель стареет на ступень каждые WEAR_VISITS походов. */
export const WEAR_VISITS = 6;

export const freshBox = (): Box => ({ clumps: 0, visits: 0 });

/** Закопала: ещё комочек, наполнитель на поход старше. */
export const used = (b: Box): Box => ({ clumps: b.clumps + 1, visits: b.visits + 1 });

/** ПКМ → «Убрать»: комочки вычерпали, наполнитель тот же. */
export const scoop = (b: Box): Box => ({ ...b, clumps: 0 });

/** ПКМ → «Поменять»: весь наполнитель свежий. */
export const change = (): Box => freshBox();

/** Ступень старости наполнителя для спрайта (он сам ограничит сверху). */
export const wear = (b: Box): number => Math.floor(b.visits / WEAR_VISITS);

/** Из файла: `{ x, y, clumps, visits }` — место читает приложение, здесь только содержимое. */
export function loadBox(json: string | null): Box {
  try {
    const b = JSON.parse(json ?? 'null');
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    return { clumps: n(b?.clumps), visits: n(b?.visits) };
  } catch {
    return freshBox();
  }
}

/** Через сколько мс следующий поход в лоток. */
export const gap = (rnd: () => number): number => GAP_MIN + rnd() * (GAP_MAX - GAP_MIN);

const spotOf = (world: World, place: Place | null): Goal | null => {
  const l = litterAt(world, place);
  return l && { surface: l.surface, x: l.x };
};

/** Пойти в лоток; лотку негде стоять — null. */
export function start(world: World, pet: Pet, place: Place | null, now: number): [Visit, Pet] | null {
  const spot = spotOf(world, place);
  if (!spot) return null;
  return [{ phase: 'go', t: now + GIVE_UP, spot }, goTo(pet, world, spot)];
}

/** Кошкой правит лоток. */
export const owns = (v: Visit | null): boolean => v !== null && v.phase !== 'done';

/** Один кадр похода в лоток. */
export function tick(v: Visit, world: World, pet: Pet, place: Place | null, now: number, dt: number): [Visit, Pet, RoamEvent | null] {
  if (v.phase === 'done') return [v, pet, null];
  let e: RoamEvent | null;
  [pet, e] = step(pet, world, dt, v.phase === 'leave' ? RUN : WALK);
  if (pet.move === 'out') return [{ ...v, phase: 'done' }, pet, e];
  const stopped = pet.move === 'still' && !pet.goal;
  switch (v.phase) {
    case 'go': {
      // лоток перетащили или уехало окно под ним — идёт к новому месту
      const spot = spotOf(world, place);
      if (!spot || now >= v.t) return [{ ...v, phase: 'done' }, pet, e];
      if (spot.surface !== v.spot.surface || Math.abs(spot.x - v.spot.x) >= 1) return [{ ...v, spot }, goTo(pet, world, spot), e];
      if (e === 'arrived' || stopped) {
        // дойти не вышло (лоток там, куда не запрыгнуть) — передумала
        if (!atLitter(pet, world, place)) return [{ ...v, phase: 'done' }, pet, e];
        return [{ ...v, phase: 'squat', t: now + SQUAT_MS }, pet, e];
      }
      break;
    }
    case 'squat':
      // разворачивается к тому, что сделала: оно было под крупом, теперь — под передней лапой
      if (now >= v.t) return [{ ...v, phase: 'dig', t: now + DIG_MS }, { ...pet, facing: pet.facing === 1 ? -1 : 1 }, e];
      break;
    case 'dig':
      if (now >= v.t) return [{ ...v, phase: 'leave', t: now + GIVE_UP }, stepAside(pet, world, ZOOM_SIDES), e];
      break;
    case 'leave':
      if (e === 'arrived' || stopped || now >= v.t) return [{ ...v, phase: 'done' }, pet, e];
      break;
  }
  return [v, pet, e];
}

/** Поход прервали (взяли на руки, лазер, «не мешать», лоток убрали): кошкой дальше правит приложение. */
export const drop = (v: Visit): Visit => ({ ...v, phase: 'done' });

/** Поза: идёт, сидит в лотке, закапывает, носится; null — за краем. */
export function pose(v: Visit, pet: Pet): 'stand' | 'walk' | 'run' | 'jump' | 'fall' | 'potty' | 'dig' | null {
  if (pet.move === 'out') return null;
  if (pet.move === 'jump' || pet.move === 'fall') return pet.move;
  const walking = pet.move === 'walk';
  switch (v.phase) {
    case 'squat':
      return 'potty';
    case 'dig':
      return 'dig';
    case 'leave':
      return walking ? 'run' : 'stand';
    default:
      return walking ? 'walk' : 'stand';
  }
}
