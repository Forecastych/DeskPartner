import { describe, expect, it } from 'vitest';
import { MAX_STEP_MS } from './hunger';
import {
  ANGRY_MS,
  AWAKE_MS,
  fresh,
  GROGGY_MS,
  load,
  mood,
  NAP_MS,
  poke,
  RESTED_MS,
  save,
  type Sleep,
  type SleepEvent,
  step,
} from './sleep';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Прожить `ms` кадрами по MAX_STEP_MS (последний — остаток) и собрать события по порядку. */
function run(s: Sleep, ms: number, humanIdle = false): [Sleep, SleepEvent[]] {
  const events: SleepEvent[] = [];
  for (let left = ms; left > 0; left -= MAX_STEP_MS) {
    const [next, e] = step(s, Math.min(MAX_STEP_MS, left), humanIdle);
    s = next;
    if (e) events.push(e);
  }
  return [s, events];
}

/** Спит дома уже `slept` мс. */
const sleeping = (slept = 0): Sleep => ({ ...fresh(), asleep: true, slept });

describe('fresh и mood', () => {
  it('новая кошка бодрая, никем не разбужена', () => {
    expect(fresh()).toEqual({ awake: 0, asleep: false, slept: 0, wakes: 0, cranky: 0, away: 0 });
    expect(mood(fresh())).toBe('awake');
  });

  it('настроение по состоянию: ушла важнее разбуженной, разбуженная важнее сна', () => {
    expect(mood(sleeping())).toBe('asleep');
    expect(mood({ ...fresh(), wakes: 1, cranky: GROGGY_MS })).toBe('groggy');
    expect(mood({ ...fresh(), wakes: 2, cranky: ANGRY_MS })).toBe('angry');
    expect(mood({ ...sleeping(), wakes: 3, away: NAP_MS })).toBe('away');
  });
});

describe('step: время', () => {
  it('отрицательная разница (часы назад) ничего не засчитывает', () => {
    const [s, e] = step(fresh(), -5 * DAY, false);
    expect(s.awake).toBe(0);
    expect(e).toBeNull();
  });

  it('огромный прыжок (часы вперёд, сон ПК) засчитывается максимум как MAX_STEP_MS', () => {
    expect(step(fresh(), 30 * DAY, false)[0].awake).toBe(MAX_STEP_MS);
    expect(step(sleeping(), 30 * DAY, true)[0].slept).toBe(MAX_STEP_MS);
  });

  it('NaN вместо разницы ничего не портит', () => {
    const [s, e] = step(sleeping(MIN), Number.NaN, false);
    expect(s.slept).toBe(MIN);
    expect(e).toBeNull();
  });

  it('не меняет входной объект', () => {
    const states: Sleep[] = [
      { ...fresh(), awake: AWAKE_MS - 1 },
      sleeping(NAP_MS - 1),
      { ...fresh(), wakes: 1, cranky: 1 },
      { ...fresh(), wakes: 3, away: 1 },
    ];
    for (const s of states) {
      const copy = { ...s };
      step(s, MAX_STEP_MS, false);
      step(s, MAX_STEP_MS, true);
      poke(s);
      expect(s).toEqual(copy);
    }
  });
});

describe('засыпание', () => {
  it('засыпает от усталости ровно через AWAKE_MS работы', () => {
    const [almost, events] = run(fresh(), AWAKE_MS - 1);
    expect(events).toEqual([]);
    expect(almost.asleep).toBe(false);
    const [s, e] = step(almost, 1, false);
    expect(e).toBe('sleep');
    expect(s.asleep).toBe(true);
    expect(s.slept).toBe(0);
  });

  it('человек отошёл — засыпает сразу, скучно', () => {
    const [s, e] = step(fresh(), 1, true);
    expect(e).toBe('sleep');
    expect(mood(s)).toBe('asleep');
  });
});

describe('пробуждение само', () => {
  it('просыпается через NAP_MS выспавшейся', () => {
    const [almost, events] = run(sleeping(), NAP_MS - 1);
    expect(events).toEqual([]);
    const [s, e] = step(almost, 1, false);
    expect(e).toBe('wake');
    expect(s).toEqual(fresh());
  });

  it('пока человек отошёл, спит дальше, а вернулся — просыпается', () => {
    const [still, events] = run(sleeping(), 3 * NAP_MS, true);
    expect(events).toEqual([]);
    expect(still.asleep).toBe(true);
    expect(still.slept).toBe(3 * NAP_MS);
    expect(step(still, 1, false)[1]).toBe('wake');
  });

  it('полный сон сбрасывает счётчик побудок', () => {
    const [groggy] = poke(sleeping(MIN));
    const [dozed, events] = run(groggy, GROGGY_MS);
    expect(events).toEqual(['doze']);
    expect(dozed.wakes).toBe(1);
    const [s, rest] = run(dozed, NAP_MS - MIN);
    expect(rest).toEqual(['wake']);
    expect(s.wakes).toBe(0);
    expect(s.awake).toBe(0);
  });
});

