// Месть злой кошки: независимая и ленивая, она не мстит за каждую обиду, зато если уж мстит —
// метко. Разбудили не доспавшей (особенно второй раз подряд) или долго тыкали курсором — может
// затаить обиду; дождётся, пока человек сидит в самой своей «важной» программе, подойдёт к её
// окну и оставит на нём лужу. Лужа — только картинка в своём прозрачном окне поверх экрана:
// клики проходят сквозь неё, файлы и окна не меняются, через полминуты-минуту она высыхает сама.
//
// «Важное» — активное окно; ценнее всего, если это программа, где человек сегодня провёл больше
// всего времени (знает трекер, заголовков он не читает). Содержимое окна питомец не видит —
// только рамку из мира (roam.World) и имя программы. Не трогаем программы, где лужа была бы
// не смешной: менеджеры паролей, банки, переписки. В браузере сайтов не различаем (распознавания
// нет), поэтому там — лужа на полу рядом с кошкой, как и когда активного окна нет.
//
// Только в режиме «Шалости»: в спокойном кошка «живёт рядом и не мешает». Никогда — пока человеку
// лучше не мешать (quiet: игра, презентация, полный экран) и пока идёт созвон.
//
// Чистые функции: без DOM и часов, `now` и `rnd` — параметрами. Пока месть идёт, приложение зовёт
// `tick` вместо `roam.step` (как у клубка); лужу рисует окно "puddle" по `view`.

import { PUDDLE_H, PUDDLE_W, SIZE } from './sprite';
import { EDGE_GAP, WALK, goTo, inRect, monitorOf, side, step, stepAside, surfaces, type Goal, type Monitor, type Pet, type Rect, type RoamEvent, type World } from './roam';

const MIN = 60_000;

/**
 * Между местями не меньше 15 минут, даже если обижали без остановки: защита от автокликера
 * и просто «редко». Время последней мести хранится (`save`), перезапуск его не обнуляет.
 */
export const COOLDOWN = 15 * MIN;
/**
 * Обиду помнит полчаса — дольше, чем спит за краем, уйдя после третьей побудки (sleep.NAP_MS,
 * 20 минут): вернувшись, отомстит.
 */
export const GRUDGE_MS = 30 * MIN;
/** Ждёт, пока человек откроет самую важную программу дня, не дольше минуты — потом мстит в то, что открыто. */
export const PATIENCE = MIN;

/**
 * «Долго тыкать курсором» — PESTER_CLICKS кликов по бодрой кошке за PESTER_MS. Погладить — это
 * 1–3 клика, и каждый держит сердечко 1,5 с (App.svelte, PETTED_MS); шесть за десять секунд — это
 * уже тыкать, не дожидаясь, пока сердечко погаснет. Меньше — ловило бы обычную ласку.
 */
export const PESTER_CLICKS = 6;
export const PESTER_MS = 10_000;

/** Чем разозлили: результат побудки (sleep.PokeResult) или долгие тычки. */
export type Provocation = 'wake' | 'groggy' | 'angry' | 'leave' | 'pester';
/**
 * Шанс затаить обиду — «не всегда». Выспавшаяся не обижается вовсе; вялая — редко; злая — через
 * раз; ушедшая за край в обиде — почти наверняка, но отомстит, когда вернётся.
 */
export const CHANCE: Record<Provocation, number> = { wake: 0, groggy: 0.1, angry: 0.5, leave: 0.8, pester: 0.4 };

/** Шипит перед тем, как пойти, мс: человек успевает понять, за что. */
export const HISS_MS = 1500;
/** Сидит над лужей, мс; лужа появляется через SPILL_MS и растёт GROW_MS. */
export const SQUAT_MS = 2500;
export const SPILL_MS = 500;
/** Сидит довольная, мс. */
export const SMUG_MS = 2000;
/** К месту идёт решительно, вдвое быстрее обычного шага (как за клубком), прочь — вразвалку, обычным. */
export const STRIDE = 2 * WALK;
/** Не дошла до места или прочь за столько мс — бросает: через весь экран шагом STRIDE — секунд 25. */
export const GIVE_UP = 40_000;
/** Отходит от лужи на столько сторон спрайта. */
export const LEAVE_SIDES = 2.5;

