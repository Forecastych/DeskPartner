// Помодоро-компаньон. Человек включает «Фокус 25 минут» из меню кошки или трея — кошка засыпает на
// таймере рядом с песочными часами (hourglass.ts) и ничего не затевает: не болтает, не играет, не
// мстит, побудками её не поднять. Время вышло — просыпается, потягивается и зовёт на перерыв.
// Перерыв — пять минут без занудства; следующий фокус включает человек, по кругу сами не идут.
// Фокус живёт только в памяти: перезапуск программы его сбрасывает.

import { t } from './i18n';
import { MAX_STEP_MS } from './hunger';
import type { Sleep } from './sleep';

const MIN = 60_000;

/** Длина фокуса. */
export const FOCUS_MS = 25 * MIN;
/** Перерыв после фокуса — считается с облачка, когда человек его увидел. */
export const BREAK_MS = 5 * MIN;
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
}

/** Что случилось на шаге: фокус кончился, потянулась, перерыв прошёл. */
export type PomodoroEvent = 'done' | 'stretched' | 'over';

export function start(now: number): Pomodoro {
  return { phase: 'focus', since: now, until: now + FOCUS_MS, offered: false };
}

export const focusing = (p: Pomodoro | null): boolean => p?.phase === 'focus';

/**
 * Один шаг по часам. Фокус → потягушки → перерыв → ничего (null). Перерыв длится OFFER_WAIT_MS,
 * пока облачко не показано, и BREAK_MS с момента показа. Вход не трогает.
 */
export function step(p: Pomodoro | null, now: number): [Pomodoro | null, PomodoroEvent | null] {
  if (!p || now < p.until) return [p, null];
  if (p.phase === 'focus') return [{ phase: 'stretch', since: now, until: now + STRETCH_MS, offered: false }, 'done'];
  if (p.phase === 'stretch') return [{ phase: 'break', since: now, until: now + OFFER_WAIT_MS, offered: false }, 'stretched'];
  return [null, 'over'];
}

/** Облачко пора показать: перерыв начался, а его ещё не видели. Можно ли мешать — решает App. */
export const offerDue = (p: Pomodoro | null): boolean => p?.phase === 'break' && !p.offered;

/** Облачко показали: с этой минуты пять минут перерыва. */
export function offered(p: Pomodoro, now: number): Pomodoro {
  return { ...p, offered: true, until: now + BREAK_MS };
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

/** Облачко после фокуса. Голодная сначала просит есть — полчаса проспала, а миска сама не наполнится. */
export function offerLine(hungry: boolean): string {
  return hungry ? t('Перерыв! Покормишь — и поиграем?', 'Break time! Feed me, then play?') : t('Перерыв! Поиграем?', 'Break time! Shall we play?');
}

/** Кнопка в облачке «Перерыв!»: включает лазерную указку. */
export const offerAct = (): string => t('Лазер', 'Laser');

/** Пункт меню (кошки и трея): включить фокус или отменить идущий. */
export function menuEntry(p: Pomodoro | null, now: number): { id: 'focus' | 'focus-cancel'; text: string; hint: string } {
  if (p?.phase === 'focus') {
    const m = minutesLeft(p, now);
    return { id: 'focus-cancel', text: t('Отменить фокус', 'Cancel focus'), hint: t(`ещё ${m} мин`, `${m} min left`) };
  }
  if (p?.phase === 'break' && p.offered) {
    const m = minutesLeft(p, now);
    return { id: 'focus', text: t('Фокус 25 минут', 'Focus for 25 minutes'), hint: t(`перерыв: ещё ${m} мин`, `break: ${m} min left`) };
  }
  return { id: 'focus', text: t('Фокус 25 минут', 'Focus for 25 minutes'), hint: t('кошка поспит на таймере', 'the cat naps on a timer') };
}
