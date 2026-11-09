// Помодоро-компаньон. Человек включает «Фокус N минут» из меню кошки или трея — кошка засыпает на
// таймере рядом с песочными часами (hourglass.ts) и ничего не затевает: не болтает, не играет, не
// мстит, побудками её не поднять. Время вышло — просыпается, потягивается и зовёт на перерыв.
// Перерыв — пятая часть фокуса без занудства; следующий фокус включает человек, по кругу сами не идут.
// Длину выбирают ползунком прямо в меню (от минуты до трёх часов), она запоминается в настройках
// (focusMin); сам фокус живёт только в памяти: перезапуск программы его сбрасывает.

import { t } from './i18n';
import { MAX_STEP_MS } from './hunger';
import type { MenuSlider } from './menu';
import type { Sleep } from './sleep';

const MIN = 60_000;

/** Длина фокуса по умолчанию, минут: классический помодоро. */
export const FOCUS_MIN = 25;
/** Ползунок длины: от минуты (попробовать, как оно) до трёх часов (долгая глубокая работа). */
export const FOCUS_MIN_LO = 1;
export const FOCUS_MIN_HI = 180;

/** Длина в минутах из чего угодно (настройки с диска, событие трея): целая и в пределах ползунка. */
export function focusMinutes(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return FOCUS_MIN;
  return Math.min(FOCUS_MIN_HI, Math.max(FOCUS_MIN_LO, Math.round(n)));
}

/**
 * Перерыв после фокуса, мс — пятая часть, как 25 → 5 у классики. Не меньше минуты: после короткого
 * фокуса перерыв не должен кончиться, едва облачко показалось; не больше получаса: после трёх часов
 * отдых нужен, но час без дела — уже не перерыв. Считается с облачка, когда человек его увидел.
 */
export function breakMs(minutes: number): number {
  return Math.min(30, Math.max(1, Math.round(focusMinutes(minutes) / 5))) * MIN;
}
/** Столько потягивается, проснувшись: два раза зевнуть. */
export const STRETCH_MS = 5400;
/**
 * Столько облачко «Перерыв!» ждёт, пока человеку не до него (созвон, игра на весь экран, отошёл).
 * Не дождалось — перерыв молча кончается: напоминать через час о прошлом фокусе незачем.
 */
export const OFFER_WAIT_MS = 30 * MIN;

/** Фокус идёт; потягивается после него; перерыв (облачко ещё ждёт или уже показано). */
export type Phase = 'focus' | 'stretch' | 'break';

export interface Pomodoro {
  phase: Phase;
  /** Когда началась фаза. */
  since: number;
  /** Когда она кончится. */
  until: number;
  /** Облачко «Перерыв!» показано. */
  offered: boolean;
  /** Длина фокуса, минут: от неё считается перерыв, поэтому переходит из фазы в фазу. */
  minutes: number;
}

/** Что случилось на шаге: фокус кончился, потянулась, перерыв прошёл. */
export type PomodoroEvent = 'done' | 'stretched' | 'over';

/** Начать фокус длиной `minutes` (поправляется в пределы ползунка). */
export function start(now: number, minutes: number = FOCUS_MIN): Pomodoro {
  const m = focusMinutes(minutes);
  return { phase: 'focus', since: now, until: now + m * MIN, offered: false, minutes: m };
}

export const focusing = (p: Pomodoro | null): boolean => p?.phase === 'focus';

/**
 * Один шаг по часам. Фокус → потягушки → перерыв → ничего (null). Перерыв длится OFFER_WAIT_MS,
 * пока облачко не показано, и breakMs с момента показа. Вход не трогает.
 */
export function step(p: Pomodoro | null, now: number): [Pomodoro | null, PomodoroEvent | null] {
  if (!p || now < p.until) return [p, null];
  const { minutes } = p;
  if (p.phase === 'focus') return [{ phase: 'stretch', since: now, until: now + STRETCH_MS, offered: false, minutes }, 'done'];
  if (p.phase === 'stretch') return [{ phase: 'break', since: now, until: now + OFFER_WAIT_MS, offered: false, minutes }, 'stretched'];
  return [null, 'over'];
}

/** Облачко пора показать: перерыв начался, а его ещё не видели. Можно ли мешать — решает App. */
export const offerDue = (p: Pomodoro | null): boolean => p?.phase === 'break' && !p.offered;

/**
 * Фокус кончился, облачко ещё не показано: кошка не засыпает. Иначе после короткого фокуса
 * (не доспала RESTED_MS) или при замершем у экрана человеке (humanIdle) она уснёт на следующем
 * же кадре, а «Перерыв!» ждёт бодрую — и перерыв тихо истечёт. Позвала — дальше как обычно:
 * сонная может и уснуть.
 */
