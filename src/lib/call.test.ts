import { describe, expect, it } from 'vitest';
import { fresh, onCall, RETURN_MS, step, type Hide } from './call';

const T0 = 1_700_000_000_000;

/** Прогнать ответы `senses` раз в 2 с: `calls[i]` — шёл ли созвон на i-м ответе. */
function run(h: Hide, calls: boolean[], from = T0): Hide {
  calls.forEach((c, i) => (h = step(h, c, from + i * 2000)));
  return h;
}

describe('call', () => {
  it('без созвона не прячется', () => {
    expect(onCall(fresh())).toBe(false);
    expect(onCall(run(fresh(), [false, false, false]))).toBe(false);
  });

  it('прячется сразу, на первом же ответе', () => {
    const h = step(fresh(), true, T0);
    expect(onCall(h)).toBe(true);
    expect(h.seen).toBe(T0);
  });

  it('после созвона ждёт RETURN_MS тишины и выходит', () => {
    let h = step(fresh(), true, T0);
    h = step(h, false, T0 + RETURN_MS - 1);
    expect(onCall(h)).toBe(true);
    h = step(h, false, T0 + RETURN_MS);
    expect(onCall(h)).toBe(false);
  });

  it('короткий mute/unmute не выпускает её за край', () => {
    // 10 с без микрофона посреди созвона — меньше RETURN_MS
    const blink = [true, true, false, false, false, false, false, true, true];
    let h = run(fresh(), blink);
    expect(onCall(h)).toBe(true);
    // отсчёт тишины — от последнего «да», а не от первого
    const last = T0 + (blink.length - 1) * 2000;
    h = step(h, false, last + RETURN_MS - 1);
    expect(onCall(h)).toBe(true);
    expect(onCall(step(h, false, last + RETURN_MS))).toBe(false);
  });

  it('вышла — новый созвон снова прячет сразу', () => {
    let h = step(fresh(), true, T0);
    h = step(h, false, T0 + RETURN_MS);
    expect(onCall(h)).toBe(false);
    expect(onCall(step(h, true, T0 + RETURN_MS + 2000))).toBe(true);
  });

  it('часы ушли назад — тишина считается заново, а не держит часами', () => {
    let h = step(fresh(), true, T0);
    const back = T0 - 3600_000;
    h = step(h, false, back);
    expect(onCall(h)).toBe(true);
    expect(h.seen).toBe(back);
    expect(onCall(step(h, false, back + RETURN_MS))).toBe(false);
  });

  it('без созвона состояние не меняется — тот же объект', () => {
    const h = fresh();
    expect(step(h, false, T0)).toBe(h);
  });
});
