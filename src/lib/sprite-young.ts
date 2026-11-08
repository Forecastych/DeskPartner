/**
 * Кошка до взрослой: малыш и подросток в той же сетке 32×32 и на той же земле.
 * Голова крупнее относительно тела, туловище меньше, лапы тоньше, хвост короче.
 * Позы собираются из тех же деталей, что взрослые (sprite.ts); каких нет — берутся взрослые кадры.
 */
import {
  ANIMS,
  BOWL,
  BOWL_AT,
  CAKE,
  compose,
  DUST_BIG,
  DUST_SMALL,
  EYES_HAPPY,
  EYES_OPEN,
  EYES_SHUT,
  EYES_SLEEPY,
  FLY,
  FLY_ORBIT,
  frontBody,
  HANG_BACK,
  HANG_FRONT,
  HANG_TAIL,
  HEAD_BOTTOM,
  HEAD_FLAT,
  HEAD_MEOW,
  HEAD_TOP,
  HEART,
  inBed,
  inhale,
  KIBBLE,
  MOUTH_SMUG,
  PAW_SIDE,
  PAWS,
  SCRUFF,
  SIT_TAIL,
  SIZE,
  SLEEP_TAIL,
  SLEEP_TAIL_SWAY,
  STAR,
  TAIL_BACK,
  TAIL_BACK_FLICK,
  TONGUE,
  Z_BIG,
  Z_SMALL,
  type Anim,
  type Anims,
  type Fat,
  type Frame,
  type Part,
} from './sprite';

/** Молодая стадия: 0 — малыш, 1 — подросток. */
export type Young = 0 | 1;

type Placed = [Part, number, number];

/** Голова анфас: верх (уши, макушка, лоб), глаза в два ряда, низ (щёки, подбородок). */
interface Head {
  top: Part;
  flat: Part;
  open: Part;
  shut: Part;
  happy: Part;
  sleepy: Part;
  bottom: Part;
  meow: Part;
  smug: Part;
}

const face = (h: Head, eyes: Part, bottom = h.bottom, top = h.top): Part => [...top, ...eyes, ...bottom];
const headW = (h: Head) => h.top[0].length;
const headH = (h: Head) => h.top.length + 2 + h.bottom.length;

// Голова малыша, 10×9: уже и ниже взрослой, а глаза те же — на маленькой мордочке они огромные.
const KIT_HEAD: Head = {
  top: ['.k......k.', 'kpk....kpk', 'kppkkkkppk', 'kffdffdffk'],
  flat: ['..........', 'kkk....kkk', 'kppkkkkppk', 'kffdffdffk'],
  open: ['kfwkffwkfk', 'kfkkffkkfk'],
  shut: ['kffffffffk', 'kfkkffkkfk'],
  happy: ['kffkffkffk', 'kfkfkkfkfk'],
  sleepy: ['kfddffddfk', 'kfkkffkkfk'],
  bottom: ['klffppfflk', '.kllllllk.', '..kkkkkk..'],
  meow: ['klffppfflk', '.klkppklk.', '..kkkkkk..'],
  smug: ['klffppfflk', '.klkllklk.', '..kkkkkk..'],
};

// Подросток уже с головой взрослой — на тонком туловище она кажется крупной.
const TEEN_HEAD: Head = {
  top: HEAD_TOP,
  flat: HEAD_FLAT,
  open: EYES_OPEN,
  shut: EYES_SHUT,
  happy: EYES_HAPPY,
  sleepy: EYES_SLEEPY,
  bottom: HEAD_BOTTOM,
  meow: HEAD_MEOW,
  smug: MOUTH_SMUG,
};

/** Чем малыш и подросток отличаются друг от друга: размеры, места деталей и свои хвостики. */
interface Kit {
  head: Head;
  /** Туловище сбоку: ширина, высота, левый столбец, верхний ряд без жирка. */
  w: number;
  h: number;
  x: number;
  y: number;
  stripes: number[];
  /** Длина лапы стоя; x четырёх лап: две задние, две передние. */
  len: number;
  legs: number[];
  headAt: [number, number];
  tail: [Part, Part];
  tailAt: [number, number];
  tailBack: [Part, Part];
  floorTail: Part;
  /** Анфас: полуширины рядов туловища сидя и буханкой, лапки буханки, хвост вокруг лап. */
  sit: number[];
  sitHead: [number, number];
  sitTail: Part;
  loaf: number[];
  paws: Placed;
  /** Горбик спины, когда голова в миске. */
  dome: number[];
  /** Калачик: ширина и высота туловища, где голова. */
  curl: [number, number];
  curlHead: [number, number];
  /** На весу: полуширины туловища, лапы и хвост висят. */
  hang: number[];
  hangFront: Part;
  hangBack: Part;
  hangTail: Part;
  hangAt: number;
}

