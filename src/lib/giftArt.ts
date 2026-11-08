// Подарок на 100 дней, нарисованный попиксельно: мышка, которую кошка приносит и кладёт рядом,
// и та же мышка у неё в зубах. Цвета — из палитры кошки (sprite.ts): m, n — мышь, p — розовое.

import { compose, crownAt, type Frame, hitMask, type Part, SIZE } from './sprite';

// Лежит на боку смирно, целая и чистая: глаз зажмурен, хвост колечком. Смотрит вправо, как все спрайты.
const LYING: Part = [
  '...........kk.....',
  '..........kppk....',
  '......kkkkkppk....',
  '....kkmmmmmkkmk...',
  '...kmmmmmmmmmmmk..',
  '..kmmmmmmmmkkmmmk.',
  '..kmmmmmmmmmmmmmpk',
  '..knmmmmmmlllllkk.',
  '...kkkkkkkkkkkkk..',
];
const LYING_TAIL: Part = ['.pp.', 'p..p', 'p...', '.ppp'];

/** Кадр окна подарка: мышка на полу посередине. */
export const giftFrame = (): Frame => compose([LYING_TAIL, 4, 27], [LYING, 6, 23]);

/** Маска кликов окна подарка: вся мышка, вместе с хвостом. */
export const giftMask = (frame: Frame): number[] => hitMask(frame);

// В зубах: висит поперёк пасти обмякшая, нос вправо, хвост свесился влево вниз.
const HELD: Part = [
  '.kkkkkk.kk.',
  'kmmmmmmkppk',
  'kmmmmmmmmmk',
  'knmmmmmmmpk',
  'pkkkkkkkkk.',
  'p..........',
  '.p.........',
];
/** Где пасть у головы анфас: от левого края и от ряда макушки (crownAt), в клетках. */
const MOUTH: [number, number] = [3, 6];

/**
 * Кошка несёт мышку: она поверх морды у пасти. Голову ищем по ряду макушки, как наряды (`dress`),
 * поэтому годится любая поза с головой анфас; кадр без неё — как есть. Звать до `flip`.
 */
export function withMouse(frame: Frame): Frame {
  const at = crownAt(frame);
  if (!at) return frame;
  const [x, y] = at;
  const g = frame.map((row) => [...row]);
  HELD.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const [cx, cy] = [x + MOUTH[0] + dx, y + MOUTH[1] + dy];
      if (row[dx] !== '.' && cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE) g[cy][cx] = row[dx];
    }
  });
  return g.map((r) => r.join(''));
}
