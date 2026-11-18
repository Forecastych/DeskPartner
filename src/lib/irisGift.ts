import { compose, type Frame, type Part } from './sprite';

export const FRAME_MS = 90;

// Зелёная коробка и янтарная лента с буклета. Кошка рисуется в своём обычном окрасе.
export const BOX_PALETTE = { L: '#24382f', D: '#456959', U: '#6c8b73', P: '#90a789', J: '#e4b96b', K: '#b78342' };

const BOX: Part = [
  'LLLLLLLLLLLLLLLLLLLL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LUUUUUUUUJJJDDDDDDDL',
  'LDDDDDDDDKKKDDDDDDDL',
  '.LLLLLLLLLLLLLLLLLL.',
];

const LID: Part = [
  '...LLLLLLLLLLLLLLLL...',
  '.LLPPPPPPJJJJPPPPPPLL.',
  'LPPPPPPPPJJJJPPPPPPPPL',
  'LDDDDDDDDKKKKDDDDDDDDL',
  '.LLLLLLLLLLLLLLLLLLLL.',
];

const BOW: Part = [
  'KKK.....KKK',
  'KJJK...KJJK',
  '.KJKKKKKJK.',
  '..KKJJJKK..',
  '...KJJJK...',
];

const INSIDE: Part = [
  '...LLLLLLLLLLLLLL...',
  '..LDDDDDDDDDDDDDDL..',
  '.LDDDDDDDDDDDDDDDDL.',
  'LLLLLLLLLLLLLLLLLLLL',
];

const SPARK: Part = ['.s.', 'sss', '.s.'];
const EMPTY_FRAME: Part = ['.KKKKKK.', 'KJJJJJJK', 'KJ....JK', 'KJ....JK', 'KJ....JK', 'KJJJJJJK', '.KKKKKK.'];

function wrapped(sway: number): Frame {
  return compose([BOX, 6, 22], [LID, 5 + sway, 19 - Math.abs(sway)], [BOW, 11 + sway, 14 - Math.abs(sway)]);
}

const WAITING = [wrapped(0), wrapped(-1), wrapped(0), wrapped(1)];

export function waitingFrame(now: number): Frame {
  // Коробка подаёт знак коротким шорохом примерно раз в четыре секунды.
  const step = Math.floor((now % 3800) / 100);
  return WAITING[step < WAITING.length ? step : 0];
}

export function revealFrames(pet: { idle: Frame; happy: Frame }): Frame[] {
  // Крышка подпрыгивает вправо, питомец выпрыгивает и достаёт рамку.
  // На первых двух кадрах передняя стенка заслоняет лапы, после прыжка коробка оседает за край.
  const hop = [7, 3, -4, -7, -8, -7, -5, -2, 0];
  return hop.map((rise, i) => {
    const front = BOX.slice(0, i < 5 ? BOX.length : Math.max(0, 8 - 2 * (i - 5)));
    const depth = BOX.length - front.length;
    const lidX = 5 + i * 5;
    const lidY = 17 - 3 * Math.min(i, 3) + 3 * Math.max(i - 3, 0);
    const petPart: [Part, number, number] = [pet.idle, 0, rise];
    const frontPart: [Part, number, number] = [front, 6, 22 + depth];
    return compose(
      [i < 4 ? INSIDE : [], 6, 19],
      ...(i < 2 ? [petPart, frontPart] : [frontPart, petPart]),
      [LID, lidX, lidY],
      [BOW, lidX + 6, lidY - 5],
      [i >= 2 && i <= 5 ? SPARK : [], 5, 10 + i],
      [i >= 3 && i <= 7 ? SPARK : [], 25, 13 - i],
    );
  }).concat([pet.happy, pet.happy, ...Array<Frame>(6).fill(compose([pet.idle, 0, 0], [EMPTY_FRAME, 1, 24]))]);
}