// Малыш: туловище 12×6, тонкие лапки по 4 ряда, хвостик торчком в 6 рядов.
const KIT: Kit = {
  head: KIT_HEAD,
  w: 12,
  h: 6,
  x: 7,
  y: 23,
  stripes: [3, 6],
  len: 4,
  legs: [8, 10, 13, 15],
  headAt: [15, 18],
  tail: [
    ['.kk.', 'kddk', 'kfk.', 'kfk.', 'kffk', '.kfk'],
    ['..kk', '.kdk', '.kfk', 'kfk.', 'kffk', '.kfk'],
  ],
  tailAt: [4, 19],
  tailBack: [
    ['.kkk.', 'kdffk', '.kkk.'],
    ['kk...', 'kdkk.', '.kdfk', '..kk.'],
  ],
  floorTail: ['.kkkkkk.', 'kfffddk.', '.kkkkkk.'],
  sit: [2, 3, 3, 4, 4, 4, 4],
  sitHead: [11, 16],
  sitTail: ['....kk', '...kdk', 'kk.kfk', '.kkffk', '..kkk.'],
  loaf: [3, 4, 4, 5, 5],
  paws: [['.kkk.kkk.', 'klllklllk', 'kkkkkkkkk'], 12, 29],
  dome: [2, 4, 5, 5, 6, 6, 6, 6],
  curl: [14, 6],
  curlHead: [17, 19],
  hang: [2, 3, 3, 4, 4, 4, 4, 3],
  hangFront: ['kfk', 'kfk', 'klk', '.k.'],
  hangBack: ['kfk', 'klk', '.k.'],
  hangTail: ['kffk', 'kddk', 'kffk', 'kddk', '.kk.'],
  hangAt: 8,
};

// Подросток: долговязый — туловище 15×7, тонкие лапы по 5 рядов, голова уже взрослая.
const TEEN: Kit = {
  head: TEEN_HEAD,
  w: 15,
  h: 7,
  x: 5,
  y: 21,
  stripes: [4, 7, 10],
  len: 5,
  legs: [6, 8, 14, 16],
  headAt: [15, 14],
  tail: [
    ['.kk...', 'kddk..', 'kfk...', 'kffk..', '.kffk.', '..kffk', '...kfk'],
    ['..kk..', '.kddk.', '.kfk..', 'kffk..', '.kffk.', '..kffk', '...kfk'],
  ],
  tailAt: [1, 16],
  tailBack: [TAIL_BACK, TAIL_BACK_FLICK],
  floorTail: ['.kkkkkkkkk.', 'kffffffddk.', '.kkkkkkkkk.'],
  sit: [3, 3, 4, 4, 5, 5, 5, 5, 5],
  sitHead: [10, 13],
  sitTail: SIT_TAIL,
  loaf: [4, 4, 5, 5, 5, 5],
  paws: [PAWS, 11, 28],
  dome: [3, 4, 5, 6, 6, 7, 7, 7, 7, 7],
  curl: [16, 7],
  curlHead: [17, 18],
  hang: [3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 4],
  hangFront: HANG_FRONT,
  hangBack: HANG_BACK,
  hangTail: HANG_TAIL,
  hangAt: 9,
};

/**
 * Туловище сбоку любого размера, как взрослое: скруглённые углы, полоски на спине, светлое брюшко
 * спереди. Жирок — лишние ряды брюшка.
 */
function sideOf(w: number, h: number, stripes: number[], fat: Fat): Part {
  const fur = (x: number, y: number) => {
    if ((y === 1 || y === 2) && stripes.includes(x)) return 'd';
    if (y === h - 3 && x >= Math.round(w * 0.55) && x <= w - 4) return 'l';
    if (y === h - 2 && x >= Math.round(w * 0.45) && x <= w - 4) return 'l';
    return 'f';
  };
  const rows = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const cut = y === 0 || y === h - 1 ? 2 : y === 1 || y === h - 2 ? 1 : 0;
      if (x < cut || x >= w - cut) return '.';
      if (x === cut || x === w - 1 - cut || y === 0 || y === h - 1) return 'k';
      return fur(x, y);
    }).join(''),
  );
  return [...rows.slice(0, h - 2), ...Array<string>(fat).fill(rows[h - 3]), ...rows.slice(h - 2)];
}

