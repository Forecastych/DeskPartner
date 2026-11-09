// Окрасы кошки. Кадры рисуются одними ключами палитры (sprite.ts), окрас подменяет цвета только
// у ключей кошки: контур k, шерсть f, полоски d, грудка l, нос и уши p, зрачки E. У вещей —
// миски, лежака, лотка, мыши, клубка, лужи, торта — ключи свои, их перекраска не касается.
// Трёхцветной одной подмены мало: `paint` расставляет по шерсти пятна (ключи x и X).
// Наряды (цифры, wardrobe.ts) окрас перекрашивает тоже: розовый бантик хорош на серой, а на рыжей
// теряется, на чёрной смотрится странно.

import { headAt, PALETTE, SIZE, type Frame, type Head } from './sprite';
import type { Breed } from './settings';

/** Что меняет окрас поверх обычной палитры; серая полосатая ничего не меняет. */
const COATS: Record<Breed, Record<string, string>> = {
  tabby: {},
  ginger: { k: '#46281c', f: '#e8964c', d: '#bd6630', l: '#fbe8cf', p: '#f08f9c', E: '#46281c' },
  // Чёрная на тёмной панели задач растворилась бы целиком: шерсть угольная с синевой, контур темнее
  // неё, полоски — призрачные, чуть светлее шерсти. Глаза жёлтые — по ним кошку и узнают.
  black: { k: '#121217', f: '#3b3d4b', d: '#4a4d5e', l: '#424453', p: '#d27a90', E: '#f2c84b' },
  // Смокинг — та же чёрная, только грудка, щёки и носочки белые: арт их и так рисует светлыми.
  tuxedo: { k: '#121217', f: '#3b3d4b', d: '#4a4d5e', l: '#f4f4f6', p: '#e98aa0', E: '#c9dc54' },
  // Трёхцветная: белая без полосок, рыжие и тёмные пятна ставит `paint`.
  calico: { k: '#3a3440', f: '#f6f1e8', d: '#f6f1e8', l: '#ffffff', p: '#ef8f9f', x: '#e3893a', X: '#3d3742' },
};

/**
 * Наряды под окрас: вещь должна отделяться от шерсти и читаться и на светлом окне, и на тёмной
 * панели задач. Форма та же, меняются только цвета; серой полосатой и трёхцветной хватает обычных.
 */
const WEAR_COLORS: Partial<Record<Breed, Record<string, string>>> = {
  // На рыжей розовое и красное сливаются с шерстью — бантик голубой, ошейник синий.
  ginger: { '1': '#3fa7d6', '2': '#1d5f8a', '3': '#2f62c4' },
  // На чёрной — красный бантик, ошейник ярче, шапочка и платок светлее: тёмные тонули в шерсти.
  black: { '1': '#e8343f', '2': '#8e1525', '3': '#ff5a5f', '6': '#5a93ea', '8': '#4cbf84' },
  tuxedo: { '1': '#e8343f', '2': '#8e1525', '3': '#ff5a5f', '6': '#5a93ea', '8': '#4cbf84' },
};

/** Палитра кадра кошки в этом окрасе. */
export function palette(b: Breed): Record<string, string> {
  const over = { ...COATS[b], ...WEAR_COLORS[b] };
  return Object.keys(over).length ? { ...PALETTE, ...over } : PALETTE;
}

/**
 * Пятна трёхцветной на голове — от макушки, а не от кадра: в любой позе и на любой высоте мордочка
 * одна и та же (рыжее пятно над левым глазом, тёмное — у правого уха). Ряды от ряда макушки,
 * столбцы от левого края головы, как у нарядов; '.' — белая шерсть. Голова малыша на клетку уже с
 * каждой стороны и на ряд короче.
 */
const HEAD_PATCHES: string[] = ['.xxxx...XXX.', '.xxx.....XX.', '.x........X.', '.x..........'];
const KIT_HEAD_PATCHES: string[] = ['..xxx...XX..', '..x......X..', '..x.........'];
// Клетки головы анфас от левого края и ряда макушки: [x0, x1, y0, y1] включительно.
const HEAD_BOX: [number, number, number, number] = [0, 11, -2, 7];
const KIT_HEAD_BOX: [number, number, number, number] = [1, 10, -2, 6];

