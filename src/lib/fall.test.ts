import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALL_TICK_MS, fallAt, fallen, Placer, type Spot } from './fall';
import { GRAVITY, MAX_FALL } from './roam';

describe('падение вещи', () => {
  it('разгоняется как кошка и упирается в предел скорости', () => {
    expect(fallen(0, 1)).toBe(0);
    expect(fallen(100, 1)).toBeCloseTo((GRAVITY * 0.01) / 2);
    const tv = MAX_FALL / GRAVITY;
    expect(fallen(tv * 1000 + 1000, 1)).toBeCloseTo((GRAVITY * tv * tv) / 2 + MAX_FALL);
    expect(fallen(500, 2)).toBeCloseTo(fallen(500, 1) * 2);
  });

  it('по дороге — между, долетела — ровно в цели', () => {
    const from = { x: 100, bottom: 200 };
    const to = { x: 200, bottom: 1200 };
    const mid = fallAt(from, to, 300, 1);
    expect(mid.done).toBe(false);
    expect(mid.at.bottom).toBe(Math.round(200 + fallen(300, 1)));
    expect(mid.at.x).toBeGreaterThan(100);
    expect(mid.at.x).toBeLessThan(200);
    expect(fallAt(from, to, 10_000, 1)).toEqual({ at: to, done: true });
  });

  it('цель выше — сразу там', () => {
    expect(fallAt({ x: 0, bottom: 500 }, { x: 10, bottom: 400 }, 0, 1)).toEqual({ at: { x: 10, bottom: 400 }, done: true });
  });
});

describe('Placer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    const puts: Spot[] = [];
    return { puts, p: new Placer((s) => puts.push(s), () => 1) };
  }

  it('без падения — сразу на место, повтор не шлёт', () => {
    const { puts, p } = make();
    p.go({ x: 10, bottom: 20 }, false);
    p.go({ x: 10, bottom: 20 }, false);
    expect(puts).toEqual([{ x: 10, bottom: 20 }]);
  });

  it('брошенная — падает с места броска до цели', () => {
    vi.useFakeTimers();
    const { puts, p } = make();
    p.go({ x: 500, bottom: 1040 }, false);
    p.grab();
    p.go({ x: 500, bottom: 1040 }, false);
    expect(puts.length).toBe(1);
    p.release({ x: 800, bottom: 300 });
    p.go({ x: 800, bottom: 600 }, true);
    expect(puts[1]).toEqual({ x: 800, bottom: 300 });
    vi.advanceTimersByTime(FALL_TICK_MS * 3);
    const last = puts[puts.length - 1];
    expect(last.bottom).toBeGreaterThan(300);
    expect(last.bottom).toBeLessThan(600);
    vi.advanceTimersByTime(5000);
    expect(puts[puts.length - 1]).toEqual({ x: 800, bottom: 600 });
    const n = puts.length;
    vi.advanceTimersByTime(1000);
    expect(puts.length).toBe(n);
  });

  it('новая цель посреди падения — падает к ней с текущей высоты', () => {
    vi.useFakeTimers();
    const { puts, p } = make();
    p.release({ x: 100, bottom: 0 });
    p.go({ x: 100, bottom: 1000 }, true);
    vi.advanceTimersByTime(200);
    const mid = puts[puts.length - 1].bottom;
    p.go({ x: 100, bottom: 1040 }, true);
    expect(puts[puts.length - 1].bottom).toBe(mid);
    vi.advanceTimersByTime(5000);
    expect(puts[puts.length - 1]).toEqual({ x: 100, bottom: 1040 });
  });
});
