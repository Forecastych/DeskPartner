import { afterEach, describe, expect, it } from 'vitest';
import { MEAN_MS, MIN_GAP, STAGES, TOTAL_MS, due, line, ms, pose, stage } from './fly';
import { setLang } from './i18n';
import { ANIMS } from './sprite';

describe('муха', () => {
  afterEach(() => setLang('ru'));

  it('стадии идут по порядку и кончаются', () => {
    const seen: string[] = [];
    for (let ms = 0; ms <= TOTAL_MS; ms += 100) {
      const s = stage(1000, 1000 + ms);
      if (seen.at(-1) !== s) seen.push(s);
    }
    expect(seen).toEqual([...STAGES.map(([s]) => s), 'done']);
    expect(stage(1000, 1000 + TOTAL_MS)).toBe('done');
    // облачко держится стадию целиком
    expect(ms('urgent')).toBe(3000);
    expect(ms('tell')).toBe(6000);
    expect(ms('done')).toBe(0);
  });

  it('редкая: в среднем раз в MEAN_MS, не чаще MIN_GAP', () => {
    // минута подходящего времени — почти никогда
    expect(due(0, 1e9, 60_000, () => 0.001)).toBe(false);
    expect(due(0, 1e9, 60_000, () => 0.0005)).toBe(true);
    // недавно уже ела — нет, даже при rnd = 0
    expect(due(1e9, 1e9 + MIN_GAP - 1, 60_000, () => 0)).toBe(false);
    expect(due(1e9, 1e9 + MIN_GAP, 60_000, () => 0)).toBe(true);
    // за MEAN_MS подходящего времени — с вероятностью 1 − 1/e
    expect(due(0, 1e9, MEAN_MS, () => 0.63)).toBe(true);
    expect(due(0, 1e9, MEAN_MS, () => 0.64)).toBe(false);
    // часы назад — не событие
    expect(due(0, 1e9, -5000, () => 0)).toBe(false);
  });

  it('«Срочно!», потом новость: с именем — в третьем лице', () => {
    expect(line('watch', 'Филя')).toBeNull();
    expect(line('urgent', 'Филя')).toBe('Срочно!');
    expect(line('tell', 'Филя')).toBe('Филя муху съела.');
    expect(line('tell', '  ')).toBe('Я муху съела.');
    setLang('en');
    expect(line('urgent', 'Fifi')).toBe('URGENT!');
    expect(line('tell', 'Fifi')).toBe('Fifi ate a fly.');
    expect(line('tell', '')).toBe('I ate a fly.');
  });

  it('у каждой стадии есть поза в спрайте', () => {
    for (const [s] of STAGES) expect(ANIMS[0][pose(s)].frames.length).toBeGreaterThan(0);
  });
});