/** Лужа: растёт GROW_MS, живёт от LIFE_MIN до LIFE_MAX от появления до полного исчезновения, последние DRY_MS — сохнет. */
export const GROW_MS = 1500;
export const DRY_MS = 3000;
export const LIFE_MIN = 30_000;
export const LIFE_MAX = 60_000;
/** Кадры лужи в sprite.PUDDLE_FRAMES: растёт 0..2, сохнет 3..4. */
const GROW_FRAMES = 3;
const DRY_FRAMES = 2;

/** Низ окна ближе к полу, чем столько клеток, — кошка мстит с пола, а не с рамки. */
const NEAR_FLOOR = 3;
/** Низ лужи над нижней кромкой окна, клеток: лежит на окне, а не на рамке. */
const INSET = 2;
/** Лужа на полу: низ окна лужи ниже лап на столько клеток — середина лужи у лап, край на панели задач. */
const FLOOR_SINK = 3;

// Имена программ — FileDescription или имя exe (win.rs, Foreground). Сверяем без регистра.
// Часть слов — подстрокой (их не спутать). Запретные короткие — с начала слова: лишний раз
// уйти на пол не страшно, а «alfa» не должно ловить «Kalfa». Браузерные короткие — только
// целым словом: «edge» не должно ловить «Knowledge», «opera» — «Operator».
/** Менеджеры паролей, банки, переписки: сюда не мстит. */
const SECRET_ANY = ['keepass', 'password', 'bitwarden', 'lastpass', 'dashlane', 'enpass', 'nordpass', 'roboform', 'bank', 'банк', 'telegram', 'whatsapp', 'viber', 'skype', 'thunderbird'];
const SECRET_WORD = ['keeper', 'proton', 'sber', 'сбер', 'tinkoff', 'тинькофф', 'alfa', 'альфа', 'vtb', 'втб', 'raiffeisen', 'райффайзен', 'signal', 'discord', 'messenger', 'icq', 'element', 'threema', 'wechat', 'outlook', 'mail', 'почта'];
/** Браузеры: сайт внутри не знаем — лужа на полу. */
const BROWSER_ANY = ['chrome', 'chromium', 'firefox', 'vivaldi', 'browser', 'браузер', 'yandex', 'яндекс', 'waterfox', 'librewolf'];
const BROWSER_WORD = ['msedge', 'edge', 'opera', 'brave', 'safari', 'arc'];

const words = (name: string): string[] => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const matches = (name: string, any: string[], word: string[], whole: boolean): boolean => {
  const low = name.toLowerCase();
  return any.some((w) => low.includes(w)) || words(name).some((t) => word.some((w) => (whole ? t === w : t.startsWith(w))));
};

/**
 * Можно ли мстить в окно этой программы: 'secret' — пароли, банки, переписки; 'browser' — сайт
 * неизвестен; 'unknown' — программа неизвестна (лучше пол, чем чужое окно); 'ok' — можно.
 */
export function kindOf(app: string | null | undefined): 'ok' | 'secret' | 'browser' | 'unknown' {
  if (!app || !app.trim()) return 'unknown';
  if (matches(app, SECRET_ANY, SECRET_WORD, false)) return 'secret';
  if (matches(app, BROWSER_ANY, BROWSER_WORD, true)) return 'browser';
  return 'ok';
}

/** Обида и перезарядка. Хранится только `last`, остальное живёт до перезапуска. */
export interface Revenge {
  /** Когда мстила в последний раз, мс эпохи; 0 — никогда. */
  last: number;
  /** Держит обиду до этого момента; 0 — не держит. */
  grudge: number;
  /** Когда обиделась: отсюда считается PATIENCE. */
  since: number;
  /** Недавние клики по бодрой кошке, мс. */
  clicks: number[];
}

export function fresh(): Revenge {
  return { last: 0, grudge: 0, since: 0, clicks: [] };
}

