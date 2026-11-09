import { afterEach, describe, expect, it } from 'vitest';
import { focusFrame, glass, GLASS_X, SHIFT } from './hourglass';
import { setLang } from './i18n';
import { fill, pickId, picked } from './menu';
import {
  awaiting,
  breakMs,
  doze,
  FOCUS_MIN,
  FOCUS_MIN_HI,
  FOCUS_MIN_LO,
  focusing,
  focusMinutes,
  focusText,
  leftLine,
  lull,
  menuEntry,
  minutesLeft,
  OFFER_WAIT_MS,
  offerAct,
  offerDue,
  offered,
  offerLine,
  progress,
  start,
  step,
  STRETCH_MS,
} from './pomodoro';
import { fresh, mood, poke, RESTED_MS, stir, type Sleep } from './sleep';
import { ANIMS, ground, hitMask, PALETTE, SIZE } from './sprite';

const MIN = 60_000;
/** Фокус по умолчанию — классические 25 минут, перерыв к нему — 5. */
const FOCUS_MS = FOCUS_MIN * MIN;
const BREAK_MS = 5 * MIN;

describe('помодоро: длина', () => {
  it('по умолчанию 25 минут, ползунок — от минуты до трёх часов', () => {
    expect(FOCUS_MIN).toBe(25);
    expect([FOCUS_MIN_LO, FOCUS_MIN_HI]).toEqual([1, 180]);
    expect(start(0).until).toBe(25 * MIN);
    expect(start(0, 40).until).toBe(40 * MIN);
    expect(start(0, 40).minutes).toBe(40);
  });

  it('длина из настроек и событий поправляется в пределы и до целых', () => {
    expect(focusMinutes(40)).toBe(40);
    expect(focusMinutes(0)).toBe(1);
    expect(focusMinutes(-5)).toBe(1);
    expect(focusMinutes(500)).toBe(180);
    expect(focusMinutes(12.6)).toBe(13);
    expect(focusMinutes('45')).toBe(45);
    for (const bad of [undefined, null, NaN, Infinity, '', 'много', {}, []]) expect(focusMinutes(bad)).toBe(25);
    expect(start(0, 999).until).toBe(180 * MIN);
    expect(start(0, 0).until).toBe(MIN);
  });

  it('перерыв — пятая часть фокуса, от минуты до получаса', () => {
    expect(breakMs(25)).toBe(5 * MIN);
    expect(breakMs(50)).toBe(10 * MIN);
    expect(breakMs(40)).toBe(8 * MIN);
    expect(breakMs(1)).toBe(MIN);
    expect(breakMs(3)).toBe(MIN);
    expect(breakMs(8)).toBe(2 * MIN);
    expect(breakMs(150)).toBe(30 * MIN);
    expect(breakMs(180)).toBe(30 * MIN);
    // не убывает с длиной фокуса
    for (let m = FOCUS_MIN_LO; m < FOCUS_MIN_HI; m++) expect(breakMs(m + 1)).toBeGreaterThanOrEqual(breakMs(m));
  });

  it('длина доезжает до перерыва через потягушки', () => {
    let p = start(0, 90);
    [p] = step(p, 90 * MIN) as [NonNullable<typeof p>, unknown];
    expect(p.minutes).toBe(90);
    [p] = step(p, p.until) as [NonNullable<typeof p>, unknown];
    expect(p.phase).toBe('break');
    const shown = offered(p, 1e7);
    expect(shown.until).toBe(1e7 + 18 * MIN);
    // минута фокуса — минута перерыва
    let q = start(0, 1);
    [q] = step(q, MIN) as [NonNullable<typeof q>, unknown];
    [q] = step(q, q.until) as [NonNullable<typeof q>, unknown];
    expect(offered(q, 0).until).toBe(MIN);
  });

  it('песок пересыпается по доле любой длины: половина часа и половина трёх часов — полчасов', () => {
    for (const m of [1, 25, 180]) {
      const p = start(0, m);
      expect(progress(p, (m * MIN) / 2)).toBeCloseTo(0.5);
      expect(glass(progress(p, (m * MIN) / 2))).toEqual(glass(0.5));
      expect(glass(progress(p, m * MIN))).toEqual(glass(1));
    }
    expect(minutesLeft(start(0, 180), 0)).toBe(180);
  });
});

