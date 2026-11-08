import { afterEach, describe, expect, it } from 'vitest';
import { focusFrame, glass, GLASS_X, SHIFT } from './hourglass';
import { setLang } from './i18n';
import {
  BREAK_MS,
  doze,
  FOCUS_MS,
  focusing,
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
    expect(menuEntry(null, 0)).toMatchObject({ id: 'focus', text: 'Фокус 25 минут' });
    expect(menuEntry(p, 0)).toMatchObject({ id: 'focus-cancel', text: 'Отменить фокус', hint: 'ещё 25 мин' });
    setLang('en');
    expect(leftLine(p, 13 * MIN)).toBe('Shh, focus. 12 min left');
    expect(offerLine(false)).toBe('Break time! Shall we play?');
    expect(offerAct()).toBe('Laser');
    expect(menuEntry(null, 0).text).toBe('Focus for 25 minutes');
    expect(menuEntry(p, 0).text).toBe('Cancel focus');
  });

  it('в перерыве пункт снова «Фокус», с остатком перерыва; в потягушках — обычный', () => {
    const [s] = step(start(0), FOCUS_MS);
    expect(menuEntry(s, FOCUS_MS).id).toBe('focus');
    const [b] = step(s, s!.until);
    const shown = offered(b!, 0);
    expect(menuEntry(shown, 2 * MIN)).toMatchObject({ id: 'focus', hint: 'перерыв: ещё 3 мин' });
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