// Голова в шапке или шапочке: ряд макушки закрыт, но уши торчат по бокам — ищем по ряду под ушами.
const EARS = /kpk.{6}kpk/;
const KIT_EARS = /kpk.{4}kpk/;

/** Голова анфас по макушке, а если её закрыл наряд — по ушам. */
function headOf(frame: Frame): Head | null {
  const head = headAt(frame);
  if (head) return head;
  for (const [re, kit] of [[EARS, false], [KIT_EARS, true]] as const)
    for (let y = 0; y < frame.length - 1; y++) {
      const m = re.exec(frame[y]);
      if (m) return { x: m.index - (kit ? 1 : 0), y: y + 1, kit };
    }
  return null;
}

/**
 * Пятна на туловище — по рядам кадра (ниже PATCH_ROWS — лапы и живот, они у неё белые), а по
 * столбцам — от головы: на таймере калачик отодвигается от часов, и пятна едут вместе с ним, а не
 * остаются на месте. Карта подобрана для головы с левым краем в BODY_X; кадр без головы — тоже так.
 * 'x' — рыжее пятно, 'X' — тёмное, '.' — белая шерсть.
 */
const PATCH_ROWS = 25;
const BODY_X = 12;
const PATCHES: string[] = (() => {
  // Несколько кругов поверх друг друга, позже — сверху. Подобраны на макете (scratchpad):
  // голова у всех поз примерно в x 10–27, y 12–21, спина — x 3–21, y 12–26. Шире кадра на
  // SIZE с каждой стороны: голова бывает и у левого, и у правого края.
  const blobs: [number, number, number, string][] = [
    [6, 14, 4.2, 'x'],
    [13, 22, 3.6, 'X'],
    [19, 18, 3.4, 'x'],
    [24, 13, 3.2, 'X'],
    [12, 11, 3, 'X'],
    [3, 24, 3, 'X'],
    [21, 26, 3.4, 'x'],
    [27, 20, 2.6, 'x'],
    [16, 3, 3.5, 'x'],
    [9, 6, 3, 'X'],
  ];
  // столбец карты u = x + SIZE: x от −SIZE до 2·SIZE−1
  return Array.from({ length: PATCH_ROWS }, (_, y) =>
    Array.from({ length: 3 * SIZE }, (_, u) => {
      const x = u - SIZE;
      let c = '.';
      for (const [bx, by, r, k] of blobs) if ((x - bx) ** 2 + (y - by) ** 2 <= r * r) c = k;
      return c;
    }).join(''),
  );
})();

/** Пятно под клеткой кадра (x, y): на голове — по её карте, на туловище — по карте от головы. */
function patchAt(head: Head | null, x: number, y: number): string {
  if (head) {
    const [x0, x1, y0, y1] = head.kit ? KIT_HEAD_BOX : HEAD_BOX;
    const [dx, dy] = [x - head.x, y - head.y];
    if (dx >= x0 && dx <= x1 && dy >= y0 && dy <= y1) return (head.kit ? KIT_HEAD_PATCHES : HEAD_PATCHES)[dy - 1]?.[dx] ?? '.';
  }
  if (y >= PATCH_ROWS) return '.';
  return PATCHES[y][x - (head ? head.x : BODY_X) + BODY_X + SIZE] ?? '.';
}

/**
 * Окрас поверх кадра: пока он только у трёхцветной — шерсть и полоски под пятнами становятся x/X.
 * Звать до `flip`: пятна переворачиваются вместе с кошкой. Остальным окрасам — тот же кадр.
 */
export function paint(frame: Frame, b: Breed): Frame {
  if (b !== 'calico') return frame;
  const head = headOf(frame);
  return frame.map((row, y) => {
    if (!/[fd]/.test(row)) return row;
    let out = '';
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      const m = c === 'f' || c === 'd' ? patchAt(head, x, y) : '.';
      out += m !== '.' ? m : c;
    }
    return out;
  });
}