describe('помодоро: фазы', () => {
  it('фокус → потягушки → перерыв → ничего, и сами по кругу не идут', () => {
    let p = start(1000);
    expect(focusing(p)).toBe(true);
    expect(step(p, 1000 + FOCUS_MS - 1)).toEqual([p, null]);

    let e;
    [p, e] = step(p, 1000 + FOCUS_MS) as [NonNullable<typeof p>, unknown];
    expect(e).toBe('done');
    expect(p.phase).toBe('stretch');
    expect(focusing(p)).toBe(false);

    const t0 = p.until;
    [p, e] = step(p, t0) as [NonNullable<typeof p>, unknown];
    expect(e).toBe('stretched');
    expect(p.phase).toBe('break');
    expect(p.until).toBe(t0 + OFFER_WAIT_MS);

    const [gone, over] = step(p, p.until);
    expect(over).toBe('over');
    expect(gone).toBeNull();
    // нет фокуса — шагать нечего
    expect(step(null, 1e12)).toEqual([null, null]);
  });

  it('от конца фокуса до облачка кошка не засыпает, дальше — как обычно', () => {
    let p = start(0, 1);
    expect(awaiting(p)).toBe(false);
    [p] = step(p, p.until) as [NonNullable<typeof p>, unknown];
    expect(awaiting(p)).toBe(true); // потягушки
    [p] = step(p, p.until) as [NonNullable<typeof p>, unknown];
    expect(awaiting(p)).toBe(true); // перерыв, облачка ещё не было
    p = offered(p, p.since);
    expect(awaiting(p)).toBe(false); // позвала — сонная может и уснуть
    expect(awaiting(null)).toBe(false);
  });

  it('потягивается STRETCH_MS — по времени кадров позы stretch, целым числом проходов', () => {
    const a = ANIMS[0].stretch;
    expect(STRETCH_MS % (a.frames.length * a.ms)).toBe(0);
  });

  it('облачко «Перерыв!» ждёт, пока можно, а перерыв считается с его показа', () => {
    const [b] = step(step(start(0), FOCUS_MS)[0], FOCUS_MS + STRETCH_MS);
    expect(offerDue(b)).toBe(true);
    // созвон на 20 минут: облачко всё ещё ждёт
    const late = FOCUS_MS + STRETCH_MS + 20 * MIN;
    expect(step(b, late)[1]).toBeNull();
    const shown = offered(b!, late);
    expect(offerDue(shown)).toBe(false);
    expect(shown.until).toBe(late + BREAK_MS);
    expect(step(shown, late + BREAK_MS)).toEqual([null, 'over']);
    // в фокусе и в потягушках облачко не положено
    expect(offerDue(start(0))).toBe(false);
    expect(offerDue(null)).toBe(false);
  });

  it('прогресс песка — от 0 до 1 только в фокусе', () => {
    const p = start(1000);
    expect(progress(p, 1000)).toBe(0);
    expect(progress(p, 1000 + FOCUS_MS / 2)).toBeCloseTo(0.5);
    expect(progress(p, 1000 + FOCUS_MS * 2)).toBe(1);
    expect(progress(p, 0)).toBe(0);
    expect(progress(null, 1000)).toBe(0);
  });

  it('минут осталось — вверх и не меньше одной', () => {
    const p = start(0);
    expect(minutesLeft(p, 0)).toBe(25);
    expect(minutesLeft(p, 30_000)).toBe(25);
    expect(minutesLeft(p, FOCUS_MS - 1)).toBe(1);
    expect(minutesLeft(p, FOCUS_MS + 5 * MIN)).toBe(1);
  });
});

