import { describe, expect, it } from 'vitest';
import {
  CARE_SECS,
  duration,
  fresh,
  GAP_MS,
  HUNGRY_EVERY_MS,
  interval,
  isWork,
  liked,
  load,
  type Moment,
  PRAISE_SECS,
  RANGES,
  retime,
  save,
  say,
  shoo,
  shownFor,
  type Talk,
} from './chatter';

const MIN = 60_000;
/** Суббота, 7 ноября 2026, 14:00 — отдых, ни утро, ни ночь, ни пятница. */
const SAT = new Date(2026, 10, 7, 14, 0);
/** Вторник, 3 ноября 2026, 11:00 — рабочее время. */
const TUE = new Date(2026, 10, 3, 11, 0);
const mid = () => 0.5;

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

function moment(now: Date, over: Partial<Moment> = {}): Moment {
  return { now, pause: true, session: 10 * 60, today: 30 * 60, hungry: false, free: true, ...over };
}

/** Состояние, в котором случайная реплика уже подошла. */
function due(now: Date): Talk {
  return { ...fresh(now.getTime(), 'sometimes', mid), next: now.getTime() };
}

describe('interval', () => {
  it('stays within the level range', () => {
    const [lo, hi] = RANGES.sometimes!;
    expect(interval('sometimes', 0, () => 0)).toBe(lo);
    expect(interval('sometimes', 0, () => 0.999999)).toBeCloseTo(hi, -2);
    expect(interval('often', 0, () => 0)).toBeLessThan(lo);
  });

  it('never comes for the quiet one', () => {
    expect(interval('quiet', 0, mid)).toBe(Infinity);
  });

  it('stretches with each shoo, at most three times', () => {
    const base = interval('sometimes', 0, mid);
    expect(interval('sometimes', 2, mid)).toBe(base * 2);
    expect(interval('sometimes', 10, mid)).toBe(base * 3);
  });
});

describe('say', () => {
  it('waits for the random moment', () => {
    const t = fresh(SAT.getTime(), 'sometimes', mid);
    expect(say(t, moment(at(SAT, 5 * MIN)), 'sometimes', mid)[1]).toBeNull();
    const [, line] = say(t, moment(at(SAT, 25 * MIN)), 'sometimes', mid);
    expect(line?.key).toBe('rest');
  });

  it('does not interrupt: away, typing, fullscreen or a busy cat', () => {
    const t = due(SAT);
    expect(say(t, moment(SAT, { pause: false }), 'sometimes', mid)[1]).toBeNull();
    expect(say(t, moment(SAT, { free: false }), 'sometimes', mid)[1]).toBeNull();
    // срок не сгорает: дождалась паузы — говорит
    expect(say(t, moment(at(SAT, 10 * MIN)), 'sometimes', mid)[1]).not.toBeNull();
  });

  it('keeps work and rest apart', () => {
    const work = ['Ты молодец.', 'Я тут, рядом.', 'Хорошо работаем.', 'Мур. Не отвлекаю.'];
    for (let i = 0; i < 20; i++) {
      const r = () => i / 20;
      const [, line] = say(due(TUE), moment(TUE, { today: 0 }), 'sometimes', r);
      expect(line?.key).toBe('work');
      expect(work).toContain(line?.text);
      const [, rest] = say(due(SAT), moment(SAT, { today: 0 }), 'sometimes', r);
      expect(work).not.toContain(rest?.text);
    }
  });

  it('does not repeat the last line', () => {
    let t = due(SAT);
    let prev = '';
    for (let i = 0; i < 10; i++) {
      const now = at(SAT, i * 40 * MIN);
      t = { ...t, next: now.getTime() };
      const [next, line] = say(t, moment(now, { today: 0 }), 'sometimes', () => 0);
      expect(line?.text).not.toBe(prev);
      prev = line!.text;
      t = next;
    }
  });

  it('the quiet one speaks only about hunger', () => {
    const t = { ...fresh(SAT.getTime(), 'quiet', mid), next: 0 };
    expect(say(t, moment(at(SAT, 5 * 3600_000), { session: CARE_SECS * 2 }), 'quiet', mid)[1]).toBeNull();
    expect(say(t, moment(SAT, { hungry: true }), 'quiet', mid)[1]?.key).toBe('hungry');
  });

  it('reminds about hunger once in a while, a new hunger right away', () => {
    let [t, line] = say(fresh(SAT.getTime(), 'sometimes', mid), moment(SAT, { hungry: true }), 'sometimes', mid);
    expect(line?.key).toBe('hungry');
    [t, line] = say(t, moment(at(SAT, GAP_MS), { hungry: true }), 'sometimes', mid);
    expect(line).toBeNull();
    [, line] = say(t, moment(at(SAT, HUNGRY_EVERY_MS), { hungry: true }), 'sometimes', mid);
    expect(line?.key).toBe('hungry');
    // поела и снова проголодалась — скажет, не дожидаясь HUNGRY_EVERY_MS
    [t] = say(t, moment(at(SAT, GAP_MS)), 'sometimes', mid);
    [, line] = say(t, moment(at(SAT, 2 * GAP_MS), { hungry: true }), 'sometimes', mid);
    expect(line?.key).toBe('hungry');
  });

  it('cares after 90 minutes once per session, praises at work after two hours', () => {
    let t = fresh(TUE.getTime(), 'sometimes', mid);
    let line;
    [t, line] = say(t, moment(TUE, { session: CARE_SECS }), 'sometimes', mid);
    expect(line).toEqual({ key: 'care', text: 'Уже 1 ч 30 мин без перерыва. Потянемся?' });
    [t, line] = say(t, moment(at(TUE, GAP_MS), { session: CARE_SECS + 180 }), 'sometimes', mid);
    expect(line).toBeNull();
    [t, line] = say(t, moment(at(TUE, 30 * MIN), { session: PRAISE_SECS }), 'sometimes', mid);
    expect(line).toEqual({ key: 'praise', text: '2 ч в фокусе. Ты молодец.' });
    // отошёл, сессия началась заново — через 90 минут забота снова
    [t] = say(t, moment(at(TUE, 40 * MIN), { session: 0 }), 'sometimes', mid);
    [, line] = say(t, moment(at(TUE, 130 * MIN), { session: CARE_SECS }), 'sometimes', mid);
    expect(line?.key).toBe('care');
  });

  it('does not praise on a weekend', () => {
    const t = { ...fresh(SAT.getTime(), 'sometimes', mid), inSession: ['care'] };
    expect(say(t, moment(SAT, { session: PRAISE_SECS }), 'sometimes', mid)[1]).toBeNull();
  });

  it('greets in the morning once a day', () => {
    const morning = new Date(2026, 10, 7, 8, 30);
    let [t, line] = say(due(morning), moment(morning), 'sometimes', mid);
    expect(line?.key).toBe('morning');
    t = { ...t, next: 0 };
    [, line] = say(t, moment(at(morning, 60 * MIN)), 'sometimes', mid);
    expect(line?.key).not.toBe('morning');
    // назавтра — снова
    [, line] = say(t, moment(at(morning, 24 * 60 * MIN)), 'sometimes', mid);
    expect(line?.key).toBe('morning');
  });

  it('fills the time at night and the friday party', () => {
    const night = new Date(2026, 10, 7, 1, 5);
    expect(say(due(night), moment(night), 'sometimes', mid)[1]).toEqual({ key: 'night', text: 'Уже 1:05. Может, спать?' });
    const friday = new Date(2026, 10, 6, 19, 0);
    expect(say(due(friday), moment(friday), 'sometimes', mid)[1]?.key).toBe('friday');
  });

  it('tells today stats sometimes', () => {
    const [, line] = say(due(SAT), moment(SAT, { today: 3 * 3600 + 15 * 60 }), 'sometimes', () => 0);
    expect(line).toEqual({ key: 'today', text: 'Сегодня мы за компом уже 3 ч 15 мин.' });
  });

  it('keeps a gap after any bubble', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    expect(say({ ...t, next: 0 }, moment(at(SAT, GAP_MS - 1), { session: CARE_SECS }), 'sometimes', mid)[1]).toBeNull();
  });
});

