import { afterEach, describe, expect, it } from 'vitest';
import {
  type Day,
  type Facts,
  KEEP,
  NUMS,
  begin,
  clean,
  facts,
  load,
  loadList,
  potty,
  programName,
  push,
  save,
  saveList,
  seed,
  span,
  tick,
  times,
  title,
  worth,
  write,
} from './diary';
import { setLang } from './i18n';
import { MAX_STEP_MS, fresh, type Stats } from './stats';

const MIN = 60_000;
const HOUR = 60 * MIN;

function stats(over: Partial<Stats> = {}): Stats {
  return { ...fresh(0), ...over };
}

function day(over: Partial<Facts> = {}): Facts {
  const f = { day: '2026-11-07' } as Facts;
  for (const k of NUMS) f[k] = 0;
  return { ...f, ...over };
}

/** Предложений в тексте: каждое кончается точкой (шаблоны — ровно по одному). */
const sentences = (s: string): number => s.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;

describe('дневник: срез дня', () => {
  it('счётчики дня — разница со статистикой на начало дня', () => {
    const d = begin('2026-11-07', stats({ fed: 10, petted: 5, woken: 1 }));
    const f = facts(d, stats({ fed: 12, petted: 9, woken: 3, puddles: 1 }));
    expect(f).toMatchObject({ day: '2026-11-07', fed: 2, petted: 4, woken: 2, puddles: 1, naps: 0 });
    // статистику сбросили (новый файл) — минусов нет
    expect(facts(d, stats()).fed).toBe(0);
  });

  it('копит время за компом, по программам и сон; простой и скачки часов не в счёт', () => {
    let d = begin('2026-11-07', stats());
    d = tick(d, 1000, { app: 'Excel', human: true, asleep: false });
    d = tick(d, 2000, { app: 'Excel', human: true, asleep: true });
    d = tick(d, 500, { app: 'Steam', human: false, asleep: true });
    d = tick(d, 700, { app: null, human: true, asleep: false });
    expect(d.desk).toBe(3700);
    expect(d.sleep).toBe(2500);
    expect(d.apps).toEqual({ Excel: 3000 });
    // компьютер спал: шаг обрезается
    expect(tick(d, 10 * HOUR, { app: 'Excel', human: true, asleep: false }).desk).toBe(3700 + MAX_STEP_MS);
    // никого и не спит — тот же объект
    expect(tick(d, 1000, { app: 'Excel', human: false, asleep: false })).toBe(d);
    expect(potty(potty(d)).potty).toBe(2);
  });

  it('не помнит больше 40 программ за день', () => {
    let d = begin('2026-11-07', stats());
    for (let i = 0; i < 60; i++) d = tick(d, 1000, { app: `App${i}`, human: true, asleep: false });
    expect(Object.keys(d.apps)).toHaveLength(40);
    // знакомая продолжает копиться
    d = tick(d, 1000, { app: 'App0', human: true, asleep: false });
    expect(d.apps.App0).toBe(2000);
  });

  it('срез переживает перезапуск, битый файл — новый день с текущей статистики', () => {
    let d = begin('2026-11-07', stats({ fed: 3 }));
    d = tick(d, 5000, { app: 'Word', human: true, asleep: false });
    const back = load(save(d), '2026-11-08', stats({ fed: 7 }));
    expect(back.key).toBe('2026-11-07');
    expect(back.base.fed).toBe(3);
    expect(back.apps).toEqual({ Word: 5000 });
    for (const raw of [null, '', '{', '[]', '{"key":"вчера"}', '{"key":1}']) {
      const n = load(raw, '2026-11-08', stats({ fed: 7 }));
      expect(n.key).toBe('2026-11-08');
      expect(n.base.fed).toBe(7);
    }
  });

  it('программа дня — дольше всех, не мимолётная', () => {
    const d: Day = { ...begin('2026-11-07', stats()), apps: { Excel: 3 * HOUR, Steam: HOUR, Paint: 5 * MIN } };
    expect(facts(d, stats()).app).toBe('Excel');
    expect(facts({ ...d, apps: { Paint: 5 * MIN } }, stats()).app).toBeUndefined();
    // привычное короткое имя
    expect(facts({ ...d, apps: { 'Microsoft Excel': HOUR } }, stats()).app).toBe('Excel');
    expect(facts({ ...d, apps: { 'Visual Studio Code': HOUR } }, stats()).app).toBe('VS Code');
  });

  it('пустой день не записываем', () => {
    expect(worth(day())).toBe(false);
    expect(worth(day({ desk: 30_000 }))).toBe(false);
    expect(worth(day({ desk: 2 * MIN }))).toBe(true);
    expect(worth(day({ fed: 1 }))).toBe(true);
  });
});