describe('помодоро: сон на таймере', () => {
  const awake: Sleep = fresh();

  it('бодрая засыпает сразу, спящая спит дальше, ушедшую за край не трогаем', () => {
    const s = lull({ ...awake, awake: 10 * MIN });
    expect(mood(s)).toBe('asleep');
    expect(s.slept).toBe(0);
    expect(s.awake).toBe(10 * MIN);
    const sleeping = { ...s, slept: 5 * MIN };
    expect(lull(sleeping)).toBe(sleeping);
    const away = { ...awake, away: 10 * MIN };
    expect(lull(away)).toBe(away);
  });

  it('вялая спросонья засыпает без новых обид: побудки и начатый сон сохраняются', () => {
    const [groggy] = poke({ ...awake, asleep: true, slept: 3 * MIN });
    expect(mood(groggy)).toBe('groggy');
    const s = lull(groggy);
    expect(mood(s)).toBe('asleep');
    expect(s.wakes).toBe(groggy.wakes);
    expect(s.slept).toBe(3 * MIN);
  });

  it('сон копится, но сам не будит: 25 минут — дольше обычного сна, а проснуться можно без обид', () => {
    let s = lull(awake);
    for (let ms = 0; ms < FOCUS_MS; ms += 1000) s = doze(s, 1000);
    expect(mood(s)).toBe('asleep');
    expect(s.slept).toBe(FOCUS_MS);
    // конец фокуса будит как фильм: выспалась — бодрая, обиды забыты
    const woke = stir(s);
    expect(mood(woke)).toBe('awake');
    expect(woke.awake).toBe(0);
  });

  it('отменили рано — проснулась, но усталость осталась', () => {
    let s = lull({ ...awake, awake: 30 * MIN });
    s = doze(s, RESTED_MS - 1);
    const woke = stir(s);
    expect(mood(woke)).toBe('awake');
    expect(woke.awake).toBe(30 * MIN);
  });

  it('doze не трогает бодрую и ушедшую, шаг обрезан', () => {
    expect(doze(awake, 1000)).toBe(awake);
    const away = { ...awake, away: MIN };
    expect(doze(away, 1000)).toBe(away);
    expect(doze(lull(awake), -5).slept).toBe(0);
    expect(doze(lull(awake), NaN).slept).toBe(0);
  });
});

describe('помодоро: слова', () => {
  afterEach(() => setLang('ru'));

  it('облачка и меню на обоих языках', () => {
    const p = start(0);
    expect(leftLine(p, 13 * MIN)).toBe('Тс-с, фокус. Ещё 12 мин');
    expect(offerLine(false)).toBe('Перерыв! Поиграем?');
    expect(offerLine(true)).toContain('Покормишь');
    expect(offerAct()).toBe('Лазер');
    const idle = menuEntry(null, 0);
    expect(idle).toMatchObject({ id: 'focus', slider: { min: 1, max: 180, value: 25, label: 'Таймер' } });
    expect(fill(idle.text, idle.slider!.value)).toBe('Фокус 25 минут');
    expect(menuEntry(p, 0)).toMatchObject({ id: 'focus-cancel', text: 'Отменить фокус', hint: 'ещё 25 мин' });
    // идущий фокус ползунка не показывает: длину уже выбрали
    expect(menuEntry(p, 0).slider).toBeUndefined();
    setLang('en');
    expect(leftLine(p, 13 * MIN)).toBe('Shh, focus. 12 min left');
    expect(offerLine(false)).toBe('Break time! Shall we play?');
    expect(offerAct()).toBe('Laser');
    expect(fill(menuEntry(null, 0).text, 25)).toBe('Focus for 25 minutes');
    expect(menuEntry(null, 0).slider?.label).toBe('Timer');
    expect(menuEntry(p, 0).text).toBe('Cancel focus');
  });

  it('пункт помнит прошлую длину, а текст — минуты с нужной формой слова', () => {
    const e = menuEntry(null, 0, 40);
    expect(e.slider?.value).toBe(40);
    expect(fill(e.text, 40)).toBe('Фокус 40 минут');
    expect(fill(focusText(), 1)).toBe('Фокус 1 минута');
    expect(fill(focusText(), 3)).toBe('Фокус 3 минуты');
    expect(fill(focusText(), 11)).toBe('Фокус 11 минут');
    expect(fill(focusText(), 121)).toBe('Фокус 121 минута');
    // кривое значение из настроек ползунок не ломает
    expect(menuEntry(null, 0, 1000).slider?.value).toBe(180);
    expect(menuEntry(null, 0, NaN).slider?.value).toBe(25);
    setLang('en');
    expect(fill(focusText(), 1)).toBe('Focus for 1 minute');
    expect(fill(focusText(), 40)).toBe('Focus for 40 minutes');
  });

  it('выбор с ползунка приходит как «focus:N» и разбирается обратно', () => {
    const e = menuEntry(null, 0, 40);
    expect(pickId(e, 55)).toBe('focus:55');
    expect(picked('focus:55')).toEqual(['focus', 55]);
    const cancel = menuEntry(start(0), 0);
    expect(pickId(cancel, 55)).toBe('focus-cancel');
    expect(picked('focus-cancel')).toEqual(['focus-cancel', null]);
  });

  it('в перерыве пункт снова «Фокус», с остатком перерыва; в потягушках — обычный', () => {
    const [s] = step(start(0), FOCUS_MS);
    expect(menuEntry(s, FOCUS_MS).id).toBe('focus');
    const [b] = step(s, s!.until);
    const shown = offered(b!, 0);
    expect(menuEntry(shown, 2 * MIN, 25)).toMatchObject({ id: 'focus', hint: 'перерыв: ещё 3 мин', slider: { value: 25 } });
  });
});