/** Тонкая лапка, 3 в ширину: от нижнего контура туловища, носочек светлый. Короче двух рядов не бывает. */
const thin = (len: number): Part => [...Array<string>(Math.max(2, len) - 2).fill('kfk'), 'klk', 'kkk'];

/** Тонкая лапка наискось, как взрослая `slantLeg`: `dir` 1 — вперёд, -1 — назад. */
function slant(len: number, dir: 1 | -1): [Part, number] {
  const n = Math.max(2, len);
  const rows = thin(n).map((r, i) => {
    const shift = dir === 1 ? i : n - 1 - i;
    return '.'.repeat(shift) + r + '.'.repeat(n - 1 - shift);
  });
  return [rows, dir === 1 ? 0 : n - 1];
}

/** Горбик спины анфас, как взрослый `dome`, по своим полуширинам. */
function domeOf(halves: number[], fat: Fat): Part {
  const half = halves.map((h, y) => h + (y >= 2 ? fat : 0));
  const widest = Math.max(...half);
  const last = half.length - 1;
  return half.map((h, y) => {
    let row = '.'.repeat(widest - h);
    for (let x = -h; x < h; x++) {
      const edge = x === -h || x === h - 1;
      if (y === last) row += edge ? '.' : 'k';
      else if (edge || y === 0) row += 'k';
      else if (y >= last - 2 && (x === -h + 1 || x === -h + 2 || x === h - 2 || x === h - 3)) row += 'l';
      else if (y >= 1 && y <= 3 && (x === -2 || x === 1)) row += 'd';
      else row += 'f';
    }
    return row + '.'.repeat(widest - h);
  });
}

type Step = [number, boolean][];
const SPREAD: Step = [[-1, false], [1, false], [-1, false], [1, false]];
const LIFT_A: Step = [[0, true], [0, false], [0, false], [0, true]];
const LIFT_B: Step = [[0, false], [0, true], [0, true], [0, false]];

/**
 * Все позы стадии при данном жирке. Жирок у молодых не укорачивает лапы — лапки и так короткие, —
 * а приподнимает спину: туловище растёт вверх, земля та же.
 */
