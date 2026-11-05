import { describe, expect, it } from 'vitest';
import { average, dullWords, GOOD, LOW, verdict, type Film } from './reviews';

const film = (scores: number[], reception = '', lang = 'ru'): Film => ({ label: 'Фильм', scores, lang, reception });

describe('reviews: отзывы без ключа', () => {
  it('скучные слова — с любым окончанием и с начала слова', () => {
    expect(dullWords(film([], 'Критики сочли фильм затянутым и местами скучноватым.'))).toBe(2);
    expect(dullWords(film([], 'Нудно. НУДНО! Затянуто'))).toBe(3);
    expect(dullWords(film([], 'Публике не наскучило, цветок завял, а сюжет — нет'))).toBe(0);
    expect(dullWords(film([], 'An overlong, tedious and boring film.', 'en'))).toBe(3);
  });

  it('слова считаются только на языке раздела', () => {
    expect(dullWords(film([], 'boring boring', 'ru'))).toBe(0);
    expect(dullWords(film([], 'скучно скучно', ''))).toBe(0);
  });

  it('средняя оценка', () => {
    expect(average([])).toBeNull();
    expect(average([0.7, 0.8])).toBeCloseTo(0.75);
  });

  it('низкая оценка — скучный, что бы ни писали', () => {
    expect(verdict(film([LOW - 0.1, LOW - 0.05], 'Шедевр.'))).toBe('dull');
  });

  it('ворчание на хронометраж хвалёный фильм не топит', () => {
    const text = 'Местами затянуто. Второй час скучноват. Нудные диалоги.';
    expect(verdict(film([GOOD + 0.1], text))).toBe('fine');
    expect(verdict(film([GOOD - 0.05], text))).toBe('dull');
    expect(verdict(film([], text))).toBe('dull');
  });

  it('одно ворчание — ещё не приговор', () => {
    expect(verdict(film([0.6], 'Немного затянуто.'))).toBe('fine');
  });

  it('ничего не знаем — так и говорим', () => {
    expect(verdict(null)).toBe('unknown');
    expect(verdict(film([], ''))).toBe('unknown');
    expect(verdict(film([], 'Фильм получил смешанные отзывы.'))).toBe('fine');
  });
});
