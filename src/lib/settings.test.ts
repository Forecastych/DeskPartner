import { describe, expect, it } from 'vitest';
import { defaults, parse, serialize } from './settings';

describe('настройки', () => {
  it('по умолчанию осторожная версия, но от записи экрана прячемся', () => {
    const d = defaults();
    expect(d).toMatchObject({ feeder: false, bed: false, gameWindow: false, sites: false, reviews: false, hideFromCapture: true });
    expect(d).toMatchObject({ mode: 'calm', chatter: 'sometimes', topics: [], tmdbKey: '' });
  });

  it('туда и обратно без потерь', () => {
    const s = { ...defaults(), feeder: true, topics: ['космос', 'аниме'] as const, mode: 'pranks', tmdbKey: 'abc' } as const;
    const copy = { ...s, topics: [...s.topics] };
    expect(parse(serialize(copy))).toEqual(copy);
  });

  it('нет файла, битый JSON или не объект — значения по умолчанию', () => {
    for (const raw of [null, '{', '[]', '42', 'null']) expect(parse(raw)).toEqual(defaults());
  });

  it('битое поле заменяется поштучно, остальные живут', () => {
    const s = parse(JSON.stringify({ feeder: true, bed: 'yes', mode: 'chaos', chatter: 1, topics: ['космос', 'вязание', 7], tmdbKey: '  k  ' }));
    expect(s).toMatchObject({ feeder: true, bed: false, mode: 'calm', chatter: 'sometimes', topics: ['космос'], tmdbKey: 'k' });
  });

  it('темы — в порядке списка и без повторов', () => {
    expect(parse(JSON.stringify({ topics: ['кино', 'космос', 'кино'] })).topics).toEqual(['космос', 'кино']);
  });
});