describe('дневник: хранение', () => {
  it('свежие сверху, одна запись на день, не больше KEEP', () => {
    let list: Facts[] = [];
    for (let i = 1; i <= 40; i++) list = push(list, day({ day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, fed: i }));
    expect(list.length).toBeLessThanOrEqual(KEEP);
    expect(new Set(list.map((f) => f.day)).size).toBe(list.length);
    expect(list.map((f) => f.day)).toEqual([...list.map((f) => f.day)].sort().reverse());
    // тот же день — заменяется новой записью
    const again = push(list, day({ day: list[3].day, fed: 999 }));
    expect(again.filter((f) => f.day === list[3].day)).toHaveLength(1);
    expect(again.find((f) => f.day === list[3].day)?.fed).toBe(999);

    let many: Facts[] = [];
    for (let i = 0; i < 60; i++) many = push(many, day({ day: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` }));
    expect(many).toHaveLength(KEEP);
    expect(many[0].day).toBe('2026-03-04');
  });

  it('с диска — только числа и проверенное имя; мусор пропускаем', () => {
    const list = [day({ day: '2026-11-06', fed: 2, app: 'Excel' }), day({ day: '2026-11-05' })];
    expect(loadList(saveList(list))).toEqual(list);
    for (const raw of [null, '', 'not json', '{}', '"x"']) expect(loadList(raw)).toEqual([]);
    const odd = loadList(JSON.stringify([{ day: 'вчера' }, null, 5, { day: '2026-11-04', fed: '3', petted: -2, app: 'C:\\secret.docx' }]));
    expect(odd).toEqual([day({ day: '2026-11-04', fed: 3 })]);
  });
});

describe('дневник: приватность', () => {
  afterEach(() => setLang('ru'));

  it('имена программ пропускает, заголовки, пути и секреты — нет', () => {
    for (const ok of ['Excel', 'Google Chrome', 'Steam', 'Counter-Strike 2', 'Blender', 'Path of Exile', 'Unity', 'Блокнот']) {
      expect(programName(ok), ok).not.toBeNull();
    }
    const bad = [
      'Отчёт за квартал.xlsx - Excel',
      'Входящие — Почта',
      'Inbox (3) | mail@example.com',
      'C:\\Users\\vlad\\Documents\\diary.txt',
      '/home/user/notes',
      'https://bank.example.com',
      'www.example.com',
      'photo.jpeg',
      'secret_plans.docx',
      'KeePass Password Safe',
      'Bitwarden',
      'Telegram Desktop',
      'WhatsApp',
      'Сбербанк Онлайн',
      'Discord',
      'Outlook',
      'Проводник',
      'Windows Explorer',
      'DeskPartner',
      'строка\nс переводом',
      '12345',
      'x',
      'Очень длинное имя, которое больше похоже на заголовок окна, чем на программу',
      '',
      '   ',
    ];
    for (const b of bad) expect(programName(b), b).toBeNull();
    for (const b of [null, undefined, 5, {}, ['Excel']]) expect(programName(b)).toBeNull();
  });

  it('из среза в факты попадают только числа, дата и одно проверенное имя', () => {
    const d = {
      ...begin('2026-11-07', stats()),
      apps: { 'Пароль от почты.txt - Блокнот': 9 * HOUR, 'Telegram Desktop': 8 * HOUR, 'C:\\tmp\\x': 7 * HOUR, Excel: 2 * HOUR },
      title: 'Секретный документ',
    } as Day;
    const f = facts(d, stats());
    expect(f.app).toBe('Excel');
    expect(Object.keys(f).sort()).toEqual(['app', 'day', ...NUMS].sort());
    for (const k of NUMS) expect(typeof f[k]).toBe('number');
    // одни секреты — программу дня не называем вовсе
    expect(facts({ ...d, apps: { KeePass: 9 * HOUR, 'Отчёт.docx - Word': 5 * HOUR } }, stats()).app).toBeUndefined();
  });

  it('в текст записи не попадает ничего, кроме шаблона, чисел и имени программы', () => {
    const secrets = ['Секретный', 'Пароль', 'Telegram', 'docx', 'C:\\', 'mail@'];
    for (const l of ['ru', 'en'] as const) {
      setLang(l);
      for (let i = 1; i <= 28; i++) {
        const hostile = {
          ...day({ day: `2026-02-${String(i).padStart(2, '0')}`, desk: 5 * HOUR, fed: i % 3, petted: i % 4, woken: i % 3, puddles: i % 2, films: i % 2, filmMs: HOUR }),
          app: 'Excel',
          title: 'Секретный документ',
          window: 'Пароль от почты.txt - Блокнот',
        } as Facts;
        const text = write(hostile);
        for (const s of secrets) expect(text).not.toContain(s);
        // с диска подмена имени не проходит
        const tampered = clean({ ...hostile, app: 'Telegram: чат с мамой' });
        expect(tampered?.app).toBeUndefined();
        const txt = write(tampered!);
        for (const s of secrets) expect(txt).not.toContain(s);
      }
    }
  });
});

describe('дневник: текст', () => {
  afterEach(() => setLang('ru'));

  it('одна дата — одна и та же запись; разные даты — разные', () => {
    const f = day({ desk: 6 * HOUR, app: 'Excel', fed: 2, petted: 3, woken: 2, puddles: 1, sleep: 2 * HOUR, potty: 1, yarns: 1 });
    expect(write(f)).toBe(write(f));
    expect(write(f, seed(f.day))).toBe(write(f));
    const texts = new Set<string>();
    for (let i = 1; i <= 28; i++) texts.add(write({ ...f, day: `2026-03-${String(i).padStart(2, '0')}` }));
    expect(texts.size).toBeGreaterThan(20);
  });

  it('2–4 предложения, на обоих языках, без незаполненных мест', () => {
    for (const l of ['ru', 'en'] as const) {
      setLang(l);
      for (let i = 0; i < 300; i++) {
        const r = seed(`fuzz-${i}`);
        const n = (max: number) => (r() < 0.4 ? 0 : Math.floor(r() * max));
        const f = day({
          day: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
          desk: n(10 * HOUR),
          app: r() < 0.6 ? 'Excel' : undefined,
          sleep: n(4 * HOUR),
          naps: n(4),
          woken: n(4),
          fed: n(5),
          petted: n(12),
          carried: n(3),
          yarns: n(3),
          mice: n(4),
          lasers: n(3),
          revenges: n(2),
          puddles: n(2),
          films: n(2),
          filmMs: n(3 * HOUR),
          calls: n(3),
          runaways: r() < 0.05 ? 1 : 0,
          cakes: r() < 0.05 ? 1 : 0,
          potty: n(3),
        });
        f.caught = Math.min(f.caught, f.mice);
        const text = write(f);
        const k = sentences(text);
        expect(k, text).toBeGreaterThanOrEqual(2);
        expect(k, text).toBeLessThanOrEqual(4);
        expect(text).not.toMatch(/undefined|NaN|\$\{|\{|\}/);
        if (l === 'en') expect(text).not.toMatch(/[а-яё]/i);
        else expect(text).toMatch(/[а-яё]/i);
      }
    }
  });

  it('месть с побудкой — как в плане: «меня два раза будили — пришлось оставить лужу»', () => {
    const f = day({ desk: 6 * HOUR, app: 'Excel', woken: 2, puddles: 1, revenges: 1 });
    // ищем дату, где выпал первый шаблон мести; тема мести тяжёлая и почти всегда в записи
    const hits = Array.from({ length: 28 }, (_, i) => write({ ...f, day: `2026-04-${String(i + 1).padStart(2, '0')}` }));
    expect(hits.some((s) => s.includes('Меня два раза будили — пришлось оставить лужу.'))).toBe(true);
    expect(hits.filter((s) => s.includes('луж')).length).toBeGreaterThan(20);
    // про Excel — в начале
    expect(hits.every((s) => s.includes('Excel'))).toBe(true);
  });

  it('человек почти не заходил — без программы и часов', () => {
    const text = write(day({ desk: 5 * MIN, app: 'Excel', fed: 1 }));
    expect(text).not.toContain('Excel');
  });

  it('числа словами и время в винительном', () => {
    expect(times(1)).toBe('один раз');
    expect(times(2)).toBe('два раза');
    expect(times(5)).toBe('пять раз');
    expect(times(21)).toBe('21 раз');
    expect(span(21 * MIN)).toBe('21 минуту');
    expect(span(3 * MIN)).toBe('3 минуты');
    expect(span(50 * MIN)).toBe('1 час');
    expect(span(6.2 * HOUR)).toBe('6 часов');
    setLang('en');
    expect(times(1)).toBe('once');
    expect(times(2)).toBe('twice');
    expect(times(3)).toBe('three times');
    expect(span(MIN)).toBe('1 minute');
    expect(span(2 * HOUR)).toBe('2 hours');
  });

  it('дата записи: год — только если не текущий', () => {
    expect(title('2026-11-07', '2026-11-08')).toBe('7 ноября');
    expect(title('2025-12-31', '2026-01-01')).toBe('31 декабря 2025');
    setLang('en');
    expect(title('2026-11-07', '2026-11-08')).toBe('November 7');
    expect(title('2025-12-31', '2026-01-01')).toBe('December 31, 2025');
  });
});
