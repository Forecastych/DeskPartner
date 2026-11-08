// Подарок на 100 дней: когда чистого времени вместе (stats.together) набирается 2400 часов, кошка
// в спокойную минуту уходит за край экрана и возвращается с мышкой в зубах — целой и чистой, —
// кладёт её рядом с собой и ждёт. ПКМ по мышке: «Принять подарок» — мурлычет, мышка остаётся
// трофеем (её можно перетащить, место запоминается); «Убрать подарок» — обижается, уносит мышку
// за край, съедает там (видно только облачко) и засыпает за краем, пока не вернётся сама.
// Раз за жизнь питомца: что подарок уже был, хранится на диске.
//
// Чистые функции: без DOM и часов, `now` — параметром. Пока сценка идёт, приложение зовёт `tick`
// вместо `roam.step` (как у лотка).

import { t } from './i18n';
import { WALK, enter, giftAt, goTo, leave, monitorOf, side, step, stepAside, type Pet, type Place, type RoamEvent, type World } from './roam';

const HOUR = 3_600_000;

/** Столько чистого времени вместе — и кошка дарит мышку. */
export const GIFT_AT = 2400 * HOUR;
/** За краем ищет мышь, мс. */
export const FETCH_MS = 4000;
/** Вернулась с мышью — отходит от края вглубь на столько сторон спрайта: в углу лежак и лоток. */
export const BRING_SIDES = 3;
/** Мышь кладёт перед мордой: середина подарка на столько сторон спрайта впереди её середины. */
export const GIFT_GAP = 0.75;
/** Положила — сидит рядом и ждёт, мс; потом живёт дальше, а подарок лежит, пока не решат. */
export const WAIT_MS = 90_000;
/** Сначала зовёт посмотреть, мс. */
export const ANNOUNCE_MS = 3000;
/** Подарок приняли — мурлычет, мс. */
export const PURR_MS = 6000;
/** За краем ест обиженно, мс; потом засыпает там же. */
export const EAT_MS = 6000;
/** Не дошла за столько мс (застряла, не запрыгнуть) — делает, что может, с того места, где стоит. */
export const GIVE_UP = 60_000;

/** none — ещё не дарила; given — лежит, ждёт решения; kept — принят, лежит трофеем; gone — убран. */
export type State = 'none' | 'given' | 'kept' | 'gone';

export interface Gift {
  state: State;
  /** Где лежит (given и kept), физ. px: x — середина окна, y — низ. */
  place: Place | null;
}

export const fresh = (): Gift => ({ state: 'none', place: null });

/** Подарок на экране: ждёт решения или лежит трофеем. */
export const lying = (g: Gift): boolean => (g.state === 'given' || g.state === 'kept') && g.place !== null;

/** Пора дарить: ни разу не дарила, а вместе — не меньше GIFT_AT. */
export const due = (g: Gift, together: number): boolean => g.state === 'none' && together >= GIFT_AT;

/** Место без лишнего: точка и, если стоит на рамке окна, само окно — чтобы ехать за ним. */
const spot = (p: Place): Place => ({ x: p.x, y: p.y, ...(p.hwnd != null && { hwnd: p.hwnd, dx: p.dx }) });

/** Положила рядом с собой. */
export const given = (place: Place): Gift => ({ state: 'given', place: spot(place) });

/** ПКМ → «Принять подарок»: остаётся трофеем на том же месте. */
export const accept = (g: Gift): Gift => (g.state === 'given' ? { ...g, state: 'kept' } : g);

/** ПКМ → «Убрать подарок» (и у трофея тоже): больше его нет и не будет. */
export const remove = (): Gift => ({ state: 'gone', place: null });

/** Подарок перетащили или он упал: новое место. */
export const moved = (g: Gift, place: Place): Gift => (lying(g) ? { ...g, place: spot(place) } : g);

/** Из файла: `{ state, x, y }`. Мусор — как будто ещё не дарила; лежащий без места — убран. */
export function load(json: string | null): Gift {
  try {
    const g = JSON.parse(json ?? 'null');
    const state: State = ['given', 'kept', 'gone'].includes(g?.state) ? g.state : 'none';
    if (state !== 'given' && state !== 'kept') return { state, place: null };
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) return remove();
    return { state, place: { x: g.x, y: g.y } };
  } catch {
    return fresh();
  }
}

// окно-опору не храним: после перезапуска у окон другие hwnd — подарок найдёт рамку по точке
export const save = (g: Gift): string =>
  JSON.stringify({ state: g.state, ...(g.place && { x: Math.round(g.place.x), y: Math.round(g.place.y) }) });

// ── Сценка ───────────────────────────────────────────────────────────────────────────────────

/**
 * fetch — уходит за край; away — за краем ищет мышь; bring — несёт её в зубах; wait — положила, ждёт;
 * purr — приняли, мурлычет; take — убрали, идёт забрать; carry — уносит за край; eat — ест за краем.
 */
export type Phase = 'fetch' | 'away' | 'bring' | 'wait' | 'purr' | 'take' | 'carry' | 'eat' | 'done';

export interface Visit {
  phase: Phase;
  /** Когда кончается фаза (или когда бросить идти), мс. */
  t: number;
}

/**
 * Что приложению сделать в этот кадр: put — положить подарок (`putAt`); took — забрала его, окно
 * подарка убрать; eat — скрылась за краем, пора облачко с чавканьем; nap — доела, уснуть за краем.
 */
export type Cue = 'put' | 'took' | 'eat' | 'nap';

/** Кошкой правит подарок. */
export const owns = (v: Visit | null): boolean => v !== null && v.phase !== 'done';