describe('песочные часы', () => {
  const sand = (g: string[]) => g.join('').split('S').length - 1;
  const top = (g: string[]) => g.slice(1, 4).join('').split('S').length - 1;
  const bottom = (g: string[]) => g.slice(5, 8).join('').split('S').length - 1;

  it('песок пересыпается сверху вниз и не теряется; струйка — только пока сыплется', () => {
    expect(top(glass(0))).toBe(7);
    expect(bottom(glass(0))).toBe(0);
    expect(top(glass(1))).toBe(0);
    expect(bottom(glass(1))).toBe(7);
    let was = 7;
    for (let p = 0; p <= 1; p += 0.05) {
      const g = glass(p);
      expect(top(g) + bottom(g)).toBe(7);
      expect(top(g)).toBeLessThanOrEqual(was);
      was = top(g);
    }
    expect(sand(glass(0))).toBe(7);
    expect(sand(glass(0.5))).toBe(8);
    expect(sand(glass(1))).toBe(7);
    // за пределами — как на краях
    expect(glass(-1)).toEqual(glass(0));
    expect(glass(2)).toEqual(glass(1));
  });

  it('часы симметричны: кошке мордой влево flip их не портит', () => {
    for (const p of [0, 1]) for (const row of glass(p)) expect([...row].reverse().join('')).toBe(row);
  });

  it('ключи часов — в палитре, а песок и стекло кликабельны', () => {
    for (const k of 'GxS') expect(PALETTE[k]).toBeTruthy();
    const f = focusFrame(ANIMS[0].sleep.frames, 0, 0.5, false);
    const mask = hitMask(f);
    expect(mask[27] & (1 << (GLASS_X + 2))).not.toBe(0);
  });

  it('калачик сдвинут влево целиком, часы стоят там же, где живот, — на ряду 27', () => {
    for (const fat of [0, 1, 2] as const) {
      const sleep = ANIMS[fat].sleep.frames;
      const f = focusFrame(sleep, 0, 0.3, false);
      expect(f).toHaveLength(SIZE);
      for (const row of f) expect(row).toHaveLength(SIZE);
      // слева ничего не срезано: в исходном кадре первые SHIFT столбцов пусты
      for (const row of sleep[0]) expect(row.slice(0, SHIFT)).toBe('.'.repeat(SHIFT));
      expect(f[ground('sleep')].slice(GLASS_X, GLASS_X + 5)).toBe('GGGGG');
      expect(f[ground('sleep') + 1].slice(GLASS_X)).toMatch(/^\.+$/);
      // кошка и часы не наезжают друг на друга: столбец перед часами пуст в их рядах
      for (let y = ground('sleep') - 8; y <= ground('sleep'); y++) expect(f[y][GLASS_X - 1]).toBe('.');
    }
  });

  it('хвост во сне на таймере не качается: дышит, а хвост один и тот же', () => {
    const sleep = ANIMS[1].sleep.frames;
    const a = focusFrame(sleep, 0, 0.3, false);
    const b = focusFrame(sleep, 1, 0.3, false);
    expect(a.slice(28)).toEqual(b.slice(28));
    expect(a).not.toEqual(b);
  });

  it('в лежаке часы встают на подушку целиком, за бортиком ничего не прячется', () => {
    const f = focusFrame(ANIMS[0].sleep.frames, 0, 1, true);
    const g = glass(1);
    g.forEach((row, dy) => expect(f[27 - g.length + dy].slice(GLASS_X, GLASS_X + 5)).toBe(row));
    expect(f[SIZE - 1]).toContain('R');
  });
});
