import { describe, expect, it } from 'vitest';
import {
  type Belly,
  type BellyEvent,
  FEEDER_MAX,
  feedBowl,
  FORAGE_AFTER_MS,
  FORAGE_MS,
  fresh,
  HUNGRY_AFTER_MS,
  isHungry,
  load,
  MAX_STEP_MS,
  refill,
  RUN_AWAY_MS,
  save,
  step,
  takeOut,
} from './hunger';

const DAY = 24 * 60 * 60_000;

/** Прожить `ms` кадрами по MAX_STEP_MS (последний — остаток) и собрать события по порядку. */
function run(b: Belly, ms: number, feederOn = false): [Belly, BellyEvent[]] {
  const events: BellyEvent[] = [];
  for (let left = ms; left > 0; left -= MAX_STEP_MS) {
    const [next, e] = step(b, Math.min(MAX_STEP_MS, left), feederOn);
    b = next;
    if (e) events.push(e);
  }
  return [b, events];
}

/** Только что покормленная человеком кошка. */
const fed = (): Belly => ({ ...fresh(), sinceMeal: 0, sinceHuman: 0 });

describe('fresh', () => {
  it('новая кошка сразу голодна и дома', () => {
    const b = fresh();
    expect(isHungry(b)).toBe(true);
    expect(b).toEqual({ sinceMeal: HUNGRY_AFTER_MS, sinceHuman: 0, feeder: 0, away: 0, gone: false });
  });
});

describe('step: время', () => {
  it('отрицательная разница (часы назад) не кормит', () => {
    const [b, e] = step(fed(), -5 * DAY, false);
    expect(b.sinceMeal).toBe(0);
    expect(b.sinceHuman).toBe(0);
    expect(e).toBeNull();
  });

  it('огромный прыжок (часы вперёд, сон ПК) засчитывается максимум как MAX_STEP_MS', () => {
    const [b, e] = step(fed(), 30 * DAY, false);
    expect(b.sinceMeal).toBe(MAX_STEP_MS);
    expect(b.sinceHuman).toBe(MAX_STEP_MS);
    expect(e).toBeNull();
  });

  it('NaN вместо разницы ничего не портит', () => {
    const [b] = step(fed(), Number.NaN, false);
    expect(b.sinceMeal).toBe(0);
  });

  it('голодает ровно через HUNGRY_AFTER_MS работы', () => {
    const [almost, events] = run(fed(), HUNGRY_AFTER_MS - 1);
    expect(isHungry(almost)).toBe(false);
    expect(events).toEqual([]);
    const [b] = step(almost, 1, false);
    expect(isHungry(b)).toBe(true);
  });

  it('не меняет входной объект', () => {
    const b = { ...fresh(), feeder: 2, sinceMeal: HUNGRY_AFTER_MS + FORAGE_AFTER_MS };
    const copy = { ...b };
    step(b, MAX_STEP_MS, true);
    step(b, MAX_STEP_MS, false);
    step({ ...b, away: 1 }, MAX_STEP_MS, false);
    expect(b).toEqual(copy);
  });
});

describe('миска', () => {
  it('голодную кормит: сбрасывает оба счётчика', () => {
    const b = feedBowl({ ...fresh(), sinceHuman: 3 * DAY });
    expect(b.sinceMeal).toBe(0);
    expect(b.sinceHuman).toBe(0);
    expect(isHungry(b)).toBe(false);
  });

  it('сытая не ест — тот же объект', () => {
    const b = { ...fed(), sinceMeal: HUNGRY_AFTER_MS - 1, sinceHuman: DAY };
    expect(feedBowl(b)).toBe(b);
  });

  it('ушедшую на охоту или насовсем не покормить', () => {
    const away = { ...fresh(), away: FORAGE_MS };
    const gone = { ...fresh(), gone: true };
    expect(feedBowl(away)).toBe(away);
    expect(feedBowl(gone)).toBe(gone);
  });
});

describe('кормушка', () => {
  it('голодная ест из кормушки, только если она включена и не пуста', () => {
    const stocked = { ...fresh(), feeder: 2 };
    expect(step(stocked, 1, false)[1]).toBeNull();
    expect(step({ ...fresh(), feeder: 0 }, 1, true)[1]).toBeNull();
    const [b, e] = step(stocked, 1, true);
    expect(e).toBe('eat');
    expect(b.feeder).toBe(1);
    expect(b.sinceMeal).toBe(0);
  });

  it('сытая из кормушки не ест', () => {
    const [b, e] = step({ ...fed(), feeder: 3 }, MAX_STEP_MS, true);
    expect(e).toBeNull();
    expect(b.feeder).toBe(3);
  });

  it('еда из кормушки не сбрасывает счётчик человека', () => {
    const [b] = step({ ...fresh(), feeder: 1, sinceHuman: DAY }, 1, true);
    expect(b.sinceHuman).toBe(DAY + 1);
  });

  it('пополнение: +1 до FEEDER_MAX и сброс счётчика человека', () => {
    let b: Belly = { ...fresh(), sinceHuman: DAY };
    b = refill(b);
    expect(b.feeder).toBe(1);
    expect(b.sinceHuman).toBe(0);
    for (let i = 0; i < 100; i++) b = refill(b);
    expect(b.feeder).toBe(FEEDER_MAX);
  });

  it('забрать порцию: -1, но не ниже нуля', () => {
    expect(takeOut({ ...fresh(), feeder: 2 }).feeder).toBe(1);
    expect(takeOut(fresh()).feeder).toBe(0);
  });

  it('у ушедшей насовсем кормушку не трогают', () => {
    const gone = { ...fresh(), gone: true, feeder: 2 };
    expect(refill(gone)).toBe(gone);
    expect(takeOut(gone)).toBe(gone);
  });
});