function build(k: Kit, fat: Fat) {
  const hd = k.head;
  const hw = headW(hd);
  const hh = headH(hd);
  const mouthRow = hd.top.length + 2;
  const body = sideOf(k.w, k.h, k.stripes, fat);
  const top = k.y - fat;
  const belly = k.y + k.h - 1;
  const [hx, hy] = k.headAt;
  const tailBackAt: [number, number] = [k.x - 4, k.y];

  const legsAt = (len: number, y: number, dx: (i: number) => number = () => 0): Placed[] =>
    k.legs.map((x, i): Placed => [thin(len), x + dx(i), y]);

  const standing = (eyes: Part, tail: Part, step: Step = []): Frame =>
    compose(
      [tail, ...k.tailAt],
      [body, k.x, top],
      ...k.legs.map((x, i): Placed => {
        const [dx, up] = step[i] ?? [0, false];
        return [thin(up ? k.len - 1 : k.len), x + dx, belly];
      }),
      [face(hd, eyes), hx, hy],
    );

  const leaping = (tail: Part): Frame =>
    compose(
      [tail, ...tailBackAt],
      [body, k.x, top],
      ...k.legs.map((x, i): Placed => {
        const [part, back] = slant(k.len, i < 2 ? -1 : 1);
        return [part, x - back, belly];
      }),
      [face(hd, hd.open), hx, hy],
    );

  const gathered = (): Frame =>
    compose(
      [k.tailBack[0], ...tailBackAt],
      [body, k.x, top],
      ...legsAt(k.len - 1, belly, (i) => (i < 2 ? 1 : -1)),
      [face(hd, hd.open), hx, hy + 1],
    );

  const crouching = (wiggle: boolean): Frame =>
    compose(
      [k.tailBack[0], k.x - 4, k.y + 3],
      [body, k.x, top + 2],
      ...legsAt(k.len - 2, belly + 2, (i) => (wiggle && i < 2 ? -1 : 0)),
      [face(hd, hd.open), hx + 1, hy + 2],
    );

  const skidding = (big: boolean): Frame => {
    const len = k.len - 1;
    const toe = k.legs[3] + len + 2;
    return compose(
      [k.tailBack[0], k.x - 4, k.y + 1],
      [body, k.x, top + 1],
      ...k.legs.map((x, i): Placed => [i < 2 ? thin(len) : slant(len, 1)[0], x, belly + 1]),
      [face(hd, hd.open, hd.bottom, hd.flat), hx - 1, hy + 1],
      big ? [DUST_BIG, toe, SIZE - 3] : [DUST_SMALL, toe + 1, SIZE - 2],
    );
  };

  const bonked = (stars: [number, number][]): Frame =>
    compose(
      [k.tail[0], ...k.tailAt],
      [body, k.x, top],
      ...legsAt(k.len, belly),
      [face(hd, hd.shut, hd.meow, hd.flat), hx - 1, hy + 1],
      ...stars.map(([x, y]): Placed => [STAR, x, y + hy - 13]),
    );

  const falling = (tail: Part, spread: boolean): Frame =>
    compose(
      [tail, ...k.tailAt],
      [body, k.x, top],
      ...legsAt(k.len, belly, (i) => (spread ? (i < 2 ? -1 : 1) : 0)),
      [face(hd, hd.open, hd.meow, hd.flat), hx, hy],
    );

  // Анфас сидя: туловище внизу по центру, голова над ним, хвост выглядывает справа.
  const sitBody = frontBody(fat, k.sit, true);
  const sitHalf = sitBody[0].length / 2;
  const sitTop = SIZE - sitBody.length;
  const [sx, sy] = k.sitHead;
  const sitTailAt: [number, number] = [13 + sitHalf, SIZE - k.sitTail.length];
  // Места мелочей вокруг мордочки — от её середины и подбородка, как у взрослой.
  const mid = sx + hw / 2;
  const chin = sy + hh;
  const meow: Placed = [hd.meow, sx, sy + mouthRow];
  const tongue: Placed = [TONGUE, mid - 1, chin - 1];
  const lickLeft: Placed[] = [[['p'], mid - 3, chin - 2], [['p'], mid - 2, chin - 1]];
  const lickRight: Placed[] = [[['p'], mid + 2, chin - 2], [['p'], mid + 1, chin - 1]];
  // Тортик стоит слева от туловища без жирка, лапа тянется к тарелке.
  const left = 16 - Math.max(...k.sit);

  const sitting = (eyes: Part, extra: Placed[] = [], mouth = hd.bottom, nod = 0, legs: boolean | 'right' = true): Frame => {
    const b = legs === true ? sitBody : frontBody(fat, k.sit, legs);
    return compose([k.sitTail, ...sitTailAt], [b, 16 - sitHalf, sitTop], [face(hd, eyes, mouth), sx, sy + nod], ...extra);
  };

  // Поднятая к морде лапа: от `y` до грудки.
  const raisedPaw = (y: number): Placed => [['.kk.', 'kllk', 'kllk', ...Array<string>(Math.max(0, sitTop - y - 1)).fill('kffk')], sx + 2, y];
  const groom = (dy: number, lick: boolean): Frame =>
    sitting(hd.shut, [...(lick ? [tongue] : []), raisedPaw(sy + dy)], hd.bottom, 0, 'right');

  const loafBody = frontBody(fat, k.loaf, false);
  const loafHalf = loafBody[0].length / 2;
  const loafTop = SIZE - loafBody.length;
  const loaf = (eyes: Part): Frame =>
    compose([k.sitTail, 13 + loafHalf, SIZE - k.sitTail.length], [loafBody, 16 - loafHalf, loafTop], k.paws, [face(hd, eyes), sx, loafTop - hh]);

  const sideLoaf = (eyes: Part): Frame => {
    const y = SIZE - body.length;
    return compose([body, k.x, y], [k.floorTail, k.x - 3, SIZE - 3], [face(hd, eyes), k.x + k.w - 6, y - hh + 4]);
  };

  // Калачик: нижний контур туловища и подбородок лежат на рамке (ряд 27), хвост свисает.
  const curl = sideOf(k.curl[0], k.curl[1], k.stripes, fat);
  const [cx, cy] = k.curlHead;
  const sleeping = (b: Part, tail: Part, z: Placed): Frame => compose([tail, 3, 26], [b, 5, 28 - b.length], [face(hd, hd.shut), cx, cy], z);
  const sleep: Anim = {
    ms: 1500,
    frames: [sleeping(curl, SLEEP_TAIL, [Z_SMALL, 25, cy - 6]), sleeping(inhale(curl), SLEEP_TAIL_SWAY, [Z_BIG, 26, cy - 11])],
  };

  const back = domeOf(k.dome, fat);
  const backTop = SIZE - back.length;
  const backHalf = back[0].length / 2;
  const tailUp = (tail: Part): Placed => [tail, 17, backTop - tail.length + 2];
  // Ест: хвост торчит над затылком — у малыша голова почти во всю спину и закрыла бы его.
  const eating = (dy: number, tail: Part): Frame =>
    compose(
      [tail, 17, SIZE - 11 - tail.length + 2],
      [back, 16 - backHalf, backTop],
      [face(hd, hd.shut), sx, SIZE - 11 + dy],
      [KIBBLE, BOWL_AT, SIZE - 7],
      [BOWL, BOWL_AT, SIZE - 5],
    );
  const faceplant = (tail: Part, z: Placed): Frame =>
    compose(tailUp(tail), [back, 16 - backHalf, backTop], [[...hd.top, 'k'.repeat(hw)], sx, SIZE - hd.top.length - 1], z);

  // На весу за шкирку анфас; кадр симметричен по контуру.
  const hang = frontBody(fat, k.hang, false);
  const hangHalf = hang[0].length / 2;
  const hangEnd = k.hangAt + hang.length - 1;
  const bw = k.hangBack[0].length;
  const carried = (eyes: Part, sway: boolean): Frame => {
    const d = sway ? 1 : 0;
    return compose(
      [k.hangTail, 14, hangEnd],
      [k.hangBack, 15 - bw - d, hangEnd],
      [k.hangBack, 17 + d, hangEnd],
      [hang, 16 - hangHalf, k.hangAt],
      [k.hangFront, 16 - hangHalf, k.hangAt + 3],
      [k.hangFront, 16 + hangHalf - k.hangFront[0].length, k.hangAt + 3],
      [SCRUFF, 14, 0],
      [face(hd, eyes), 16 - hw / 2, 1],
    );
  };

  const [t0, t1] = k.tail;
  return {
    stand: { ms: 500, frames: [standing(hd.open, t0), standing(hd.open, t1), standing(hd.open, t0), standing(hd.shut, t0)] },
    walk: {
      ms: 150,
      frames: [standing(hd.open, t0, SPREAD), standing(hd.open, t1, LIFT_A), standing(hd.open, t0, SPREAD), standing(hd.open, t1, LIFT_B)],
    },
    jump: { ms: 200, frames: [leaping(k.tailBack[0]), leaping(k.tailBack[1])] },
    run: { ms: 90, frames: [leaping(k.tailBack[0]), gathered()] },
    crouch: { ms: 220, frames: [crouching(false), crouching(true)] },
    skid: { ms: 100, frames: [skidding(false), skidding(true)] },
    bonk: { ms: 200, frames: [bonked([[26, 9], [29, 12]]), bonked([[28, 8], [24, 11]])] },
    fall: { ms: 150, frames: [falling(t0, false), falling(t1, true)] },
    sit: { ms: 600, frames: [hd.open, hd.open, hd.open, hd.open, hd.shut].map((e) => sitting(e)) },
    loaf: { ms: 1000, frames: [hd.open, hd.open, hd.open, hd.open, hd.shut].map(loaf) },
    sideLoaf: { ms: 1000, frames: [hd.open, hd.open, hd.open, hd.open, hd.shut].map(sideLoaf) },
    sleep,
    bed: { ms: sleep.ms, frames: sleep.frames.map(inBed) },
    carried: { ms: 450, frames: [carried(hd.open, false), carried(hd.open, true), carried(hd.open, false), carried(hd.shut, false)] },
    faceplant: { ms: 1500, frames: [faceplant(t0, [Z_SMALL, 25, backTop - 3]), faceplant(t1, [Z_BIG, 26, backTop - 8])] },
    hungry: {
      ms: 600,
      frames: [hd.bottom, hd.bottom, hd.meow, hd.bottom, null].map((m) =>
        sitting(m ? hd.open : hd.shut, [[BOWL, BOWL_AT, SIZE - 5]], m ?? hd.bottom),
      ),
    },
    eat: { ms: 300, frames: [eating(0, t0), eating(1, t0), eating(0, t1), eating(1, t1)] },
    groom: { ms: 350, frames: [groom(hh - 3, true), groom(hh - 2, false), groom(hh - 3, true), groom(2, false), groom(4, false), groom(2, false)] },
    petted: { ms: 400, frames: [sitting(hd.happy, [[HEART, mid - 3, sy - 7]]), sitting(hd.happy, [[HEART, mid - 3, sy - 8]])] },
    groggy: {
      ms: 700,
      frames: [
        sitting(hd.sleepy),
        sitting(hd.shut, [], hd.bottom, 1),
        sitting(hd.shut, [], hd.bottom, 1),
        sitting(hd.sleepy),
        sitting(hd.shut, [], hd.meow),
        sitting(hd.sleepy),
      ],
    },
    smug: { ms: 600, frames: [hd.happy, hd.happy, hd.happy, hd.shut].map((e) => sitting(e)) },
    strut: {
      ms: 150,
      frames: [standing(hd.happy, t0, SPREAD), standing(hd.happy, t1, LIFT_A), standing(hd.happy, t0, SPREAD), standing(hd.happy, t1, LIFT_B)],
    },
    lick: { ms: 180, frames: [sitting(hd.happy, lickLeft), sitting(hd.happy, [tongue]), sitting(hd.happy, lickRight), sitting(hd.happy, [tongue])] },
    pose: {
      ms: 500,
      frames: [
        sitting(hd.happy, [meow]),
        sitting(hd.happy, [meow, [STAR, 3, 4], [STAR, 26, 6]]),
        sitting(hd.happy, [meow]),
        sitting(hd.happy, [meow]),
      ],
    },
    crunch: {
      ms: 220,
      frames: [
        sitting(hd.shut, [meow, [['c'], mid - 2, chin + 1]]),
        sitting(hd.shut, [[['C'], mid + 1, chin + 2]]),
        sitting(hd.shut, [meow, [['c'], mid + 2, chin + 1]]),
        sitting(hd.happy, [[['c'], mid - 2, chin + 3]]),
      ],
    },
    cake: {
      ms: 450,
      frames: [
        sitting(hd.open, [[CAKE, left - 9, 24]]),
        sitting(hd.open, [[CAKE, left - 9, 24], [PAW_SIDE, left - 2, 28]]),
        sitting(hd.shut, [[CAKE, left - 10, 24], [PAW_SIDE, left - 3, 28]]),
        sitting(hd.happy, [[CAKE, left - 10, 24]]),
      ],
    },
    flyWatch: { ms: 250, frames: FLY_ORBIT.map(([x, y]) => sitting(hd.open, [[FLY, x, y + sy - 12]])) },
    snap: {
      ms: 200,
      frames: [sitting(hd.open, [meow, [FLY, mid - 2, chin - 5]]), sitting(hd.shut, [meow, [['k'], mid - 1, chin - 3]]), sitting(hd.shut)],
    },
    chew: { ms: 200, frames: [sitting(hd.shut, [meow]), sitting(hd.shut), sitting(hd.shut, [meow]), sitting(hd.happy)] },
    announce: { ms: 300, frames: [sitting(hd.open, [meow]), sitting(hd.open), sitting(hd.open, [meow]), sitting(hd.open)] },
    squint: { ms: 700, frames: [hd.sleepy, hd.sleepy, hd.sleepy, hd.shut].map((e) => sitting(e, [], hd.smug)) },
  } satisfies Partial<Record<keyof Anims, Anim>>;
}

/** Позы, которые у молодых нарисованы свои; остальные (злость, лоток, месть, сон носом в пол сбоку) — взрослые. */
export const YOUNG_POSES = Object.keys(build(KIT, 0)) as (keyof Anims)[];

const full = (k: Kit, fat: Fat): Anims => ({ ...ANIMS[fat], ...build(k, fat) });

/** Все позы малыша [0] и подростка [1] при каждом жирке; собираются один раз. */
export const YOUNG_ANIMS: Record<Young, Record<Fat, Anims>> = {
  0: { 0: full(KIT, 0), 1: full(KIT, 1), 2: full(KIT, 2) },
  1: { 0: full(TEEN, 0), 1: full(TEEN, 1), 2: full(TEEN, 2) },
};
