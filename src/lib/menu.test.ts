import { describe, expect, it } from 'vitest';
import { fill, pickId, picked, type MenuEntry } from './menu';

describe('меню: пункт с ползунком', () => {
  it('шаблон подставляет число и русскую форму слова', () => {
    const ru = 'Фокус {n} {минута|минуты|минут}';
    expect(fill(ru, 1)).toBe('Фокус 1 минута');
    expect(fill(ru, 2)).toBe('Фокус 2 минуты');
    expect(fill(ru, 5)).toBe('Фокус 5 минут');
    expect(fill(ru, 11)).toBe('Фокус 11 минут');
    expect(fill(ru, 21)).toBe('Фокус 21 минута');
    expect(fill(ru, 40)).toBe('Фокус 40 минут');
    expect(fill(ru, 180)).toBe('Фокус 180 минут');
  });

  it('английский — две формы: одна и много', () => {
    const en = 'Focus for {n} {minute|minutes}';
    expect(fill(en, 1)).toBe('Focus for 1 minute');
    expect(fill(en, 40)).toBe('Focus for 40 minutes');
  });

  it('текст без шаблона и чужие скобки остаются как есть', () => {
    expect(fill('Покормить', 7)).toBe('Покормить');
    expect(fill('{x}', 7)).toBe('{x}');
    expect(fill('{a|b|c|d}', 7)).toBe('{a|b|c|d}');
  });

  it('выбор: у пункта с ползунком — «id:число», у обычного — просто id', () => {
    const slider: MenuEntry = { id: 'focus', text: '', slider: { min: 1, max: 180, value: 25, label: '' } };
    const plain: MenuEntry = { id: 'feed', text: '' };
    expect(pickId(slider, 40)).toBe('focus:40');
    expect(pickId(slider)).toBe('focus');
    expect(pickId(plain, 40)).toBe('feed');
  });

  it('разбор выбора обратно', () => {
    expect(picked('focus:40')).toEqual(['focus', 40]);
    expect(picked('focus')).toEqual(['focus', null]);
    expect(picked('focus-cancel')).toEqual(['focus-cancel', null]);
    expect(picked('focus:')).toEqual(['focus:', null]);
    expect(picked('focus:abc')).toEqual(['focus:abc', null]);
  });
});
