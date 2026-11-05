import { describe, expect, it, vi } from 'vitest';
import { MAX_TITLE, type NewsItem, newsLine, pickNews } from './news';

const item: NewsItem = {
  topic: 'космос',
  title: 'Самая сильная за месяц вспышка произошла на Солнце',
  link: 'https://lenta.ru/news/2026/11/05/flare/',
  source: 'Лента.ру',
  lang: 'ru',
  date: 1_793_900_000,
};

describe('pickNews', () => {
  it('passes topics to news_pick and returns the item', async () => {
    const invoke = vi.fn().mockResolvedValue(item);
    expect(await pickNews(invoke, ['космос', 'наука'])).toEqual(item);
    expect(invoke).toHaveBeenCalledWith('news_pick', { topics: ['космос', 'наука'] });
  });

  it('gives null when there is nothing, on errors and on a strange answer', async () => {
    expect(await pickNews(vi.fn().mockResolvedValue(null), ['кино'])).toBeNull();
    expect(await pickNews(vi.fn().mockRejectedValue(new Error('no backend')), ['кино'])).toBeNull();
    expect(await pickNews(vi.fn().mockResolvedValue({ title: 'нет полей' }), ['кино'])).toBeNull();
    expect(await pickNews(vi.fn().mockResolvedValue({ ...item, title: '  ' }), ['кино'])).toBeNull();
  });
});

describe('newsLine', () => {
  it('names the source', () => {
    expect(newsLine(item)).toBe('Пишут: Самая сильная за месяц вспышка произошла на Солнце (Лента.ру)');
  });

  it('marks English news', () => {
    const en: NewsItem = { ...item, title: 'Webb spots a new exoplanet', source: 'Space.com', lang: 'en' };
    expect(newsLine(en)).toBe('Пишут (англ.): Webb spots a new exoplanet (Space.com)');
  });

  it('cuts a long title', () => {
    const line = newsLine({ ...item, title: 'а'.repeat(300) });
    expect(line).toBe(`Пишут: ${'а'.repeat(MAX_TITLE - 1)}… (Лента.ру)`);
  });
});
