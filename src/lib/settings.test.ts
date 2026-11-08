import { describe, expect, it } from 'vitest';
import { ANIME_TITLES_MAX, BREEDS, cleanName, defaults, NAME_MAX, NAMES, parse, releasesSetup, serialize, suggestName } from './settings';

describe('настройки', () => {
  it('по умолчанию осторожная версия, но от записи экрана прячемся', () => {
    const d = defaults();
    expect(d).toMatchObject({ feeder: false, bed: false, litter: false, gameWindow: false, sites: false, reviews: false, hideFromCapture: true });
    expect(d).toMatchObject({ mode: 'calm', chatter: 'sometimes', topics: [], tmdbKey: '' });
    // охотник выключен; включили — по панели задач
    expect(d).toMatchObject({ hunter: false, hunterArea: 'taskbar' });
    // клубок тихий — включён сразу; у старых настроек без поля — тоже
    expect(d.yarn).toBe(true);
    expect(parse(JSON.stringify({ feeder: true })).yarn).toBe(true);
    expect(parse(JSON.stringify({ yarn: false })).yarn).toBe(false);
    expect(parse(JSON.stringify({ yarn: 'нет' })).yarn).toBe(true);
    // обновления проверяем сразу; у старых настроек без поля — тоже
    expect(d.updates).toBe(true);
    expect(parse(JSON.stringify({ feeder: true })).updates).toBe(true);
    expect(parse(JSON.stringify({ updates: false })).updates).toBe(false);
  });

  it('туда и обратно без потерь', () => {
    const s = { ...defaults(), feeder: true, topics: ['аниме', 'космос'] as const, mode: 'pranks', tmdbKey: 'abc' } as const;
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

  it('окрас: по умолчанию серая, у старых настроек без поля — тоже; мусор — серая, остальное живёт', () => {
    expect(defaults().breed).toBe('tabby');
    expect(parse(JSON.stringify({ feeder: true })).breed).toBe('tabby');
    for (const b of BREEDS) expect(parse(JSON.stringify({ breed: b })).breed).toBe(b);
    expect(parse(JSON.stringify({ breed: 'siamese', feeder: true }))).toMatchObject({ breed: 'tabby', feeder: true });
    expect(parse(JSON.stringify({ breed: 3 })).breed).toBe('tabby');
  });

  it('охотник: битое поле — по умолчанию, остальное живёт', () => {
    expect(parse(JSON.stringify({ hunter: true, hunterArea: 'screen' }))).toMatchObject({ hunter: true, hunterArea: 'screen' });
    expect(parse(JSON.stringify({ hunter: 'да', hunterArea: 'desk', feeder: true }))).toMatchObject({
      hunter: false,
      hunterArea: 'taskbar',
      feeder: true,
    });
  });

  it('имя: старые настройки без имени — пусто, мусор вычищается', () => {
    expect(parse('{"feeder":true}').name).toBe('');
    expect(parse('{"name":42}').name).toBe('');
    expect(parse(JSON.stringify({ name: '  Мурка  ' })).name).toBe('Мурка');
    expect(cleanName('Му\u0000р\nка  Пуш')).toBe('Мурка Пуш');
    expect([...cleanName('я'.repeat(50))]).toHaveLength(NAME_MAX);
    // эмодзи не режется посередине
    expect(cleanName('🐱'.repeat(30))).toBe('🐱'.repeat(NAME_MAX));
  });

  it('«Другое» предлагает имя из списка и не то же самое', () => {
    for (let i = 0; i < 20; i++) {
      const n = suggestName(() => i / 20, 'Мурка');
      expect(NAMES.ru).toContain(n);
      expect(n).not.toBe('Мурка');
    }
  });

  it('темы — в порядке списка и без повторов', () => {
    expect(parse(JSON.stringify({ topics: ['космос', 'кино', 'космос'] })).topics).toEqual(['кино', 'космос']);
  });

  it('форма: по умолчанию взрослая, чужое значение не проходит', () => {
    expect(defaults().form).toBe('adult');
    expect(parse(JSON.stringify({ form: 'kitten' })).form).toBe('kitten');
    expect(parse(JSON.stringify({ form: 'teen' })).form).toBe('teen');
    expect(parse(JSON.stringify({ form: 'dragon' })).form).toBe('adult');
    expect(parse(JSON.stringify({ lang: 'ru' })).form).toBe('adult');
  });

  it('игры и серии: по умолчанию выключены, список тайтлов обрезан', () => {
    expect(defaults()).toMatchObject({ gameNews: false, anime: false, animeTitles: '' });
    expect(parse(JSON.stringify({ gameNews: true, anime: true, animeTitles: '  Фрирен, One Piece  ' }))).toMatchObject({
      gameNews: true,
      anime: true,
      animeTitles: 'Фрирен, One Piece',
    });
    expect(parse(JSON.stringify({ gameNews: 'да', anime: 1, animeTitles: 7 }))).toMatchObject({ gameNews: false, anime: false, animeTitles: '' });
    expect(parse(JSON.stringify({ animeTitles: 'а'.repeat(5000) })).animeTitles).toHaveLength(ANIME_TITLES_MAX);
  });

  it('в Rust уходит список тайтлов, только пока галочка стоит', () => {
    const s = { ...defaults(), gameNews: true, animeTitles: ' Фрирен ' };
    expect(releasesSetup(s)).toEqual({ steam: true, anime: '' });
    expect(releasesSetup({ ...s, anime: true })).toEqual({ steam: true, anime: 'Фрирен' });
    expect(releasesSetup(defaults())).toEqual({ steam: false, anime: '' });
  });
});