describe('побудка', () => {
  it('бодрую и ушедшую побудка не касается — тот же объект', () => {
    const awake = { ...fresh(), awake: AWAKE_MS - 1 };
    const away = { ...fresh(), wakes: 3, away: NAP_MS };
    expect(poke(fresh())).toEqual([fresh(), null]);
    expect(poke(awake)[0]).toBe(awake);
    expect(poke(awake)[1]).toBeNull();
    expect(poke(away)[0]).toBe(away);
    expect(poke(away)[1]).toBeNull();
  });

  it('граница RESTED_MS: до — не доспала, с неё — просыпается спокойно', () => {
    const [early, e1] = poke(sleeping(RESTED_MS - 1));
    expect(e1).toBe('groggy');
    expect(early.wakes).toBe(1);
    const [ok, e2] = poke(sleeping(RESTED_MS));
    expect(e2).toBe('wake');
    expect(ok).toEqual(fresh());
  });

  it('выспавшаяся забывает обиды даже после двух побудок', () => {
    const [s, e] = poke({ ...sleeping(RESTED_MS), wakes: 2 });
    expect(e).toBe('wake');
    expect(s.wakes).toBe(0);
  });

  it('сон между побудками копится: вялая уснула, доспала до RESTED_MS — будить можно', () => {
    const [groggy] = poke(sleeping(RESTED_MS - 1));
    const [dozed] = run(groggy, GROGGY_MS);
    expect(dozed.slept).toBe(RESTED_MS - 1);
    const [s, e] = poke(step(dozed, 1, false)[0]);
    expect(e).toBe('wake');
    expect(s.wakes).toBe(0);
  });

  it('полная лестница: вялая → уснула → злая → уснула → ушла → вернулась', () => {
    let s = sleeping(MIN);
    let r: string | null;
    let events: SleepEvent[];

    [s, r] = poke(s);
    expect(r).toBe('groggy');
    expect(s).toMatchObject({ asleep: false, wakes: 1, cranky: GROGGY_MS, slept: MIN });
    expect(mood(s)).toBe('groggy');

    [s, events] = run(s, GROGGY_MS);
    expect(events).toEqual(['doze']);
    expect(s).toMatchObject({ asleep: true, cranky: 0, wakes: 1, slept: MIN, awake: GROGGY_MS });

    [s, r] = poke(s);
    expect(r).toBe('angry');
    expect(s).toMatchObject({ asleep: false, wakes: 2, cranky: ANGRY_MS });
    expect(mood(s)).toBe('angry');

    [s, events] = run(s, ANGRY_MS);
    expect(events).toEqual(['doze']);
    expect(mood(s)).toBe('asleep');

    [s, r] = poke(s);
    expect(r).toBe('leave');
    expect(s).toMatchObject({ asleep: false, wakes: 3, cranky: 0, away: NAP_MS, slept: 0 });
    expect(mood(s)).toBe('away');

    // Вытащить нельзя.
    expect(poke(s)[1]).toBeNull();

    [s, events] = run(s, NAP_MS - 1, true);
    expect(events).toEqual([]);
    expect(s.away).toBe(1);

    [s, r] = step(s, 1, false);
    expect(r).toBe('return');
    expect(s).toEqual(fresh());
  });

  it('тычок в вялую сразу злит, тычок в злую — уходит', () => {
    const [groggy] = poke(sleeping());
    const [angry, e1] = poke(groggy);
    expect(e1).toBe('angry');
    expect(angry.cranky).toBe(ANGRY_MS);
    const [gone, e2] = poke(angry);
    expect(e2).toBe('leave');
    expect(gone.away).toBe(NAP_MS);
  });

  it('разбуженная засыпает на ходу, даже если человек отошёл', () => {
    const [groggy] = poke(sleeping());
    const [, events] = run(groggy, GROGGY_MS, true);
    expect(events).toEqual(['doze']);
  });
});

describe('load / save', () => {
  it('null, мусор и не-объекты — заново', () => {
    for (const raw of [null, '', '{', 'not json', 'null', '5', '"x"', '[]', '{}'])
      expect(load(raw)).toEqual(fresh());
  });

  it('отрицательные, NaN, бесконечные и не того типа поля — заново', () => {
    for (const raw of [
      save({ ...fresh(), awake: -1 }),
      save({ ...fresh(), slept: -5 }),
      save({ ...fresh(), away: -1 }),
      save({ ...fresh(), wakes: -1 }),
      '{"awake":NaN,"asleep":false,"slept":0,"wakes":0,"cranky":0,"away":0}',
      '{"awake":0,"asleep":false,"slept":1e999,"wakes":0,"cranky":0,"away":0}',
      '{"awake":"0","asleep":false,"slept":0,"wakes":0,"cranky":0,"away":0}',
      '{"awake":0,"asleep":"no","slept":0,"wakes":0,"cranky":0,"away":0}',
      '{"awake":0,"asleep":false,"slept":0,"wakes":0,"cranky":0}',
      '{"awake":null,"asleep":false,"slept":0,"wakes":0,"cranky":0,"away":0}',
    ])
      expect(load(raw)).toEqual(fresh());
  });

  it('разбуженная без ступени лестницы или спящая — битое', () => {
    for (const s of [
      { ...fresh(), cranky: GROGGY_MS, wakes: 0 },
      { ...fresh(), cranky: GROGGY_MS, wakes: 3 },
      { ...fresh(), cranky: GROGGY_MS, wakes: 1, asleep: true },
    ])
      expect(load(save(s))).toEqual(fresh());
  });

  it('лишние поля отбрасываются, побудки округляются вниз и обрезаются до 3', () => {
    const raw = '{"x":1,"awake":5,"asleep":true,"slept":6,"wakes":1.7,"cranky":0,"away":0}';
    expect(load(raw)).toEqual({ awake: 5, asleep: true, slept: 6, wakes: 1, cranky: 0, away: 0 });
    expect(load(save({ ...fresh(), wakes: 100, away: NAP_MS })).wakes).toBe(3);
  });

  it('save → load возвращает то же', () => {
    const states: Sleep[] = [
      { awake: 12_345, asleep: true, slept: 7_000, wakes: 1, cranky: 0, away: 0 },
      { awake: 100, asleep: false, slept: MIN, wakes: 2, cranky: 4_000, away: 0 },
      { awake: 0, asleep: false, slept: 0, wakes: 3, cranky: 0, away: NAP_MS / 2 },
    ];
    for (const s of states) expect(load(save(s))).toEqual(s);
  });
});
