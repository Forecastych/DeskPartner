import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from './i18n';
import { MAX_TITLE } from './news';
import { pickRelease, type ReleasePick, releaseLine, releaseSource, releaseTopic } from './releases';

const patch: ReleasePick = {
  kind: 'game',
  name: 'Dota 2',
  title: 'Патч 7.39',
  episode: null,
  patch: true,
  link: 'https://store.steampowered.com/news/app/570/view/1',
};

const episode: ReleasePick = {
  kind: 'anime',
  name: 'Фрирен',
  title: '',
  episode: 5,
  patch: false,
  link: 'https://anilist.co/anime/182255',
};

afterEach(() => setLang('ru'));

describe('pickRelease', () => {
  it('asks release_pick and returns the release', async () => {
    const invoke = vi.fn().mockResolvedValue(patch);
    expect(await pickRelease(invoke)).toEqual(patch);
    expect(invoke).toHaveBeenCalledWith('release_pick');
  });

  it('treats a missing episode as none', async () => {
    const { episode: _, ...rest } = patch;
    expect(await pickRelease(vi.fn().mockResolvedValue(rest))).toEqual(patch);
  });

  it('gives null when there is nothing, on errors and on a strange answer', async () => {
    expect(await pickRelease(vi.fn().mockResolvedValue(null))).toBeNull();
    expect(await pickRelease(vi.fn().mockRejectedValue(new Error('no backend')))).toBeNull();
    expect(await pickRelease(vi.fn().mockResolvedValue({ ...patch, kind: 'movie' }))).toBeNull();
    expect(await pickRelease(vi.fn().mockResolvedValue({ ...patch, name: ' ' }))).toBeNull();
    // ссылка не https — облачку такая ни к чему, Rust её всё равно не откроет
    expect(await pickRelease(vi.fn().mockResolvedValue({ ...patch, link: 'file:///C:/x.exe' }))).toBeNull();
  });
});

describe('releaseLine', () => {
  it('tells a patch, an announcement and an episode in Russian', () => {
    expect(releaseLine(patch)).toBe('В Dota 2 вышел патч «Патч 7.39» — глянем?');
    expect(releaseLine({ ...patch, patch: false, title: 'Турнир выходного дня' })).toBe('Dota 2: «Турнир выходного дня» — глянем?');
    expect(releaseLine(episode)).toBe('Вышла 5-я серия «Фрирен» — посмотрим?');
    expect(releaseLine({ ...episode, episode: null })).toBe('Вышла новая серия «Фрирен» — посмотрим?');
  });

  it('speaks English in the English interface', () => {
    setLang('en');
    expect(releaseLine({ ...patch, title: 'Gameplay Update 7.39' })).toBe('Dota 2 got a patch: “Gameplay Update 7.39”. Take a look?');
    expect(releaseLine({ ...patch, patch: false, title: 'The International' })).toBe('Dota 2: “The International”. Take a look?');
    expect(releaseLine({ ...episode, name: 'Frieren' })).toBe('Episode 5 of “Frieren” is out. Watch it?');
    expect(releaseLine({ ...episode, name: 'Frieren', episode: null })).toBe('A new episode of “Frieren” is out. Watch it?');
  });

  it('cuts a long title', () => {
    const line = releaseLine({ ...patch, title: 'а'.repeat(300) });
    expect(line).toContain(`«${'а'.repeat(MAX_TITLE - 1)}…»`);
  });
});

describe('topic and source', () => {
  it('maps games to Steam and anime to AniList', () => {
    expect([releaseTopic(patch), releaseSource(patch)]).toEqual(['игры', 'Steam']);
    expect([releaseTopic(episode), releaseSource(episode)]).toEqual(['аниме', 'AniList']);
  });
});