describe('shoo and like', () => {
  it('a shoo pushes the next line further', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    const s = shoo(t, 'sometimes', mid);
    expect(s.shooed).toBe(1);
    expect(s.next).toBeGreaterThan(t.next);
  });

  it('petting soon after a bubble forgives the shoos', () => {
    const [t] = say(due(SAT), moment(SAT), 'sometimes', mid);
    const s = { ...t, shooed: 3 };
    expect(liked(s, SAT.getTime() + 30_000).shooed).toBe(0);
    expect(liked(s, SAT.getTime() + 5 * MIN).shooed).toBe(3);
  });

  it('retime moves the quiet one back into talking', () => {
    const t = fresh(SAT.getTime(), 'quiet', mid);
    expect(t.next).toBe(Infinity);
    expect(retime(t, 'sometimes', SAT.getTime(), mid).next).toBe(SAT.getTime() + interval('sometimes', 0, mid));
  });
});

describe('helpers', () => {
  it('guesses work hours', () => {
    expect(isWork(TUE)).toBe(true);
    expect(isWork(SAT)).toBe(false);
    expect(isWork(new Date(2026, 10, 3, 19, 0))).toBe(false);
  });

  it('formats durations', () => {
    expect(duration(40 * 60)).toBe('40 мин');
    expect(duration(3 * 3600)).toBe('3 ч');
    expect(duration(2 * 3600 + 5 * 60 + 59)).toBe('2 ч 5 мин');
  });

  it('shows a bubble long enough to read, not forever', () => {
    expect(shownFor('Мур.')).toBe(4000);
    expect(shownFor('x'.repeat(500))).toBe(9000);
  });
});

describe('save and load', () => {
  it('keeps shoos and what was said today', () => {
    const t: Talk = { ...fresh(0, 'sometimes', mid), shooed: 2, last: 'Мур.', daily: { morning: '2026-11-07' } };
    const back = load(save(t), SAT.getTime(), 'sometimes', mid);
    expect(back.shooed).toBe(2);
    expect(back.last).toBe('Мур.');
    expect(back.daily).toEqual({ morning: '2026-11-07' });
    expect(back.next).toBe(SAT.getTime() + interval('sometimes', 2, mid));
  });

  it('survives garbage', () => {
    for (const raw of [null, '', '{', '{"shooed":-4,"daily":{"a":1}}', '[]']) {
      const t = load(raw, 0, 'sometimes', mid);
      expect(t.shooed).toBe(0);
      expect(t.daily).toEqual({});
    }
  });
});