/** Разбор из хранилища. Время «из будущего» (часы перевели назад) — перезарядка с этого момента, а не на годы вперёд и не мимо. */
export function load(raw: string | null, now: number): Revenge {
  try {
    const last = Number(JSON.parse(raw ?? 'null')?.last);
    if (!Number.isFinite(last) || last <= 0) return fresh();
    return { ...fresh(), last: Math.min(last, now) };
  } catch {
    return fresh();
  }
}

export const save = (r: Revenge): string => JSON.stringify({ last: Math.round(r.last) });

/** Ещё не прошла перезарядка. */
export const cooling = (r: Revenge, now: number): boolean => r.last > 0 && now < r.last + COOLDOWN;
/** Держит обиду. */
export const holds = (r: Revenge, now: number): boolean => r.grudge > now;

const roll = (rnd: () => number): number => Math.min(Math.max(rnd() || 0, 0), 0.999999);
const between = (rnd: () => number, lo: number, hi: number): number => lo + roll(rnd) * (hi - lo);

/**
 * Разозлили. Бросок шанса — сразу: обида или есть, или её нет. Не в «Шалостях», на перезарядке
 * или уже обижена — ничего не меняется (обиду не продлевают: она и так полчаса).
 */
export function provoke(r: Revenge, kind: Provocation, now: number, rnd: () => number, mode: string): Revenge {
  if (mode !== 'pranks' || cooling(r, now) || holds(r, now)) return r;
  if (roll(rnd) >= CHANCE[kind]) return r;
  return { ...r, grudge: now + GRUDGE_MS, since: now };
}

/** Клик по бодрой кошке (погладили). Набралось PESTER_CLICKS за PESTER_MS — это уже тычки, счёт сначала. */
export function poked(r: Revenge, now: number, rnd: () => number, mode: string): Revenge {
  const clicks = [...r.clicks.filter((t) => now - t < PESTER_MS && t <= now), now];
  if (clicks.length < PESTER_CLICKS) return { ...r, clicks };
  return provoke({ ...r, clicks: [] }, 'pester', now, rnd, mode);
}

/** Месть из трея dev-сборки: обида сразу, без шанса, перезарядки и ожидания важной программы. */
export const dare = (r: Revenge, now: number): Revenge => ({ ...r, last: 0, grudge: now + GRUDGE_MS, since: now - PATIENCE });

/** Можно ли сейчас вообще: только «Шалости», человеку можно мешать (quiet 'no'), не на созвоне. */
export interface Gate {
  mode: string;
  quiet?: string;
  call?: boolean;
}
export const allowed = (g: Gate): boolean => g.mode === 'pranks' && g.quiet === 'no' && !g.call;

/**
 * Пора мстить: можно, обида есть, перезарядка прошла, и человек в самой важной программе дня —
 * или ждать её надоело (PATIENCE).
 */
export function ready(r: Revenge, now: number, gate: Gate, important: boolean): boolean {
  return allowed(gate) && holds(r, now) && !cooling(r, now) && (important || now - r.since >= PATIENCE);
}

/** Месть началась: обида израсходована, перезарядка пошла. */
export const begin = (r: Revenge, now: number): Revenge => ({ ...r, last: now, grudge: 0, since: 0, clicks: [] });

