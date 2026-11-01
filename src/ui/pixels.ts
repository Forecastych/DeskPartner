// Пиксельные значки интерфейса: рисуются строками, как спрайт кошки, — «#» закрашен, остальное пусто.
// Icon.svelte превращает их в SVG с crispEdges, так что на любом масштабе Windows клетки остаются чёткими.

export const ICONS = {
  // галочка: в чекбоксе и в меню питомца
  tick: [
    '.......',
    '......#',
    '.....##',
    '#...##.',
    '##.##..',
    '.###...',
    '..#....',
  ],
  // точка выбранного варианта: круг, нарисованный клетками
  dot: [
    '.###.',
    '#####',
    '#####',
    '#####',
    '.###.',
  ],
  minimize: [
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '#######',
    '#######',
  ],
  close: [
    '##...##',
    '###.###',
    '.#####.',
    '..###..',
    '.#####.',
    '###.###',
    '##...##',
  ],
  // кошачья лапка у заголовка окна
  paw: [
    '.#...#.',
    '##.#.##',
    '...#...',
    '.#####.',
    '#######',
    '#######',
    '.##.##.',
  ],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

/**
 * Путь SVG из строк: подряд идущие клетки строки сливаются в один прямоугольник,
 * чтобы между ними не проступали щели сглаживания.
 */
export function pixelPath(rows: readonly string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      const from = x;
      while (row[x] === '#') x++;
      parts.push(`M${from} ${y}h${x - from}v1h${from - x}z`);
    }
  });
  return parts.join('');
}

/** Размер сетки значка: ширина — по самой длинной строке. */
export function gridOf(rows: readonly string[]): { w: number; h: number } {
  return { w: Math.max(0, ...rows.map((r) => r.length)), h: rows.length };
}
