// Кошка 32×32, нарисованная попиксельно. Кадры собираются из деталей — голова, тело, лапы, хвост, —
// поэтому одна и та же голова не перерисовывается в каждой позе, а шаги отличаются только лапами.
// Все позы смотрят вправо; влево — `flip`.

export const SIZE = 32;

/** Кадр: SIZE строк по SIZE символов, символ — ключ палитры, '.' — пусто. */
export type Frame = string[];

/** Деталь: строки любой длины, '.' не закрашивает то, что под ней. */
type Part = string[];

export const PALETTE: Record<string, string> = {
  k: '#2b2b33', // контур
  f: '#9aa0ad', // шерсть
  d: '#6f7584', // полоски
  l: '#e4e6ec', // грудка, щёки, живот
  p: '#e98aa0', // уши изнутри, нос
  w: '#ffffff', // блик в глазу
  h: '#e2556b', // сердечко
  z: '#bcd4ff', // «з-з-з» во сне
};

/** Украшения не часть зверя: клик по сердечку или «з-з-з» проходит насквозь. */
const DECOR = new Set(['h', 'z']);

// Голова анфас, 12×10: кошка идёт боком, но смотрит на человека.
const HEAD_TOP: Part = [
  '.k........k.',
  'kpk......kpk',
  'kppkkkkkkppk',
  'kfffdffdfffk',
  'kffffffffffk',
];
const HEAD_BOTTOM: Part = [
  'klfffppffflk',
  '.kllllllllk.',
  '..kkkkkkkk..',
];
const EYES_OPEN: Part = ['kfwkffffwkfk', 'kfkkffffkkfk'];
const EYES_SHUT: Part = ['kffffffffffk', 'kfkkffffkkfk'];
const EYES_HAPPY: Part = ['kffkffffkffk', 'kfkfkffkfkfk'];

const head = (eyes: Part): Part => [...HEAD_TOP, ...eyes, ...HEAD_BOTTOM];

// Туловище сбоку, 18×8, полоски на спине.
const BODY: Part = [
  '..kkkkkkkkkkkkkk..',
  '.kffdffdffdfffffk.',
  'kfffdffdffdffffffk',
  'kffffffffffffffffk',
  'kffffffffffffffffk',
  'kffffffffflllllffk',
  '.kfffffflllllllfk.',
  '..kkkkkkkkkkkkkk..',
];

/** Вдох: туловище на ряд выше за счёт лишнего ряда посередине. */
const inhale = (body: Part): Part => [...body.slice(0, 4), body[3], ...body.slice(4)];

/** Лапа сбоку, 4 в ширину: начинается на нижнем контуре туловища, `len` рядов, носочек светлый. */
const leg = (len: number): Part => [...Array<string>(len - 2).fill('kffk'), 'kllk', 'kkkk'];

// Хвост трубой, 6×9; основание уходит под туловище.
const TAIL_UP: Part = [
  '.kk...',
  'kddk..',
  'kfk...',
  'kfk...',
  'kfk...',
  'kffk..',
  '.kffk.',
  '..kffk',
  '...kfk',
];
const TAIL_SWAY: Part = [
  '..kk..',
  '.kddk.',
  '.kfk..',
  'kfk...',
  'kfk...',
  'kffk..',
  '.kffk.',
  '..kffk',
  '...kfk',
];

/** Сезонный жирок: 0 — лето, 2 — зима. */
export type Fat = 0 | 1 | 2;
export const FATS: Fat[] = [0, 1, 2];

/** Кошка начинает толстеть в ноябре, к декабрю набирает полностью и худеет к апрелю. */
export function fatOn(date: Date): Fat {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return 2;
  return m === 10 || m === 2 ? 1 : 0;
}

/** Туловище сбоку на `fat` рядов глубже: живот провисает вниз, лапы от этого короче. */
const sideBody = (fat: Fat): Part => [...BODY.slice(0, 6), ...Array<string>(fat).fill(BODY[5]), ...BODY.slice(6)];

/**
 * Сидит анфас грушей, 10 рядов по центру x 16: узко под головой, ниже бёдра раздаются,
 * с каждым уровнем жира — ещё на пиксель с боков. Грудка светлая и книзу шире,
 * лапки разделены одной выемкой в нижнем ряду: длинные тёмные линии превращают кошку в трезубец.
 */
function sitBody(fat: Fat): Part {
  const half = [3, 3, 4, 4, 5, 5, 5, 6, 6, 6].map((h, y) => h + (y >= 4 ? fat : y >= 2 ? Math.min(fat, 1) : 0));
  const widest = Math.max(...half);
  const last = half.length - 1;
  return half.map((h, y) => {
    let row = '.'.repeat(widest - h);
    for (let x = -h; x < h; x++) {
      const edge = x === -h || x === h - 1;
      const chest = y >= 7 ? 3 : y >= 4 ? 2 : 1;
      if (y === last) row += edge ? '.' : 'k';
      else if (edge) row += 'k';
      else if (y === last - 1 && (x === -1 || x === 0)) row += 'k';
      else if (x >= -chest && x < chest) row += 'l';
      else row += 'f';
    }
    return row + '.'.repeat(widest - h);
  });
}

// Хвост, обёрнутый вокруг лап; кончик то лежит, то подрагивает.
const SIT_TAIL: Part = ['......kk', '.....kdk', 'kk...kfk', 'kfkkkffk', '.kffffk.', '..kkkk..'];
const SIT_TAIL_FLICK: Part = ['.......k', '......kd', 'kk...kfk', 'kfkkkffk', '.kffffk.', '..kkkk..'];

// Во сне хвост свисает с рамки окна.
const SLEEP_TAIL: Part = ['.kfk', '.kfk', '.kfk', '.kdk', '.kdk', '..k.'];
const SLEEP_TAIL_SWAY: Part = ['.kfk', '.kfk', 'kfk.', 'kdk.', 'kdk.', '.k..'];

