// Спрайты 32×32, рисуются попиксельно. Пока здесь заглушка — силуэт кошки, чтобы проверить окно;
// настоящие кадры придут вместе с артом.

export const SIZE = 32;

/** Кадр: SIZE строк по SIZE символов, символ — ключ палитры, '.' — пусто. */
export type Frame = string[];

export const PALETTE: Record<string, string> = {
  k: '#2b2b33', // контур
  f: '#8a8f9c', // шерсть
  e: '#f2d14b', // глаза
  h: '#e2556b', // сердечко
};

function blank(): string[][] {
  return Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
}

/** Сидящий силуэт: овал тела, голова, уши. `breath` приподнимает спину на пиксель. */
function placeholder(breath: number, heart: boolean): Frame {
  const g = blank();
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) g[y][x] = c;
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1) put(x, y, d > 0.7 ? 'k' : 'f');
      }
  };
  ellipse(16, 24 - breath / 2, 9, 6 + breath / 2); // тело
  ellipse(16, 14, 7, 6); // голова
  for (let i = 0; i < 4; i++) {
    // уши — треугольники над головой
    for (let x = 10 + i; x <= 12; x++) put(x, 6 + i, i === 0 || x === 10 + i ? 'k' : 'f');
    for (let x = 20; x <= 22 - i; x++) put(x, 6 + i, i === 0 || x === 22 - i ? 'k' : 'f');
  }
  put(13, 14, 'e');
  put(19, 14, 'e');
  if (heart) {
    for (const [x, y] of [[15, 1], [17, 1], [14, 2], [15, 2], [16, 2], [17, 2], [18, 2], [15, 3], [16, 3], [17, 3], [16, 4]])
      put(x, y, 'h');
  }
  return g.map((r) => r.join(''));
}

export const IDLE: Frame[] = [placeholder(0, false), placeholder(1, false)];
export const PETTED: Frame[] = [placeholder(0, true), placeholder(1, true)];

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

/** Маска для Rust: по числу на строку, бит x = в этой клетке нарисован пиксель. */
export function hitMask(frame: Frame): number[] {
  return frame.map((row) => {
    let bits = 0;
    for (let x = 0; x < SIZE; x++) if (row[x] !== '.') bits |= 1 << x;
    return bits >>> 0;
  });
}