export const awaiting = (p: Pomodoro | null): boolean => p?.phase === 'stretch' || offerDue(p);

/** Облачко показали: с этой минуты перерыв — пятая часть фокуса (breakMs). */
export function offered(p: Pomodoro, now: number): Pomodoro {
  return { ...p, offered: true, until: now + breakMs(p.minutes) };
}

/** Сколько песка пересыпалось, 0…1; вне фокуса — 0. */
export function progress(p: Pomodoro | null, now: number): number {
  if (!p || p.phase !== 'focus') return 0;
  return Math.min(1, Math.max(0, (now - p.since) / (p.until - p.since)));
}

/** Минут до конца фазы, с округлением вверх: «ещё 1 мин» до самого конца, не «ещё 0». */
export function minutesLeft(p: Pomodoro, now: number): number {
  return Math.max(1, Math.ceil((p.until - now) / MIN));
}

/**
 * Засыпает на таймере. Бодрая засыпает сразу; вялая или злая спросонья — тоже, без новых обид:
 * побудки (`wakes`) остаются как были, сон продолжается. Ушедшую за край не трогаем — у неё свой счёт.
 */
export function lull(s: Sleep): Sleep {
  if (s.away > 0 || (s.asleep && s.cranky <= 0)) return s;
  return { ...s, asleep: true, cranky: 0, slept: s.cranky > 0 ? s.slept : 0 };
}

/**
 * Сон на таймере копится, как обычный, но сам не будит: обычный сон кончается через NAP_MS,
 * а фокус длиннее. Будит конец фокуса — sleep.stir: поспала RESTED_MS — сон засчитан полным.
 */
export function doze(s: Sleep, ms: number): Sleep {
  if (!s.asleep || s.cranky > 0 || s.away > 0) return s;
  return { ...s, slept: s.slept + (Math.min(Math.max(ms, 0), MAX_STEP_MS) || 0) };
}

/** Тык по спящей на таймере: не будит, а говорит, сколько осталось. */
export function leftLine(p: Pomodoro, now: number): string {
  const m = minutesLeft(p, now);
  return t(`Тс-с, фокус. Ещё ${m} мин`, `Shh, focus. ${m} min left`);
}

/** Облачко после фокуса. Голодная сначала просит есть — весь фокус проспала, а миска сама не наполнится. */
export function offerLine(hungry: boolean): string {
  return hungry ? t('Перерыв! Покормишь — и поиграем?', 'Break time! Feed me, then play?') : t('Перерыв! Поиграем?', 'Break time! Shall we play?');
}

/** Кнопка в облачке «Перерыв!»: включает лазерную указку. */
export const offerAct = (): string => t('Лазер', 'Laser');

/**
 * Текст пункта «Фокус N минут» шаблоном для окна меню (lib/menu.ts, fill): число подставляет само
 * окно, пока тянут ползунок. Тот же шаблон у трея в Rust (lib.rs, tray_items).
 */
export const focusText = (): string => t('Фокус {n} {минута|минуты|минут}', 'Focus for {n} {minute|minutes}');

/** Пункт «Фокус» с ползунком «Таймер» или «Отменить фокус» с остатком — что положить в меню. */
export interface FocusEntry {
  id: 'focus' | 'focus-cancel';
  text: string;
  hint: string;
  slider?: MenuSlider;
}

/**
 * Пункт меню (кошки и трея): включить фокус или отменить идущий. Пока фокуса нет — под пунктом
 * ползунок «Таймер» с прошлой длиной `minutes`: повторить — один клик, другая длина — сдвинуть и
 * кликнуть. Выбор приходит как «focus:40» (lib/menu.ts, picked).
 */
export function menuEntry(p: Pomodoro | null, now: number, minutes: number = FOCUS_MIN): FocusEntry {
  if (p?.phase === 'focus') {
    const m = minutesLeft(p, now);
    return { id: 'focus-cancel', text: t('Отменить фокус', 'Cancel focus'), hint: t(`ещё ${m} мин`, `${m} min left`) };
  }
  const slider = { min: FOCUS_MIN_LO, max: FOCUS_MIN_HI, value: focusMinutes(minutes), label: t('Таймер', 'Timer') };
  if (p?.phase === 'break' && p.offered) {
    const m = minutesLeft(p, now);
    return { id: 'focus', text: focusText(), hint: t(`перерыв: ещё ${m} мин`, `break: ${m} min left`), slider };
  }
  return { id: 'focus', text: focusText(), hint: t('кошка поспит на таймере', 'the cat naps on a timer'), slider };
}
