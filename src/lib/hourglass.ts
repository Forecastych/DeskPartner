// Помодоро в кадре: кошка спит калачиком, сдвинувшись влево, а справа от неё стоят песочные часы.
// Песок пересыпается по ходу фокуса — сколько осталось, видно без цифр и без облачка.
// Часы нарисованы ключами палитры G/Q/S и кликабельны: тык по ним — тот же тык по кошке.

import { inBed, SIZE, type Frame } from './sprite';

/** Песочные часы 5×9: донца, верхняя колба, горлышко (ряд 4), нижняя колба. */
const GLASS: string[] = [
  'GGGGG',
  'kQQQk',
  'kQQQk',
  '.kQk.',
  '.kQk.',
  '.kQk.',
  'kQQQk',
  'kQQQk',
  'GGGGG',
];

/** Клетки песка в верхней колбе — сверху вниз: убывает первым верх. */
const TOP: [number, number][] = [[1, 1], [3, 1], [2, 1], [1, 2], [3, 2], [2, 2], [2, 3]];
/** Клетки нижней колбы — снизу вверх: горка растёт со дна. */
const BOTTOM: [number, number][] = [[2, 7], [1, 7], [3, 7], [1, 6], [3, 6], [2, 6], [2, 5]];
/** Горлышко: пока песок сыплется, в нём струйка. */
const NECK: [number, number] = [2, 4];

/** Насколько калачик отодвигается влево, чтобы часы встали справа: хвост доходит до края кадра. */
export const SHIFT = 4;
/** Левый столбец часов в кадре. */
export const GLASS_X = 26;

/** Песочные часы при данном прогрессе 0…1: сколько песка уже внизу. */
export function glass(progress: number): string[] {
  const p = Math.min(1, Math.max(0, progress));
  const fell = Math.round(p * TOP.length);
  const g = GLASS.map((r) => [...r]);
  TOP.slice(fell).forEach(([x, y]) => (g[y][x] = 'S'));
  BOTTOM.slice(0, fell).forEach(([x, y]) => (g[y][x] = 'S'));
  if (p > 0 && p < 1) g[NECK[1]][NECK[0]] = 'S';
  return g.map((r) => r.join(''));
}

/** Сдвинуть кадр влево на `dx` клеток; что ушло за край — пропадает. */
function shiftLeft(frame: Frame, dx: number): Frame {
  return frame.map((r) => r.slice(dx) + '.'.repeat(dx));
}

/** Нарисовать деталь поверх кадра; '.' не закрашивает. */
function stamp(frame: Frame, part: string[], x: number, y: number): Frame {
  const g = frame.map((r) => [...r]);
  part.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++)
      if (row[dx] !== '.' && y + dy >= 0 && y + dy < SIZE && x + dx < SIZE) g[y + dy][x + dx] = row[dx];
  });
  return g.map((r) => r.join(''));
}

/**
 * Кадр «спит на таймере» из кадров калачика `sleep`: дышит как обычно, но хвост — всегда из первого
 * кадра (ряды 28…31), чтобы не качался. Калачик сдвинут влево на SHIFT, часы стоят на ряду 27 —
 * там же, где лежит её живот. В лежаке калачик укладывается в подушку, а часы встают за передним
 * бортиком на подушку. Вход не трогает.
 */
export function focusFrame(sleep: readonly Frame[], tick: number, progress: number, bed: boolean): Frame {
  const now = sleep[tick % sleep.length];
  const still = [...now.slice(0, 28), ...sleep[0].slice(28)];
  const cat = shiftLeft(still, SHIFT);
  const g = glass(progress);
  return bed ? stamp(inBed(cat), g, GLASS_X, 27 - g.length) : stamp(cat, g, GLASS_X, 28 - g.length);
}