/** Рамка окна по hwnd: из кусков кромок или полос развёрнутых окон. */
export function frameOf(world: World, hwnd: number): Rect | null {
  return world.ledges.find((l) => l.hwnd === hwnd)?.frame ?? world.strips?.find((l) => l.hwnd === hwnd)?.frame ?? null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const fit = (v: number, lo: number, hi: number): number => (lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2);
const cellOf = (m: Monitor): number => side(m) / SIZE;
const overlap = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Центр экрана — средняя треть по обеим осям: его лужа не закрывает никогда. */
function center(m: Monitor): Rect {
  const w = m.work;
  const dx = (w.right - w.left) / 3;
  const dy = (w.bottom - w.top) / 3;
  return { left: w.left + dx, top: w.top + dy, right: w.right - dx, bottom: w.bottom - dy };
}

/** Прямоугольник полной лужи с серединой x и низом bottom, физ. px. */
function puddleRect(x: number, bottom: number, cell: number): Rect {
  const half = (PUDDLE_W / 2) * cell;
  return { left: x - half, top: bottom - PUDDLE_H * cell, right: x + half, bottom };
}

/** Лужа на окне: hwnd и смещение середины от левого края рамки и низа от нижнего. */
export interface Target {
  hwnd: number;
  dx: number;
  dyb: number;
}

/** Куда идти и куда лить: target null — лужа под кошкой. */
export interface Aim {
  spot: Goal;
  target: Target | null;
}

/** Пол монитора: id поверхности и x, не ближе края, чем встаёт кошка. */
function floorSpot(world: World, i: number, x: number): Goal {
  const m = world.monitors[i];
  const half = side(m) / 2 + EDGE_GAP;
  return { surface: `floor:${i}`, x: fit(x, m.work.left + half, m.work.right - half) };
}

/**
 * Где мстить. В активное окно — если оно есть, программа не из запретных и не браузер, окно
 * вдвое больше лужи и лужа ляжет в его нижней части, не задев центр экрана. Кошка тогда идёт
 * на пол под лужей (низ окна у пола), на ближайший кусок верхней кромки этого окна или, если
 * туда не забраться, на пол поближе. Иначе — лужа на полу рядом с кошкой.
 */
export function aim(world: World, pet: Pet, app: string | null | undefined): Aim | null {
  const home = monitorOf(world, pet);
  if (!home) return null;
  const hi = world.monitors.indexOf(home);
  const floor: Aim = { spot: floorSpot(world, hi, pet.x), target: null };
  if (world.active == null || kindOf(app) !== 'ok') return floor;
  const hwnd = world.active;
  const f = frameOf(world, hwnd);
  if (!f) return floor;
  // монитор под низом окна, ближе к кошке; окно целиком за экраном — пол
  const probe = clamp(pet.x, f.left, f.right - 1);
  const mi = world.monitors.findIndex((m) => inRect(m.rect, probe, f.bottom - 1));
  const m = world.monitors[mi];
  if (!m) return floor;
  const cell = cellOf(m);
  if (f.right - f.left < 2 * PUDDLE_W * cell || f.bottom - f.top < 2 * PUDDLE_H * cell) return floor;

  const bottom = Math.min(f.bottom, m.work.bottom) - INSET * cell;
  const half = (PUDDLE_W / 2 + INSET) * cell;
  const lo = Math.max(f.left, m.work.left) + half;
  const right = Math.min(f.right, m.work.right) - half;
  if (lo > right) return floor;
  // поближе к кошке; задевает центр — к ближнему краю окна, потом к дальнему
  const near = clamp(pet.x, lo, right);
  const edges = Math.abs(pet.x - lo) <= Math.abs(pet.x - right) ? [lo, right] : [right, lo];
  const mid = center(m);
  const x = [near, ...edges].find((c) => !overlap(puddleRect(c, bottom, cell), mid));
  if (x === undefined) return floor;
  const target: Target = { hwnd, dx: x - f.left, dyb: bottom - f.bottom };

  if (m.work.bottom - f.bottom <= NEAR_FLOOR * cell) return { spot: floorSpot(world, mi, x), target };
  const ledges = surfaces(world).filter((s) => s.kind === 'ledge' && !s.strip && s.hwnd === hwnd);
  const dist = (s: { left: number; right: number }) => (x < s.left ? s.left - x : x >= s.right ? x - s.right + 1 : 0);
  const ledge = ledges.reduce<(typeof ledges)[number] | null>((a, b) => (a === null || dist(b) < dist(a) ? b : a), null);
  if (!ledge) return { spot: floorSpot(world, mi, x), target };
  const s = side(world.monitors[ledge.monitor]) / 2 + EDGE_GAP;
  return { spot: { surface: ledge.id, x: fit(x, ledge.left + s, ledge.right - s) }, target };
}

/** Лужа на экране, физ. px: середина и низ её окна; hwnd — окно, за которым она едет. */
export interface Puddle {
  x: number;
  bottom: number;
  hwnd: number | null;
  dx: number;
  dyb: number;
  /** Появляется, мс. */
  born: number;
  /** Начинает сохнуть, мс; через DRY_MS исчезает. */
  dry: number;
}

/**
 * Налить: на окно цели, если оно ещё есть, иначе под кошку (на окне-насесте — едет с ним).
 * Сколько проживёт — случайно, от LIFE_MIN до LIFE_MAX.
 */
export function spill(world: World, pet: Pet, target: Target | null, now: number, rnd: () => number): Puddle | null {
  const m = monitorOf(world, pet);
  if (!m) return null;
  const born = now + SPILL_MS;
  const dry = born + between(rnd, LIFE_MIN, LIFE_MAX) - DRY_MS;
  const f = target && frameOf(world, target.hwnd);
  if (target && f) return { x: f.left + target.dx, bottom: f.bottom + target.dyb, hwnd: target.hwnd, dx: target.dx, dyb: target.dyb, born, dry };
  const x = pet.x;
  const bottom = pet.y + FLOOR_SINK * cellOf(m);
  const perch = pet.hwnd !== null ? frameOf(world, pet.hwnd) : null;
  if (pet.hwnd !== null && perch) return { x, bottom, hwnd: pet.hwnd, dx: x - perch.left, dyb: bottom - perch.bottom, born, dry };
  return { x, bottom, hwnd: null, dx: 0, dyb: 0, born, dry };
}

/** Высохнуть сейчас (если ещё не сохнет): окно закрыли, загородили, начался созвон. */
export const dryUp = (p: Puddle, now: number): Puddle => (p.dry <= now ? p : { ...p, dry: now });

/**
 * Окно лужи загородило окно выше по z-order: куски кромок в мире идут сверху вниз, значит,
 * все окна, чьи куски стоят раньше первого куска нашего, — выше него. Развёрнутое окно (только
 * полоса заголовка) загородить почти некому — не проверяем.
 */
function covered(world: World, p: Puddle, cell: number): boolean {
  const i = world.ledges.findIndex((l) => l.hwnd === p.hwnd);
  if (i < 0) return false;
  const y = p.bottom - (PUDDLE_H / 2) * cell;
  return world.ledges.slice(0, i).some((l) => l.hwnd !== p.hwnd && inRect(l.frame, p.x, y));
}

/** Лужа едет за своим окном; окно пропало или его загородили — быстро сохнет. */
export function follow(p: Puddle, world: World, now: number): Puddle {
  if (p.hwnd === null) return p;
  const f = frameOf(world, p.hwnd);
  if (!f) return { ...dryUp(p, now), hwnd: null };
  const moved = { ...p, x: f.left + p.dx, bottom: f.bottom + p.dyb };
  const m = world.monitors.find((mm) => inRect(mm.rect, moved.x, moved.bottom - 1));
  if (m && covered(world, moved, cellOf(m))) return dryUp(moved, now);
  return moved;
}

/** Кадр лужи в sprite.PUDDLE_FRAMES на сейчас; null — ещё нет или уже высохла. */
export function stage(p: Puddle, now: number): number | null {
  if (now < p.born) return null;
  // сохнет раньше, чем доросла (окно закрыли сразу) — сразу с полной
  if (now < p.dry) return now < p.born + GROW_MS ? Math.floor(((now - p.born) / GROW_MS) * GROW_FRAMES) : GROW_FRAMES - 1;
  if (now < p.dry + DRY_MS) return GROW_FRAMES + Math.floor(((now - p.dry) / DRY_MS) * DRY_FRAMES);
  return null;
}

/** Высохла совсем: можно забыть. */
export const gone = (p: Puddle, now: number): boolean => now >= p.dry + DRY_MS;

/** Что слать окну "puddle": середина, низ, кадр; null — пусто. */
export function view(p: Puddle | null, now: number): { x: number; bottom: number; frame: number } | null {
  if (!p) return null;
  const frame = stage(p, now);
  return frame === null ? null : { x: Math.round(p.x), bottom: Math.round(p.bottom), frame };
}

/**
 * hiss — шипит на месте; go — идёт к месту; squat — сидит над лужей; smug — довольна;
 * leave — уходит прочь вразвалку; done — всё, кошкой снова правит приложение.
 */
export type Phase = 'hiss' | 'go' | 'squat' | 'smug' | 'leave' | 'done';

export interface Mission {
  phase: Phase;
  /** Срок фазы, мс. */
  t: number;
  spot: Goal;
  target: Target | null;
}

/** Начать месть: выбрать место и зашипеть в его сторону. Мира нет — null. */
export function start(world: World, pet: Pet, app: string | null | undefined, now: number): [Mission, Pet] | null {
  const a = aim(world, pet, app);
  if (!a) return null;
  const facing: 1 | -1 = a.spot.x > pet.x ? 1 : a.spot.x < pet.x ? -1 : pet.facing;
  return [{ phase: 'hiss', t: now + HISS_MS, spot: a.spot, target: a.target }, { ...pet, facing }];
}

/** Кошкой правит месть. */
export const owns = (m: Mission | null): boolean => m !== null && m.phase !== 'done';

/**
 * Один кадр мести. Возвращает новую лужу в тот кадр, когда кошка присела (иначе null): лужа
 * живёт дольше мести, её хранит приложение.
 */
export function tick(m: Mission, world: World, pet: Pet, now: number, dt: number, rnd: () => number): [Mission, Pet, RoamEvent | null, Puddle | null] {
  if (m.phase === 'done') return [m, pet, null, null];
  let e: RoamEvent | null;
  [pet, e] = step(pet, world, dt, m.phase === 'go' ? STRIDE : WALK);
  if (pet.move === 'out') return [{ ...m, phase: 'done' }, pet, e, null];
  const stopped = pet.move === 'still' && !pet.goal;
  switch (m.phase) {
    case 'hiss':
      if (now < m.t) break;
      return [{ ...m, phase: 'go', t: now + GIVE_UP }, goTo(pet, world, m.spot), e, null];
    case 'go':
      // дошла; или идти некуда (место пропало) — тогда прямо здесь
      if (e === 'arrived' || stopped) return [{ ...m, phase: 'squat', t: now + SQUAT_MS }, pet, e, spill(world, pet, m.target, now, rnd)];
      if (now >= m.t) return [{ ...m, phase: 'done' }, pet, e, null];
      break;
    case 'squat':
      if (now >= m.t) return [{ ...m, phase: 'smug', t: now + SMUG_MS }, pet, e, null];
      break;
    case 'smug':
      if (now >= m.t) return [{ ...m, phase: 'leave', t: now + GIVE_UP }, stepAside(pet, world, LEAVE_SIDES), e, null];
      break;
    case 'leave':
      if (e === 'arrived' || stopped || now >= m.t) return [{ ...m, phase: 'done' }, pet, e, null];
      break;
  }
  return [m, pet, e, null];
}

/** Месть прервали (взяли на руки, лазер, созвон, «не мешать»): кошкой дальше правит приложение. */
export const drop = (m: Mission): Mission => ({ ...m, phase: 'done' });

/** Поза: шипит, идёт, сидит над лужей, довольная, уходит вразвалку; null — за краем. */
export function pose(m: Mission, pet: Pet): 'angry' | 'stand' | 'walk' | 'jump' | 'fall' | 'squat' | 'smug' | 'strut' | null {
  if (pet.move === 'out') return null;
  if (pet.move === 'jump' || pet.move === 'fall') return pet.move;
  const walking = pet.move === 'walk';
  switch (m.phase) {
    case 'hiss':
      return 'angry';
    case 'go':
      return walking ? 'walk' : 'stand';
    case 'squat':
      return 'squat';
    case 'smug':
      return 'smug';
    default:
      return walking ? 'strut' : 'smug';
  }
}
