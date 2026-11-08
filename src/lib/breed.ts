// Характер окраса: четыре черты — сонливость, разговорчивость, игривость, обидчивость. Каждая —
// мягкий множитель около 1, им подкручиваются числа, которые и так живут в sleep.ts, chatter.ts,
// revenge.ts и App.svelte (клубок, мышь). Серая полосатая — та кошка, что была всегда: у неё
// все черты ровно 1, и поведение не меняется ни на миллисекунду.
// Палитры окрасов — в coat.ts; здесь только числа и подписи.

import { t } from './i18n';
import type { Breed } from './settings';

/** Множители черт. Больше 1 — черты больше: дольше спит, чаще болтает, чаще играет, легче обижается. */
export interface Traits {
  sleepy: number;
  talky: number;
  playful: number;
  touchy: number;
}

/** Пределы множителя: характер окрашивает поведение, но не ломает баланс. */
export const SOFT_MIN = 0.7;
export const SOFT_MAX = 1.4;

export const TRAITS: Record<Breed, Traits> = {
  tabby: { sleepy: 1, talky: 1, playful: 1, touchy: 1 },
  // рыжая — непоседа: играет чаще, спит меньше, зла не держит
  ginger: { sleepy: 0.85, talky: 1.1, playful: 1.35, touchy: 0.8 },
  // чёрная — гордая соня: молчит, спит подольше, обиду помнит
  black: { sleepy: 1.2, talky: 0.75, playful: 1.05, touchy: 1.25 },
  // смокинг — болтушка с манерами
  tuxedo: { sleepy: 0.95, talky: 1.35, playful: 1, touchy: 1.1 },
  // трёхцветная — с норовом: обижается легче всех, зато ласковая и разговорчивая
  calico: { sleepy: 1.1, talky: 1.15, playful: 0.9, touchy: 1.35 },
};

/** Черты окраса; неизвестный окрас — как серая. */
export function traits(b: Breed | string): Traits {
  return TRAITS[b as Breed] ?? TRAITS.tabby;
}

/** Множитель в пределах SOFT_MIN..SOFT_MAX; не число — 1, то есть «как всегда». */
export function soft(k: unknown): number {
  if (typeof k !== 'number' || !Number.isFinite(k)) return 1;
  return Math.min(Math.max(k, SOFT_MIN), SOFT_MAX);
}

/**
 * Промежуток между случайными репликами с поправкой на разговорчивость. Болтушка говорит чаще,
 * но не чаще нижней границы уровня (10 минут у «иногда»): верх диапазона сжимается к низу.
 * Молчаливая растягивает обе границы — не больше чем в 1/SOFT_MIN раза.
 */
export function talkRange([lo, hi]: readonly [number, number], talky: number): [number, number] {
  const k = soft(talky);
  const from = Math.max(lo, lo / k);
  return [from, Math.max(from, hi / k)];
}

/** Перерыв до следующей игры (мышь, клубок): игривая зовёт играть чаще. */
export const playGap = (gap: number, playful: number): number => gap / soft(playful);

/** Самый большой шанс затаить обиду: «не всегда» остаётся даже у самой обидчивой. */
export const CHANCE_MAX = 0.95;

/** Шанс обиды с поправкой на обидчивость. Нулевой (выспавшаяся) так и остаётся нулём. */
export const grudgeChance = (base: number, touchy: number): number => Math.min(base * soft(touchy), Math.max(base, CHANCE_MAX));

/**
 * Сколько помнит обиду. Не короче `floor`: месть после ухода за край должна дожить до возвращения
 * (revenge.ts передаёт запас над сном за краем).
 */
export const grudgeMs = (base: number, touchy: number, floor: number): number => Math.max(base * soft(touchy), Math.min(base, floor));

/** Название окраса для человека. */
export function breedName(b: Breed): string {
  const names: Record<Breed, [string, string]> = {
    tabby: ['Серая полосатая', 'Grey tabby'],
    ginger: ['Рыжая', 'Ginger'],
    black: ['Чёрная', 'Black'],
    tuxedo: ['Смокинг', 'Tuxedo'],
    calico: ['Трёхцветная', 'Calico'],
  };
  return t(...names[b]);
}

/** Характер одной строкой — подпись под выбором окраса. */
export function temper(b: Breed): string {
  const lines: Record<Breed, [string, string]> = {
    tabby: ['всего в меру: спит, играет и болтает как обычно', 'a bit of everything: sleeps, plays and chats as usual'],
    ginger: ['непоседа: играет чаще, спит меньше, зла не держит', 'a fidget: plays more, naps less, never holds a grudge'],
    black: ['гордая соня: больше спит, реже болтает, обиду помнит', 'a proud sleepyhead: naps more, talks less, remembers slights'],
    tuxedo: ['болтушка с манерами: заговаривает чаще остальных', 'a well-mannered chatterbox: talks more than the rest'],
    calico: ['с норовом: разговорчивая, но обижается легче всех', 'feisty: chatty, but the quickest to take offense'],
  };
  return t(...lines[b]);
}
