import { describe, expect, it } from 'vitest';
import { BACK_MS, DURATION_MS, envelope, field, MAX_SHIFT, render, SHOVE_MS, type Shot } from './push';

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: 1,
  width: 160,
  height: 160,
  x: 80,
  y: 80,
  dx: 1,
  dy: 0,
  scale: 1,
  open: [false, false, false, false],
  ...over,
});

/** Пёстрый снимок: у каждого пикселя свой цвет, чтобы любой сдвиг был виден. */
function noise(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = (i * 37) & 255;
    px[i * 4 + 1] = (i * 91 + 13) & 255;
    px[i * 4 + 2] = (i * 151 + 7) & 255;
    px[i * 4 + 3] = 255;
  }
  return px;
}

function shift(f: ReturnType<typeof field>, x: number, y: number, w: number): [number, number] {
  const n = f.idx.indexOf(y * w + x);
  return n < 0 ? [0, 0] : [f.fx[n], f.fy[n]];
}

function border(w: number, h: number, i: number): boolean {
  const x = i % w;
  const y = Math.floor(i / w);
  return x === 0 || y === 0 || x === w - 1 || y === h - 1;
}

describe('envelope', () => {
  it('стоит на месте до и после эффекта', () => {
    expect(envelope(-5)).toBe(0);
    expect(envelope(0)).toBe(0);
    expect(envelope(DURATION_MS)).toBe(0);
    expect(envelope(DURATION_MS + 100)).toBe(0);
  });

  it('толкает быстро и до упора', () => {
    let prev = 0;
    for (let ms = 5; ms < SHOVE_MS; ms += 5) {
      expect(envelope(ms)).toBeGreaterThan(prev);
      prev = envelope(ms);
    }
    expect(envelope(SHOVE_MS / 2)).toBeGreaterThan(0.8);
    expect(envelope(SHOVE_MS)).toBeCloseTo(1, 6);
  });

  it('возвращается с одним небольшим перелётом и тихо гаснет', () => {
    let min = 1;
    let crossings = 0;
    let prev = envelope(SHOVE_MS);
    for (let ms = SHOVE_MS + 1; ms < DURATION_MS; ms++) {
      const a = envelope(ms);
      min = Math.min(min, a);
      if (Math.sign(a) !== Math.sign(prev) && a !== 0) crossings++;
      prev = a;
    }
    expect(min).toBeLessThan(-0.08);
    expect(min).toBeGreaterThan(-0.25);
    expect(crossings).toBe(1);
    expect(Math.abs(envelope(DURATION_MS - 1))).toBeLessThan(0.001);
    expect(BACK_MS).toBeGreaterThanOrEqual(350);
  });
});

describe('field', () => {
  it('самое большое смещение — MAX_SHIFT с учётом масштаба', () => {
    for (const scale of [1, 1.5]) {
      const s = shot({ width: 160 * scale, height: 160 * scale, x: 80 * scale, y: 80 * scale, scale });
      const f = field(s);
      let peak = 0;
      for (let n = 0; n < f.idx.length; n++) peak = Math.max(peak, Math.hypot(f.fx[n], f.fy[n]));
      expect(peak).toBeCloseTo(MAX_SHIFT * scale, 4);
    }
  });

  it('под точкой толкает по ходу заноса', () => {
    const f = field(shot({ dx: 0.6, dy: -0.8 }));
    const [vx, vy] = shift(f, 80, 80, 160);
    expect(vx * 0.6 + vy * -0.8).toBeGreaterThan(MAX_SHIFT / 2);
  });

  it('по бокам толкает наружу', () => {
    const f = field(shot());
    // занос вправо: сверху от точки уводит вверх, снизу — вниз
    expect(shift(f, 85, 50, 160)[1]).toBeLessThan(0);
    expect(shift(f, 85, 110, 160)[1]).toBeGreaterThan(0);
  });

  it('на краю снимка смещения нет', () => {
    const f = field(shot({ dx: Math.SQRT1_2, dy: Math.SQRT1_2 }));
    for (const i of f.idx) expect(border(160, 160, i)).toBe(false);
  });

  it('у обрезанного края гаснет, у края экрана — нет', () => {
    // разворот в 10 px от левого края экрана, точка шла влево, в край
    const s = shot({ width: 90, x: 10, dx: -1, dy: 0 });
    const closed = field(s);
    for (const i of closed.idx) expect(border(90, 160, i)).toBe(false);
    const open = field({ ...s, open: [true, false, false, false] });
    const leftEdge = [...open.idx].filter((i) => i % 90 === 0);
    expect(leftEdge.length).toBeGreaterThan(0);
    for (const i of open.idx) expect(i % 90 === 89 || i < 90 || i >= 90 * 159).toBe(false);
  });

  it('гладко: соседние пиксели почти не расходятся', () => {
    const f = field(shot({ dx: 0.8, dy: 0.6 }));
    const map = new Map<number, [number, number]>();
    f.idx.forEach((i, n) => map.set(i, [f.fx[n], f.fy[n]]));
    let worst = 0;
    for (const [i, [vx, vy]] of map) {
      const [rx, ry] = map.get(i + 1) ?? [0, 0];
      const [bx, by] = map.get(i + 160) ?? [0, 0];
      worst = Math.max(worst, Math.hypot(vx - rx, vy - ry), Math.hypot(vx - bx, vy - by));
    }
    // меньше пикселя на пиксель: обратное отображение не складывается внахлёст
    expect(worst).toBeLessThan(0.5);
  });
});

describe('render', () => {
  const w = 160;
  const h = 160;
  const src = noise(w, h);
  const f = field(shot());

  it('без размаха — копия байт в байт', () => {
    const out = new Uint8ClampedArray(src.length);
    render(src, out, w, h, f, 0);
    expect(out).toEqual(src);
  });

  it('на полном размахе край совпадает со снимком, а середина сдвинута', () => {
    const out = new Uint8ClampedArray(src.length);
    render(src, out, w, h, f, 1);
    for (let i = 0; i < w * h; i++) {
      if (!border(w, h, i)) continue;
      for (let c = 0; c < 4; c++) expect(out[i * 4 + c]).toBe(src[i * 4 + c]);
    }
    let moved = 0;
    for (let i = 0; i < w * h * 4; i++) if (out[i] !== src[i]) moved++;
    expect(moved).toBeGreaterThan(1000);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it('содержимое переезжает по ходу заноса', () => {
    // одна вертикальная чёрная полоса на белом прямо под точкой
    const line = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) line.fill(0, (y * w + 80) * 4, (y * w + 80) * 4 + 3);
    const out = new Uint8ClampedArray(line.length);
    render(line, out, w, h, f, 1);
    const row = 80;
    let darkest = 0;
    let at = 0;
    for (let x = 0; x < w; x++) {
      const v = 255 - out[(row * w + x) * 4];
      if (v > darkest) [darkest, at] = [v, x];
    }
    expect(at).toBeGreaterThan(80 + MAX_SHIFT / 2);
    expect(at).toBeLessThanOrEqual(80 + MAX_SHIFT + 1);
  });
});
