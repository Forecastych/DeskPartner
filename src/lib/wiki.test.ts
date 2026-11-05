import { describe, expect, it } from 'vitest';
import { TOPICS } from './settings';
import { line, MAX_TEXT, PER_TOPIC, SIGN, sort, topicsOf, type WikiEvent } from './wiki';

const ev = (about: string[], text = 'Что-то случилось.', year = 1961): WikiEvent => ({ year, text, about });

describe('wiki: «В этот день»', () => {
  it('тема — по описаниям статей, с любым окончанием', () => {
    expect(topicsOf(ev(['советский космонавт', 'космический корабль']))).toEqual(['космос']);
    expect(topicsOf(ev(['английский футбольный клуб']))).toEqual(['футбол']);
    expect(topicsOf(ev(['американский актёр, кинорежиссёр']))).toEqual(['кино']);
    expect(topicsOf(ev(['русский писатель', 'российский император']))).toEqual(['книги', 'история']);
    expect(topicsOf(ev(['японская манга']))).toEqual(['аниме']);
  });

  it('основа ищется с начала слова: «войн» в «конвойный» не тема', () => {
    expect(topicsOf(ev(['конвойный эсминец']))).toEqual([]);
    expect(topicsOf(ev(['супербитва']))).toEqual([]);
    expect(topicsOf(ev(['Битва при Гастингсе']))).toEqual(['история']);
  });

  it('у каждой темы есть правило', () => {
    for (const t of TOPICS) expect(() => topicsOf(ev([t]))).not.toThrow();
  });

  it('в облачке — год, текст и подпись лицензии', () => {
    expect(line(ev([], 'Первый полёт человека в космос.'))).toBe(`В этот день в 1961 году: Первый полёт человека в космос. (${SIGN})`);
    expect(SIGN).toBe('Википедия, CC BY-SA');
  });

  it('раскладка: до н. э., без текста и длинное — мимо', () => {
    const out = sort([
      ev(['космонавт'], 'Полёт.'),
      ev(['космонавт'], 'Давно.', -44),
      ev(['космонавт'], ''),
      ev(['космонавт'], 'я'.repeat(MAX_TEXT + 1)),
      ev(['футболист', 'космонавт'], 'Матч в невесомости.'),
    ]);
    expect(out).toEqual({
      футбол: [line(ev([], 'Матч в невесомости.'))],
      космос: [line(ev([], 'Полёт.')), line(ev([], 'Матч в невесомости.'))],
    });
  });

  it('на тему — не больше PER_TOPIC, в порядке Википедии', () => {
    const events = Array.from({ length: PER_TOPIC + 3 }, (_, i) => ev(['физик'], `Открытие ${i}.`, 1900 + i));
    const out = sort(events).наука ?? [];
    expect(out).toHaveLength(PER_TOPIC);
    expect(out[0]).toContain('Открытие 0.');
  });

  it('пустой день — пусто', () => {
    expect(sort([])).toEqual({});
  });
});
