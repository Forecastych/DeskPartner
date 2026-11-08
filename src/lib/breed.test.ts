import { afterEach, describe, expect, it } from 'vitest';
import { CHANCE_MAX, SOFT_MAX, SOFT_MIN, TRAITS, breedName, grudgeChance, grudgeMs, playGap, soft, talkRange, temper, traits } from './breed';
import { RANGES, interval } from './chatter';
import { setLang } from './i18n';
import { CHANCE, GRUDGE_FLOOR, GRUDGE_MS, fresh as freshRevenge, poked, provoke, PESTER_CLICKS } from './revenge';
import { BREEDS } from './settings';
import { AWAKE_MS, NAP_MS, fresh as freshSleep, step, type Sleep, type SleepEvent } from './sleep';

const MIN = 60_000;

describe('характер окраса', () => {
  afterEach(() => setLang('ru'));

  it('мягкий множитель: в пределах 0.7–1.4, мусор — 1', () => {
    expect(soft(1)).toBe(1);
    expect(soft(0.1)).toBe(SOFT_MIN);
    expect(soft(9)).toBe(SOFT_MAX);
    for (const bad of [NaN, Infinity, undefined, '1.2', null]) expect(soft(bad)).toBe(1);
  });

  it('серая полосатая — все черты ровно 1; неизвестный окрас — как серая', () => {
    expect(traits('tabby')).toEqual({ sleepy: 1, talky: 1, playful: 1, touchy: 1 });
    expect(traits('siamese')).toBe(TRAITS.tabby);
  });

  it('у каждого окраса свои черты, все мягкие, и одинаковых нет', () => {
    const seen = new Set<string>();
    for (const b of BREEDS) {
      const tr = traits(b);
      for (const v of Object.values(tr)) {
        expect(v).toBeGreaterThanOrEqual(SOFT_MIN);
        expect(v).toBeLessThanOrEqual(SOFT_MAX);
      }
      seen.add(JSON.stringify(tr));
    }
    expect(seen.size).toBe(BREEDS.length);
  });

  it('разговорчивость: при 1 диапазон тот же; болтушка не чаще нижней границы, молчаливая — реже', () => {
    const r = RANGES.sometimes!;
    expect(talkRange(r, 1)).toEqual(r);
    const [lo, hi] = talkRange(r, 1.4);
    expect(lo).toBe(r[0]);
    expect(hi).toBeLessThan(r[1]);
    expect(hi).toBeGreaterThanOrEqual(lo);
    const [slo, shi] = talkRange(r, 0.7);
    expect(slo).toBeGreaterThan(r[0]);
    expect(shi).toBeGreaterThan(r[1]);
    expect(shi).toBeLessThanOrEqual(r[1] / SOFT_MIN + 1e-9);
  });

  it('интервал реплик: по умолчанию прежний, болтушка ≥10 минут, молчун молчит у любой', () => {
    for (const x of [0, 0.5, 0.999]) {
      expect(interval('sometimes', 0, () => x)).toBe(interval('sometimes', 0, () => x, 1));
      expect(interval('sometimes', 0, () => x, 1.4)).toBeGreaterThanOrEqual(10 * MIN);
      expect(interval('sometimes', 0, () => x, 1.4)).toBeLessThanOrEqual(interval('sometimes', 0, () => x));
      expect(interval('sometimes', 0, () => x, 0.7)).toBeGreaterThan(interval('sometimes', 0, () => x));
    }
    expect(interval('quiet', 0, () => 0.5, 1.4)).toBe(Infinity);
  });

  it('игривость: перерыв до игры короче у игривой, длиннее у ленивой', () => {
    expect(playGap(60 * MIN, 1)).toBe(60 * MIN);
    expect(playGap(60 * MIN, 1.35)).toBeLessThan(60 * MIN);
    expect(playGap(60 * MIN, 0.9)).toBeGreaterThan(60 * MIN);
    expect(playGap(60 * MIN, 99)).toBeCloseTo((60 * MIN) / SOFT_MAX);
  });

  it('обидчивость: ноль остаётся нулём, шанс не выше CHANCE_MAX, срок не короче пола', () => {
    expect(grudgeChance(0, 1.4)).toBe(0);
    expect(grudgeChance(0.5, 1)).toBe(0.5);
    expect(grudgeChance(0.8, 1.4)).toBe(CHANCE_MAX);
    expect(grudgeChance(0.4, 0.8)).toBeCloseTo(0.32);
    expect(grudgeMs(GRUDGE_MS, 1, GRUDGE_FLOOR)).toBe(GRUDGE_MS);
    expect(grudgeMs(GRUDGE_MS, 0.7, GRUDGE_FLOOR)).toBe(GRUDGE_FLOOR);
    expect(grudgeMs(GRUDGE_MS, 1.25, GRUDGE_FLOOR)).toBe(GRUDGE_MS * 1.25);
    // пол выше 20 минут сна за краем: вернувшись, отомстит даже незлопамятная
    expect(GRUDGE_FLOOR).toBeGreaterThan(NAP_MS);
  });

  it('месть: по умолчанию как было; обидчивая обижается там, где серая — нет', () => {
    const r = freshRevenge();
    const now = 10 * 60 * MIN;
    const at = (x: number) => () => x;
    // бросок 0.45 при шансе тычков 0.4: серая не обиделась, обидчивая (0.4 × 1.35 = 0.54) — да
    expect(provoke(r, 'pester', now, at(0.45), 'pranks')).toBe(r);
    expect(provoke(r, 'pester', now, at(0.45), 'pranks', 1)).toBe(r);
    const angry = provoke(r, 'pester', now, at(0.45), 'pranks', 1.35);
    expect(angry.grudge).toBe(now + GRUDGE_MS * 1.35);
    // незлопамятная: шанс ниже, срок не короче пола
    expect(provoke(r, 'pester', now, at(0.35), 'pranks', 0.8)).toBe(r);
    expect(provoke(r, 'angry', now, at(0.1), 'pranks', 0.8).grudge).toBe(now + GRUDGE_FLOOR);
    // выспавшуюся будить не обидно ни одной
    expect(CHANCE.wake).toBe(0);
    expect(provoke(r, 'wake', now, at(0), 'pranks', 1.4)).toBe(r);
    // в «Спокойном» мести нет при любом характере
    expect(provoke(r, 'leave', now, at(0), 'calm', 1.4)).toBe(r);
  });

  it('тычки доносят обидчивость до броска', () => {
    let r = freshRevenge();
    const now = 10 * 60 * MIN;
    for (let i = 0; i < PESTER_CLICKS; i++) r = poked(r, now + i, () => 0.45, 'pranks', 1.35);
    expect(r.grudge).toBeGreaterThan(now);
  });

  /** Сколько бодрствует и сколько спит, шагами по минуте; человек за компьютером. */
  function cycle(sleepy?: number): [number, number] {
    let s: Sleep = freshSleep();
    let awake = 0;
    let asleep = 0;
    for (let i = 0; i < 300; i++) {
      let ev: SleepEvent | null;
      [s, ev] = sleepy === undefined ? step(s, MIN, false) : step(s, MIN, false, 1, sleepy);
      if (s.asleep) asleep += MIN;
      else awake += MIN;
      if (ev === 'wake') break;
    }
    return [awake, asleep];
  }

  it('сонливость: по умолчанию прежние 40/20 минут; соня бодрствует меньше и спит дольше', () => {
    expect(cycle()).toEqual([AWAKE_MS, NAP_MS]);
    expect(cycle(1)).toEqual(cycle());
    const [aw, sl] = cycle(1.2);
    expect(aw).toBeLessThan(AWAKE_MS);
    expect(sl).toBeGreaterThan(NAP_MS);
    const [aw2, sl2] = cycle(0.85);
    expect(aw2).toBeGreaterThan(AWAKE_MS);
    expect(sl2).toBeLessThan(NAP_MS);
  });

  it('названия и характер — на обоих языках, одной строкой', () => {
    for (const lang of ['ru', 'en'] as const) {
      setLang(lang);
      const names = new Set<string>();
      for (const b of BREEDS) {
        const n = breedName(b);
        const line = temper(b);
        expect(n.length).toBeGreaterThan(0);
        expect(line.length).toBeGreaterThan(10);
        expect(line.length).toBeLessThan(70);
        expect(line).not.toMatch(/\n/);
        expect(lang === 'en' ? /[а-яё]/i.test(n + line) : /[a-z]/i.test(n + line)).toBe(false);
        names.add(n);
      }
      expect(names.size).toBe(BREEDS.length);
    }
  });
});
