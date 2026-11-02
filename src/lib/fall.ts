import { GRAVITY, MAX_FALL } from './roam';

/** Где стоит окно миски или лежака: x — середина, bottom — низ, физ. px (как в place_pet). */
export interface Spot {
  x: number;
  bottom: number;
}

/** Шаг анимации падения, мс. */
export const FALL_TICK_MS = 16;

/** Сколько пролетела вещь за ms, физ. px: разгон как у кошки, скорость не выше MAX_FALL. */
export function fallen(ms: number, scale: number): number {
  const t = Math.max(ms, 0) / 1000;
  const g = GRAVITY * scale;
  const v = MAX_FALL * scale;
  const tv = v / g;
  return t <= tv ? (g * t * t) / 2 : (g * tv * tv) / 2 + v * (t - tv);
}

/** Окно вещи через ms после начала падения из from в to; долетела — ровно в to. x подтягивается вместе с высотой. */
export function fallAt(from: Spot, to: Spot, ms: number, scale: number): { at: Spot; done: boolean } {
  const dy = to.bottom - from.bottom;
  const d = fallen(ms, scale);
  if (dy <= 0 || d >= dy) return { at: to, done: true };
  const k = d / dy;
  return { at: { x: Math.round(from.x + (to.x - from.x) * k), bottom: Math.round(from.bottom + d) }, done: false };
}

/**
 * Ставит окно вещи туда, куда велит окно кошки: сразу или падением с того места, где оно сейчас.
 * Пока вещь тащат, окно двигает Rust — сюда ничего не применяется.
 */
export class Placer {
  private at: Spot | null = null;
  private last = '';
  private holding = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly put: (s: Spot) => void,
    private readonly scale: () => number,
  ) {}

  /** Вещь взяли мышью. */
  grab() {
    this.stop();
    this.holding = true;
  }

  /** Отпустили: бросили — падать отсюда; просто щёлкнули — окно где было. */
  release(at: Spot | null) {
    this.holding = false;
    if (at) this.at = at;
    this.last = '';
  }

  go(to: Spot, fall: boolean) {
    if (this.holding) return;
    const key = `${to.x},${to.bottom}`;
    if (key === this.last) return;
    this.last = key;
    this.stop();
    const from = this.at;
    if (!fall || !from || to.bottom <= from.bottom) {
      this.at = to;
      this.put(to);
      return;
    }
    const t0 = Date.now();
    const tick = () => {
      const f = fallAt(from, to, Date.now() - t0, this.scale());
      this.at = f.at;
      this.put(f.at);
      if (f.done) this.stop();
    };
    this.timer = setInterval(tick, FALL_TICK_MS);
    tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