describe('охота', () => {
  it('уходит через HUNGRY_AFTER_MS + FORAGE_AFTER_MS без еды', () => {
    const [almost, events] = run(fed(), HUNGRY_AFTER_MS + FORAGE_AFTER_MS - MAX_STEP_MS);
    expect(events).toEqual([]);
    const [b, e] = step(almost, MAX_STEP_MS, false);
    expect(e).toBe('leave');
    expect(b.away).toBe(FORAGE_MS);
  });

  it('пока бродит, не ест из кормушки и не уходит повторно', () => {
    const [b, events] = run({ ...fresh(), away: FORAGE_MS, feeder: 3 }, FORAGE_MS - 1, true);
    expect(events).toEqual([]);
    expect(b.feeder).toBe(3);
    expect(b.away).toBe(1);
  });

  it('возвращается через FORAGE_MS сытой, но счётчик человека не сбрасывается', () => {
    const start = { ...fresh(), sinceMeal: HUNGRY_AFTER_MS + FORAGE_AFTER_MS, sinceHuman: DAY, away: FORAGE_MS };
    const [b, events] = run(start, FORAGE_MS);
    expect(events).toEqual(['return']);
    expect(b.away).toBe(0);
    expect(b.sinceMeal).toBe(0);
    expect(b.sinceHuman).toBe(DAY + FORAGE_MS);
  });
});

describe('побег', () => {
  it('человек не кормит: охота держит в живых, но через RUN_AWAY_MS она уходит насовсем', () => {
    const [almost, events] = run(fresh(), RUN_AWAY_MS - MAX_STEP_MS);
    expect(events).not.toContain('gone');
    expect(events.filter((e) => e === 'leave').length).toBeGreaterThan(10);
    expect(events.filter((e) => e === 'return').length).toBeGreaterThan(10);
    // Охота не даёт голодать дольше, чем до следующего ухода.
    expect(almost.sinceMeal).toBeLessThan(HUNGRY_AFTER_MS + FORAGE_AFTER_MS + FORAGE_MS);

    const [b, e] = step(almost, MAX_STEP_MS, false);
    expect(e).toBe('gone');
    expect(b.gone).toBe(true);
    expect(b.away).toBe(0);
  });

  it('уходит насовсем даже с охоты', () => {
    const [b, e] = step({ ...fresh(), sinceHuman: RUN_AWAY_MS - 1, away: FORAGE_MS }, 1, false);
    expect(e).toBe('gone');
    expect(b.away).toBe(0);
  });

  it('кормушка без пополнения не спасает: еда из неё не забота человека', () => {
    const [, events] = run({ ...fresh(), feeder: FEEDER_MAX }, RUN_AWAY_MS, true);
    expect(events.filter((e) => e === 'eat')).toHaveLength(FEEDER_MAX);
    expect(events.at(-1)).toBe('gone');
  });

  it('step по ушедшей насовсем ничего не делает', () => {
    const gone = { ...fresh(), gone: true, sinceHuman: RUN_AWAY_MS };
    const [b, e] = step(gone, MAX_STEP_MS, true);
    expect(b).toBe(gone);
    expect(e).toBeNull();
  });

  it('пополнение кормушки откладывает побег', () => {
    const [almost] = run(fresh(), RUN_AWAY_MS - MAX_STEP_MS);
    const [b, events] = run(refill(almost), DAY);
    expect(events).not.toContain('gone');
    expect(b.gone).toBe(false);
    expect(b.sinceHuman).toBe(DAY);
  });
});

describe('load / save', () => {
  it('null, мусор и не-объекты — заново', () => {
    for (const raw of [null, '', '{', 'not json', 'null', '5', '"x"', '[]', '{}'])
      expect(load(raw)).toEqual(fresh());
  });

  it('отрицательные, NaN, бесконечные и не того типа поля — заново', () => {
    for (const raw of [
      save({ ...fed(), sinceMeal: -1 }),
      save({ ...fed(), away: -5 }),
      save({ ...fed(), feeder: -1 }),
      '{"sinceMeal":NaN,"sinceHuman":0,"feeder":0,"away":0,"gone":false}',
      '{"sinceMeal":0,"sinceHuman":1e999,"feeder":0,"away":0,"gone":false}',
      '{"sinceMeal":"0","sinceHuman":0,"feeder":0,"away":0,"gone":false}',
      '{"sinceMeal":0,"sinceHuman":0,"feeder":0,"away":0,"gone":"no"}',
      '{"sinceMeal":0,"sinceHuman":0,"feeder":0,"away":0}',
      '{"sinceMeal":null,"sinceHuman":0,"feeder":0,"away":0,"gone":false}',
    ])
      expect(load(raw)).toEqual(fresh());
  });

  it('лишние поля отбрасываются, дробная кормушка округляется вниз', () => {
    const raw = '{"x":1,"sinceMeal":5,"sinceHuman":6,"feeder":2.7,"away":0,"gone":false}';
    expect(load(raw)).toEqual({ sinceMeal: 5, sinceHuman: 6, feeder: 2, away: 0, gone: false });
  });

  it('save → load возвращает то же', () => {
    const b: Belly = { sinceMeal: 12_345, sinceHuman: 2 * DAY, feeder: 4, away: 7_000, gone: false };
    expect(load(save(b))).toEqual(b);
    const gone: Belly = { ...b, away: 0, gone: true };
    expect(load(save(gone))).toEqual(gone);
  });

  it('кормушка сверх FEEDER_MAX обрезается', () => {
    expect(load(save({ ...fed(), feeder: 100 })).feeder).toBe(FEEDER_MAX);
  });
});