const HEART: Part = ['.hh.hh.', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'];
const Z_SMALL: Part = ['zzzz', '..z.', '.z..', 'zzzz'];
const Z_BIG: Part = ['zzzzz', '...z.', '..z..', '.z...', 'zzzzz'];

/** Штампует детали по порядку: следующая рисуется поверх предыдущей. */
function compose(...parts: [Part, number, number][]): Frame {
  const g = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
  for (const [part, x0, y0] of parts)
    part.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (row[dx] !== '.' && x >= 0 && x < SIZE && y >= 0 && y < SIZE) g[y][x] = row[dx];
      }
    });
  return g.map((r) => r.join(''));
}

// Стоит и идёт: туловище x 4–21, низ на y 26 (+жир), голова справа сверху, лапы до земли (y 31).
// Лапы парами с общим контуром: задние x 5–11, передние x 14–20.
const BACK = [5, 8];
const FRONT = [14, 17];

/** `step[i]` — сдвиг i-й лапы (задние, потом передние) по x и подняв ли её. */
function standing(fat: Fat, eyes: Part, tail: Part, step: [number, boolean][] = []): Frame {
  const legs = [...BACK, ...FRONT].map((x, i): [Part, number, number] => {
    const [dx, up] = step[i] ?? [0, false];
    return [leg((up ? 5 : 6) - fat), x + dx, 26 + fat];
  });
  return compose([tail, 0, 12], [sideBody(fat), 4, 19], ...legs, [head(eyes), 18, 11]);
}

// Шаг на 32 пикселях: лапы то расставлены, то сведены, и поднята то одна диагональ, то другая.
// Сдвинуть лапы навстречу друг другу нельзя — четыре пикселя с контуром слипаются в пятно.
const SPREAD: [number, boolean][] = [[-1, false], [1, false], [-1, false], [1, false]];
const LIFT_A: [number, boolean][] = [[0, true], [0, false], [0, false], [0, true]];
const LIFT_B: [number, boolean][] = [[0, false], [0, true], [0, true], [0, false]];

/** Сидит анфас посередине: голова y 12–21, туловище y 22–31, хвост выглядывает справа. */
function sitting(fat: Fat, eyes: Part, tail: Part, extra: [Part, number, number][] = []): Frame {
  const body = sitBody(fat);
  const half = body[0].length / 2;
  return compose([tail, 13 + half, 26], [body, 16 - half, 22], [head(eyes), 10, 12], ...extra);
}

/** Спит калачиком; нижний контур туловища (y 27) лежит на рамке окна, жирок растёт вверх. */
function sleeping(body: Part, tail: Part, z: [Part, number, number]): Frame {
  const y = 28 - body.length;
  return compose([tail, 3, 26], [body, 5, y], [head(EYES_SHUT), 17, 17], z);
}

export interface Anim {
  frames: Frame[];
  /** Сколько держится один кадр. */
  ms: number;
}

function build(fat: Fat) {
  const body = sideBody(fat);
  return {
    stand: {
      ms: 500,
      frames: [
        standing(fat, EYES_OPEN, TAIL_UP),
        standing(fat, EYES_OPEN, TAIL_SWAY),
        standing(fat, EYES_OPEN, TAIL_UP),
        standing(fat, EYES_SHUT, TAIL_UP),
      ],
    },
    walk: {
      ms: 150,
      frames: [
        standing(fat, EYES_OPEN, TAIL_UP, SPREAD),
        standing(fat, EYES_OPEN, TAIL_SWAY, LIFT_A),
        standing(fat, EYES_OPEN, TAIL_UP, SPREAD),
        standing(fat, EYES_OPEN, TAIL_SWAY, LIFT_B),
      ],
    },
    sit: {
      ms: 600,
      frames: [
        sitting(fat, EYES_OPEN, SIT_TAIL),
        sitting(fat, EYES_OPEN, SIT_TAIL_FLICK),
        sitting(fat, EYES_OPEN, SIT_TAIL),
        sitting(fat, EYES_OPEN, SIT_TAIL),
        sitting(fat, EYES_SHUT, SIT_TAIL),
      ],
    },
    sleep: {
      ms: 900,
      frames: [
        sleeping(body, SLEEP_TAIL, [Z_SMALL, 25, 11]),
        sleeping(inhale(body), SLEEP_TAIL_SWAY, [Z_BIG, 26, 6]),
      ],
    },
    petted: {
      ms: 400,
      frames: [
        sitting(fat, EYES_HAPPY, SIT_TAIL, [[HEART, 13, 5]]),
        sitting(fat, EYES_HAPPY, SIT_TAIL_FLICK, [[HEART, 13, 4]]),
      ],
    },
  } satisfies Record<string, Anim>;
}

export type Anims = ReturnType<typeof build>;
export type AnimName = keyof Anims;

/** Все позы при данном жирке; собираются один раз на уровень. */
export const ANIMS: Record<Fat, Anims> = { 0: build(0), 1: build(1), 2: build(2) };

export function flip(frame: Frame): Frame {
  return frame.map((r) => [...r].reverse().join(''));
}

export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  frame.forEach((row, y) => {
    for (let x = 0; x < SIZE; x++) {
      const c = PALETTE[row[x]];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

/** Маска для Rust: по числу на строку, бит x = в этой клетке нарисован зверь (не украшение). */
export function hitMask(frame: Frame): number[] {
  return frame.map((row) => {
    let bits = 0;
    for (let x = 0; x < SIZE; x++) if (row[x] !== '.' && !DECOR.has(row[x])) bits |= 1 << x;
    return bits >>> 0;
  });
}
