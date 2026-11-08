// «Филя муху съел»: очень редко кошка замечает муху, следит за ней, щёлкает пастью, жуёт — и
// объявляет об этом как о срочной новости. Сначала облачко «Срочно!», потом сама новость, а кошка
// сидит, довольно прищурившись. Только когда человек на паузе и кошка ничем не занята.
//
// Чистые функции: без DOM и часов, `now` и `rnd` — параметрами. Сценка — просто время начала:
// стадия считается от него, кошка всё это время сидит на месте.

import { t } from './i18n';

const HOUR = 3_600_000;

/** В среднем раз во столько активного времени (пока человек на паузе и кошка свободна). */
export const MEAN_MS = 25 * HOUR;
/** И не чаще, чем раз во столько. */
export const MIN_GAP = 6 * HOUR;

/** Длительность стадий, мс: следит за мухой, щёлкает, жуёт, «Срочно!», новость с прищуром. */
export const STAGES = [
  ['watch', 4000],
  ['snap', 600],
  ['chew', 1800],
  ['urgent', 3000],
  ['tell', 6000],
] as const;

export type Stage = (typeof STAGES)[number][0] | 'done';

/** Длительность стадии, мс. */
export const ms = (s: Stage) => STAGES.find(([n]) => n === s)?.[1] ?? 0;

/** Вся сценка от первой мухи до конца новости, мс. */
export const TOTAL_MS = STAGES.reduce((s, [, ms]) => s + ms, 0);

/** Стадия сценки, начатой в `at`. */
export function stage(at: number, now: number): Stage {
  let end = at;
  for (const [s, ms] of STAGES) if (now < (end += ms)) return s;
  return 'done';
}

/**
 * Пора ли: между проверками прошло `dt` мс подходящего времени. Вероятность — как у события,
 * которое случается в среднем раз в MEAN_MS; после прошлой мухи (`last`) — не раньше MIN_GAP.
 */
export function due(last: number, now: number, dt: number, rnd: () => number): boolean {
  if (last && now - last < MIN_GAP) return false;
  return rnd() < 1 - Math.exp(-Math.max(dt, 0) / MEAN_MS);
}

/** Поза на стадии. */
export function pose(s: Exclude<Stage, 'done'>): 'flyWatch' | 'snap' | 'chew' | 'announce' | 'squint' {
  switch (s) {
    case 'watch':
      return 'flyWatch';
    case 'snap':
      return 'snap';
    case 'chew':
      return 'chew';
    case 'urgent':
      return 'announce';
    case 'tell':
      return 'squint';
  }
}

/** Что сказать в начале стадии; null — молчит. С именем — о себе в третьем лице, как в новостях. */
export function line(s: Stage, name: string): string | null {
  if (s === 'urgent') return t('Срочно!', 'URGENT!');
  if (s !== 'tell') return null;
  const who = name.trim();
  return who ? t(`${who} муху съела.`, `${who} ate a fly.`) : t('Я муху съела.', 'I ate a fly.');
}
