// Эффект заноса лазерной точки: снимок экрана вокруг крутого разворота, в котором то, что было
// под точкой, отбросило по ходу и чуть наружу, а потом оно пружинит обратно. Только рисунок:
// на экране ничего не двигается. Снимок и разворот присылает Rust (laser.rs), всё в физических пикселях.

/** Что Rust сообщает о снимке до того, как отдать пиксели. */
export interface Shot {
  id: number;
  /** Размер снимка; пикселей придёт `width * height * 4` байт RGBA. */
  width: number;
  height: number;
  /** Точка разворота внутри снимка. */
  x: number;
  y: number;
  /** Куда заносило, единичный вектор. */
  dx: number;
  dy: number;
  /** DPI / 96 монитора, где разворот. */
  scale: number;
  /** Стороны (левая, верхняя, правая, нижняя), за которыми нет экрана: там смещение может не гаснуть. */
  open: [boolean, boolean, boolean, boolean];
}

/** Наибольшее смещение, логические пиксели. */
export const MAX_SHIFT = 12;
/** Где смещение сходит к нулю, логические пиксели от середины эффекта. Снимок — 160 × 160,
 *  так что с выносом вперёд круг целиком внутри и на краю снимка смещения нет. */
export const RADIUS = 66;
/** Середина эффекта вынесена вперёд по ходу на эту долю радиуса: точку занесло, толкает перед собой. */
const AHEAD = 0.15;
/** Насколько смещение «наружу» сильнее или слабее смещения «по ходу». */
const OUTWARD = 0.6;
/** Ближе к середине «наружу» растёт линейно от нуля: в самой середине нет излома. */
const CORE = 0.35;
/** Полоса у обрезанного края снимка, где смещение гаснет до нуля, логические пиксели. */
export const EDGE = 20;
/** Смещения меньше этого (физ. пиксели при полном размахе) не считаем: глазу их не видно. */
const TINY = 0.01;

/** Толчок: быстро и с замедлением к концу. */
export const SHOVE_MS = 80;
/** Возврат с небольшим перелётом. */
export const BACK_MS = 400;
export const DURATION_MS = SHOVE_MS + BACK_MS;

/** Размах смещения в момент `ms` от начала: 0 — на месте, 1 — отброшено до упора,
 *  меньше нуля — перелёт назад при возврате. До и после эффекта ровно 0. */
export function envelope(ms: number): number {
  if (ms <= 0 || ms >= DURATION_MS) return 0;
  if (ms < SHOVE_MS) return 1 - (1 - ms / SHOVE_MS) ** 3;
  const u = (ms - SHOVE_MS) / BACK_MS;
  // один перелёт около −17% и спокойный конец: и косинус, и множитель к концу сходят к нулю
  return Math.cos(1.5 * Math.PI * u) * (1 - u) ** 2;
}

/** Смещения при полном размахе, только у тех пикселей, которые вообще двигаются. */
export interface Field {
  /** Индексы пикселей: y * width + x. */
  idx: Uint32Array;
  /** Куда сдвинуто содержимое этого пикселя, физ. пиксели. */
  fx: Float32Array;
  fy: Float32Array;
}

/** Поле смещений для снимка: по ходу заноса и наружу от точки, гладко гаснущее к краю круга
 *  и к обрезанным краям снимка. Крайние пиксели снимка (кроме сторон `open`) не двигаются совсем. */
export function field(shot: Shot): Field {
  const { width: w, height: h, scale } = shot;
  const r = RADIUS * scale;
  const edge = EDGE * scale;
  const cx = shot.x + shot.dx * AHEAD * r;
  const cy = shot.y + shot.dy * AHEAD * r;
  const [openL, openT, openR, openB] = shot.open;
  const idx: number[] = [];
  const fx: number[] = [];
  const fy: number[] = [];
  let peak = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rx = x - cx;
      const ry = y - cy;
      const d2 = rx * rx + ry * ry;
      if (d2 >= r * r) continue;
      const q = 1 - d2 / (r * r);
      // расстояние до ближайшего края, у которого смещение должно погаснуть
      let near = Infinity;
      if (!openL) near = Math.min(near, x);
      if (!openT) near = Math.min(near, y);
      if (!openR) near = Math.min(near, w - 1 - x);
      if (!openB) near = Math.min(near, h - 1 - y);
      const t = Math.min(1, near / edge);
      const k = q * q * t * t * (3 - 2 * t);
      if (k <= 0) continue;
      const out = OUTWARD / Math.max(Math.sqrt(d2), CORE * r);
      const vx = k * (shot.dx + rx * out);
      const vy = k * (shot.dy + ry * out);
      idx.push(y * w + x);
      fx.push(vx);
      fy.push(vy);
      peak = Math.max(peak, Math.hypot(vx, vy));
    }
  }
  const norm = peak > 0 ? (MAX_SHIFT * scale) / peak : 0;
  const keep: number[] = [];
  for (let i = 0; i < idx.length; i++) {
    if (Math.hypot(fx[i], fy[i]) * norm >= TINY) keep.push(i);
  }
  return {
    idx: Uint32Array.from(keep, (i) => idx[i]),
    fx: Float32Array.from(keep, (i) => fx[i] * norm),
    fy: Float32Array.from(keep, (i) => fy[i] * norm),
  };
}

/** Кадр эффекта с размахом `a` в `out`: каждый сдвинутый пиксель берёт цвет оттуда, откуда
 *  его принесло (обратное отображение, билинейно). Остальное — копия снимка, байт в байт. */
export function render(src: Uint8ClampedArray, out: Uint8ClampedArray, w: number, h: number, f: Field, a: number) {
  out.set(src);
  if (a === 0) return;
  const { idx, fx, fy } = f;
  const mx = w - 1;
  const my = h - 1;
  for (let n = 0; n < idx.length; n++) {
    const i = idx[n];
    const px = i % w;
    const py = (i - px) / w;
    const sx = Math.min(mx, Math.max(0, px - a * fx[n]));
    const sy = Math.min(my, Math.max(0, py - a * fy[n]));
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const tx = sx - x0;
    const ty = sy - y0;
    const a00 = (y0 * w + x0) * 4;
    const a10 = (y0 * w + Math.min(mx, x0 + 1)) * 4;
    const a01 = (Math.min(my, y0 + 1) * w + x0) * 4;
    const a11 = (Math.min(my, y0 + 1) * w + Math.min(mx, x0 + 1)) * 4;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      out[o + c] = src[a00 + c] * w00 + src[a10 + c] * w10 + src[a01 + c] * w01 + src[a11 + c] * w11;
    }
    // снимок непрозрачный, альфа остаётся 255 от копии
  }
}
