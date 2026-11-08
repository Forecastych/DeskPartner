import { describe, expect, it } from 'vitest';
import {
  ADULT_AT,
  animsFor,
  apply,
  due,
  formStage,
  fresh,
  legacy,
  load,
  momentAt,
  momentMs,
  real,
  remaining,
  save,
  sparkle,
  SPARK_MS,
  shown,
  stageOf,
  steps,
  STEP_MS,
  TEEN_AT,
  totalMs,
  HOLD_MS,
  type Stage,
} from './growth';
import { ANIMS, hitMask } from './sprite';
import { YOUNG_ANIMS } from './sprite-young';

const H = 3_600_000;

describe('стадия по времени вместе', () => {
  it('малыш до 360 ч, подросток до 720 ч, дальше взрослая', () => {
    expect([0, 359 * H, 360 * H, 719 * H, 720 * H, 5000 * H].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(TEEN_AT).toBe(360 * H);
    expect(ADULT_AT).toBe(720 * H);
  });

  it('счёт — от появления этого питомца, а не от установки', () => {
    const g = fresh(1000 * H);
    expect(real(g, 1000 * H)).toBe(0);
    expect(real(g, 1360 * H)).toBe(1);
    expect(real(g, 1720 * H)).toBe(2);
  });

  it('пришедшая из старой версии всегда взрослая', () => {
    expect(real(legacy(), 0)).toBe(2);
    expect(shown(legacy(), 0, 'kitten')).toBe(2);
  });
});

describe('хранение и миграция', () => {
  it('свежая установка — малыш, обновление — взрослая, которую человек уже видел', () => {
    expect(load(null, false)).toEqual(fresh());
    expect(load(null, true)).toEqual({ born: 0, grown: true, seen: 2, power: false });
  });

  it('сохранённое читается как есть, мусор — как отсутствие', () => {
    const g = { born: 42 * H, grown: false, seen: 1 as Stage, power: true };
    expect(load(save(g), true)).toEqual(g);
    expect(load('{oops', true)).toEqual(legacy());
    expect(load('7', false)).toEqual(fresh());
    expect(load('{"born":-5,"seen":9,"grown":"yes"}', true)).toEqual({ born: 0, grown: false, seen: 0, power: false });
  });
});

describe('моменты', () => {
  it('рост без момента не виден: на экране прежняя стадия, пока момент не показан', () => {
    const g = fresh();
    expect(shown(g, 400 * H, 'adult')).toBe(0);
    expect(due(g, 400 * H)).toBe('grow');
    const after = apply(g, 400 * H, 'grow');
    expect(after.seen).toBe(1);
    expect(shown(after, 400 * H, 'adult')).toBe(1);
    expect(due(after, 400 * H)).toBeNull();
  });

  it('через месяц — момент силы вместо простого роста; после него форма из настроек', () => {
    const g = apply(fresh(), 400 * H, 'grow');
    expect(due(g, 720 * H)).toBe('power');
    const p = apply(g, 720 * H, 'power');
    expect(p).toMatchObject({ seen: 2, power: true });
    expect(due(p, 9999 * H)).toBeNull();
    expect(shown(p, 720 * H, 'kitten')).toBe(0);
    expect(shown(p, 720 * H, 'teen')).toBe(1);
    expect(shown(p, 720 * H, 'adult')).toBe(2);
  });

  it('старый пользователь: сила по общему счёту, без роста до неё', () => {
    expect(due(legacy(), 100 * H)).toBeNull();
    expect(due(legacy(), 800 * H)).toBe('power');
  });

  it('сколько ждать выбора формы', () => {
    expect(remaining(fresh(), 0)).toBe(ADULT_AT);
    expect(remaining(fresh(100 * H), 400 * H)).toBe(420 * H);
    expect(remaining(fresh(), 900 * H)).toBe(0);
    expect(remaining({ ...legacy(), power: true }, 0)).toBe(0);
  });

  it('пути: рост — от старой стадии к новой, сила — вырасти, уменьшиться и вырасти обратно', () => {
    expect(steps(fresh(), 400 * H, 'grow')).toEqual([0, 1]);
    expect(steps(apply(fresh(), 400 * H, 'grow'), 720 * H, 'power')).toEqual([1, 2, 1, 0, 1, 2]);
    expect(steps(legacy(), 800 * H, 'power')).toEqual([2, 1, 0, 1, 2]);
  });

  it('мерцание: начинается со старой стадии, кончается новой, смены учащаются', () => {
    const path: Stage[] = [0, 1];
    expect(momentAt(path, 0)).toBe(0);
    expect(momentAt(path, STEP_MS * 0.9)).toBe(1);
    expect(momentAt(path, momentMs(path) + 5000)).toBe(1);
    const flips = (from: number, to: number) => {
      let n = 0;
      for (let t = from; t < to; t += 5) if (momentAt(path, t) !== momentAt(path, t + 5)) n++;
      return n;
    };
    const half = (STEP_MS * 0.8) / 2;
    expect(flips(half, 2 * half)).toBeGreaterThan(flips(0, half));
    expect(momentMs([1, 2, 1, 0, 1, 2])).toBe(5 * STEP_MS);
  });
});

describe('форма и кадры', () => {
  it('форма из настроек — стадия', () => {
    expect([formStage('kitten'), formStage('teen'), formStage('adult')]).toEqual([0, 1, 2]);
  });

  it('набор кадров по стадии и жирку', () => {
    expect(animsFor(2, 1)).toBe(ANIMS[1]);
    expect(animsFor(0, 2)).toBe(YOUNG_ANIMS[0][2]);
    expect(animsFor(1, 0)).toBe(YOUNG_ANIMS[1][0]);
  });

  it('звёздочки: только по пустым клеткам, мигают и не меняют силуэт для кликов', () => {
    const frame = animsFor(0, 0).sit.frames[0];
    const a = sparkle(frame, 0);
    const b = sparkle(frame, SPARK_MS);
    expect(a).not.toEqual(frame);
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(32);
    expect(a.every((r) => r.length === 32)).toBe(true);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        if (frame[y][x] !== '.') expect(a[y][x]).toBe(frame[y][x]);
        else expect(['.', 's']).toContain(a[y][x]);
      }
    expect(hitMask(a)).toEqual(hitMask(frame));
  });

  it('момент держится после переходов', () => {
    expect(totalMs([0, 1])).toBe(STEP_MS + HOLD_MS);
  });
});
