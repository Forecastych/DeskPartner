import { describe, expect, it, vi } from 'vitest';
import {
  clock,
  type FeedStatus,
  feedState,
  MAX_TITLE,
  newsCount,
  type NewsItem,
  newsLine,
  newsStatus,
  newsSummary,
  pickNews,
} from './news';

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
    expect(await pickNews(invoke, ['космос', 'наука'], { космос: 1.5 })).toEqual(item);
    expect(invoke).toHaveBeenCalledWith('news_pick', { topics: ['космос', 'наука'], weights: { космос: 1.5 } });
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

  it('cuts a long title', () => {
    const line = newsLine({ ...item, title: 'а'.repeat(300) });
    expect(line).toBe(`Пишут: ${'а'.repeat(MAX_TITLE - 1)}… (Лента.ру)`);
  });
});

/** Местное время в unix-секундах: тесты не зависят от часового пояса машины. */
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime() / 1000;
const NOW = at(6, 15, 0);

const feed: FeedStatus = {
  source: 'KinoNews',
  lang: 'ru',
  topics: ['кино', 'сериалы'],
  at: at(6, 14, 5),
  ok: true,
  next: at(6, 16, 35),
  items: 12,
  weight: 1,
};

describe('news status', () => {
  it('counts news in Russian', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map(newsCount)).toEqual([
      '1 новость',
      '2 новости',
      '5 новостей',
      '11 новостей',
      '21 новость',
      '22 новости',
      '112 новостей',
    ]);
  });

  it('shows the date only when it is not today', () => {
    expect(clock(at(6, 9, 7), NOW)).toBe('9:07');
    expect(clock(at(5, 23, 50), NOW)).toMatch(/^5 нояб\.? 23:50$/);
  });

  it('describes a feed', () => {
    expect(feedState(feed, NOW, false)).toBe('обновлена в 14:05 · 12 новостей');
    expect(feedState({ ...feed, weight: 2.25 }, NOW, false)).toBe('обновлена в 14:05 · 12 новостей · по лайкам — чаще');
    expect(feedState({ ...feed, weight: 0.5, items: 1 }, NOW, false)).toBe('обновлена в 14:05 · 1 новость · по дизам — реже');
    expect(feedState({ ...feed, ok: false, next: at(6, 14, 35) }, NOW, false)).toBe('не ответила в 14:05, повтор в 14:35');
    expect(feedState({ ...feed, at: null, ok: null, next: null }, NOW, false)).toBe('ещё не качалась');
    expect(feedState({ ...feed, at: null, ok: null, next: null }, NOW, true)).toBe('качается…');
  });

  it('sums up all feeds', () => {
    const other: FeedStatus = { ...feed, source: 'TVLine', ok: false, next: at(6, 15, 30) };
    expect(newsSummary({ busy: true, now: NOW, feeds: [feed] })).toBe('Сейчас обновляются…');
    expect(newsSummary({ busy: false, now: NOW, feeds: [feed, other] })).toBe(
      'Следующее обновление в 15:30. Не отвечают: 1 из 2.',
    );
    expect(newsSummary({ busy: false, now: NOW, feeds: [{ ...feed, next: null }] })).toBe('Скоро обновятся.');
    expect(newsSummary({ busy: false, now: NOW, feeds: [] })).toBe('Темы не выбраны — ленты не качаются.');
  });

  it('newsStatus survives errors and strange answers', async () => {
    const ok = { busy: false, now: NOW, feeds: [feed] };
    expect(await newsStatus(vi.fn().mockResolvedValue(ok))).toEqual(ok);
    expect(await newsStatus(vi.fn().mockRejectedValue(new Error('no backend')))).toBeNull();
    expect(await newsStatus(vi.fn().mockResolvedValue({ feeds: 'нет' }))).toBeNull();
    expect(await newsStatus(vi.fn().mockResolvedValue(null))).toBeNull();
  });
});