/** Пойти за подарком: за ближайший внешний край. В прыжке, падении или за краем — не сейчас. */
export function start(world: World, pet: Pet, now: number): [Visit, Pet] | null {
  if (pet.move !== 'still' && pet.move !== 'walk') return null;
  return [{ phase: 'fetch', t: now + GIVE_UP }, leave(pet, world)];
}

/** Подарок приняли: мурлычет, где стоит. */
export function thank(pet: Pet, now: number): [Visit, Pet] {
  const still = pet.move === 'walk' ? { ...pet, move: 'still' as const, goal: null, exit: 0 as const } : pet;
  return [{ phase: 'purr', t: now + PURR_MS }, still];
}

/** Подарок убрали: идёт забрать его; негде ему лежать — null. */
export function takeBack(world: World, pet: Pet, place: Place | null, now: number): [Visit, Pet] | null {
  const g = giftAt(world, place);
  if (!g || pet.move === 'out' || pet.move === 'jump' || pet.move === 'fall') return null;
  return [{ phase: 'take', t: now + GIVE_UP }, goTo(pet, world, { surface: g.surface, x: g.x })];
}

/** Куда положить подарок: перед мордой, на GIFT_GAP сторон спрайта. */
export function putAt(world: World, pet: Pet): Place | null {
  const m = monitorOf(world, pet);
  if (!m || pet.move === 'out') return null;
  return { x: pet.x + pet.facing * GIFT_GAP * side(m), y: pet.y };
}

/** Один кадр сценки; последним — что случилось в пути (`roam.step`), как у лотка. */
export function tick(
  v: Visit,
  world: World,
  pet: Pet,
  place: Place | null,
  now: number,
  dt: number,
): [Visit, Pet, Cue | null, RoamEvent | null] {
  if (v.phase === 'done') return [v, pet, null, null];
  const [p, e] = step(pet, world, dt, WALK);
  return [...advance(v, world, p, e, place, now), e];
}

/** Фаза сценки после шага. */
function advance(v: Visit, world: World, pet: Pet, e: RoamEvent | null, place: Place | null, now: number): [Visit, Pet, Cue | null] {
  const stopped = pet.move === 'still' && !pet.goal;
  const done: Visit = { ...v, phase: 'done' };
  switch (v.phase) {
    case 'fetch':
      if (pet.move === 'out') return [{ phase: 'away', t: now + FETCH_MS }, pet, null];
      if (now >= v.t) return [done, pet, null];
      break;
    case 'away':
      if (now >= v.t) return [{ phase: 'bring', t: now + GIVE_UP }, enter(pet, world), null];
      break;
    case 'bring':
      if (pet.move === 'out') return [done, pet, null];
      // целиком на экране — ещё на несколько шагов вглубь, подальше от вещей в углу
      if (e === 'back') return [v, stepAside(pet, world, BRING_SIDES), null];
      if (stopped || now >= v.t) {
        // зависла в прыжке — не положить; подарок подождёт до другого раза
        if (!pet.on) return [done, pet, null];
        return [{ phase: 'wait', t: now + WAIT_MS }, pet, 'put'];
      }
      break;
    case 'take': {
      const g = giftAt(world, place);
      if (!g) return [done, pet, null];
      const reached = stopped && pet.on === g.surface && Math.abs(pet.x - g.x) < 1;
      // подарок перетащили, пока шла, — к новому месту
      if (!reached && pet.goal && (pet.goal.surface !== g.surface || Math.abs(pet.goal.x - g.x) >= 1) && now < v.t)
        return [v, goTo(pet, world, { surface: g.surface, x: g.x }), null];
      // дошла или не может дойти — всё равно забирает и уходит
      if (reached || stopped || now >= v.t) return [{ phase: 'carry', t: now + GIVE_UP }, leave(pet, world), 'took'];
      break;
    }
    case 'carry':
      if (pet.move === 'out') return [{ phase: 'eat', t: now + EAT_MS }, pet, 'eat'];
      // не вышло уйти за край — спать уйдёт обычным путём
      if (now >= v.t) return [done, pet, 'nap'];
      break;
    case 'eat':
      if (now >= v.t) return [done, pet, 'nap'];
      break;
    case 'wait':
    case 'purr':
      if (now >= v.t) return [done, pet, null];
      break;
  }
  return [v, pet, null];
}

/** Сценку прервали (взяли на руки, лазер, «не мешать»): кошкой дальше правит приложение. */
export const drop = (v: Visit): Visit => ({ ...v, phase: 'done' });

/** Несёт мышь в зубах. */
export const carrying = (v: Visit | null): boolean => v !== null && (v.phase === 'bring' || v.phase === 'carry');

/** Поза; null — за краем. */
export function pose(v: Visit, pet: Pet, now: number): 'stand' | 'walk' | 'jump' | 'fall' | 'sit' | 'announce' | 'petted' | null {
  if (pet.move === 'out') return null;
  if (pet.move === 'jump' || pet.move === 'fall') return pet.move;
  if (pet.move === 'walk') return 'walk';
  switch (v.phase) {
    case 'wait':
      return now < v.t - WAIT_MS + ANNOUNCE_MS ? 'announce' : 'sit';
    case 'purr':
      return 'petted';
    default:
      return 'stand';
  }
}

/** Положила подарок. */
export const presentLine = (): string => t('Это тебе. Сама поймала.', 'This is for you. Caught it myself.');
/** Приняли. */
export const purrLine = (): string => t('Мрр-мрр…', 'Purr-purr…');
/** Убрали. */
export const hurtLine = (): string => t('Ну и пожалуйста.', 'Fine. Suit yourself.');
/** За краем, не видна. */
export const chompLine = (): string => t('Хрум-хрум. Ням.', 'Crunch, crunch. Nom.');
