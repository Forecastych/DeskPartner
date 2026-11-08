<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import * as calls from './lib/call';
  import * as chatter from './lib/chatter';
  import { feedBowl, fresh, isHungry, load, refill, save, starve, step, takeOut, type Belly } from './lib/hunger';
  import * as mouse from './lib/mouse';
  import * as movie from './lib/movie';
  import { verdict, type Film, type Verdict } from './lib/reviews';
  import * as yarn from './lib/yarn';
  import * as revenge from './lib/revenge';
  import * as litter from './lib/litter';
  import * as fly from './lib/fly';
  import * as gift from './lib/gift';
  import { withMouse } from './lib/giftArt';
  import * as roam from './lib/roam';
  import * as news from './lib/news';
  import * as rel from './lib/releases';
  import { parse, releasesSetup, serialize, TOPICS, type Breed, type Chatter, type Form, type HunterArea, type Settings, type Topic } from './lib/settings';
  import { playGap, traits } from './lib/breed';
  import { paint, palette } from './lib/coat';
  import * as sleepy from './lib/sleep';
  import * as pomodoro from './lib/pomodoro';
  import { focusFrame } from './lib/hourglass';
  import * as tally from './lib/stats';
  import * as diary from './lib/diary';
  import * as chrono from './lib/chrono';
  import * as holidays from './lib/holidays';
  import * as awards from './lib/awards';
  import * as growing from './lib/growth';
  import { ANIMS, BOWL_AT, BOWL_X, bowlLeft, draw, dress, fatOn, flip, ground, hitMask, onBowl, SCRUFF_AT, SIZE, type AnimName, type Frame } from './lib/sprite';
  import { localLegacy, memoryStore, open, tauriBackend, type Store } from './lib/store';
  import * as wiki from './lib/wiki';
  import { count, t } from './lib/i18n';

  const PETTED_MS = 1500;
  /** Поза отдыха держится от 2 до 5 минут, потом кошка может перелечь. */
  const REST_MIN_MS = 2 * 60_000;
  const REST_MAX_MS = 5 * 60_000;
  /** Позы отдыха с весами: чаще сидит, иногда буханкой анфас или боком. */
  const RESTS: [AnimName, number][] = [['sit', 2], ['loaf', 1], ['sideLoaf', 1]];
  /** Как засыпает: обычно калачиком, иногда уткнувшись головой в пол — анфас или боком. */
  const SLEEPS: [AnimName, number][] = [['sleep', 3], ['faceplant', 1], ['sidePlant', 1]];
  /** Разбудили, не доспала — засыпает на ходу, где стояла: носом в пол. */
  const DOZES: [AnimName, number][] = [['faceplant', 1], ['sidePlant', 1]];
  const GROOM_MS = 6000;
  /** Ест столько, потом умывается. */
  const EAT_MS = 8000;
  /** Сколько стоит со звёздочками, врезавшись в край окна на охоте. */
  const BONK_MS = 800;
  /**
   * Точку замечает не сразу: Ctrl+C с заминкой перед буквой зажигает указку на миг (laser.rs, HOLD),
   * и без задержки кошка срывалась через весь экран за вспышкой и шла обратно.
   */
  const DOT_NOTICE_MS = 500;
  /** Охотник: мышь пробегает раз в HUNT_MIN..HUNT_MAX мс, когда кошка свободна. */
  const HUNT_MIN = 15 * 60_000;
  const HUNT_MAX = 40 * 60_000;
  /** Клубок: раз в YARN_MIN..YARN_MAX мс, когда кошка свободна и мыши нет. */
  const YARN_MIN = 60 * 60_000;
  const YARN_MAX = 120 * 60_000;
  /** Вернулась из-за края за мышью — столько облизывается. */
  const LICK_MS = 3000;
  /** Экран был заблокирован хотя бы столько — после разблокировки радуется человеку. */
  const LOCK_JOY_MS = 30_000;
  /** Столько радуется: сердечко, как от ласки. */
  const JOY_MS = 3000;
  /**
   * Ввод на экране блокировки трекер не видит: после пароля человек для него «отошёл», пока не
   * тронет мышь (tracker.rs, IDLE_AFTER). Столько после разблокировки не скучаем.
   */
  const UNLOCK_GRACE_MS = 120_000;
  /** Снимают экран — столько позирует. */
  const POSE_MS = 4000;
  /** Очистили корзину — столько хрумкает. */
  const CRUNCH_MS = 3000;
  /** Праздник: столько сидит у тортика. */
  const CAKE_MS = 8000;
  /** Пока идёт момент роста, кадр перерисовывается так часто: мерцание стадий учащается к концу. */
  const GROW_TICK_MS = 50;
  /** От батареи устаёт во столько раз быстрее: бережёт заряд и спит чаще. */
  const BATTERY_TIRED = 1.5;
  /** Полки внутри окон перечитываются не чаще: детей у окон много, а мышь бегает долго. */
  const SHELVES_MS = 1000;
  /** Шаг движения: 25 раз в секунду — окно едет ровно, а Rust успевает его двигать. */
  const MOVE_MS = 40;
  /** Мониторы и окна перечитываются раз в секунду; пока кошка, миска или лежак на чужом окне — чаще: его могут потащить. */
  const WORLD_MS = 1000;
  const PERCH_WORLD_MS = 200;
  /** С такой вероятностью, сменив позу отдыха, кошка перебирается на другое место. */
  const WANDER = 0.5;
  /** Как часто спрашивать у Rust, что делает человек. Питомцу спешить некуда. */
  const SENSES_MS = 2000;
  /** Голод пишется на диск раз в минуту и на каждом событии: упадёт программа — потеряется не больше минуты. */
  const SAVE_MS = 60_000;
  /** Википедия не ответила — следующая попытка через час: факты не срочные. */
  const WIKI_RETRY_MS = 60 * 60_000;
  /** Новостей нет (лента ещё не скачана, нет сети) — спросить снова через столько. */
  const NEWS_RETRY_MS = 10 * 60_000;
  /** Новость старше — уже не новость: отложенную до вечера выбрасываем и берём свежую. */
  const NEWS_STALE_S = 2 * 24 * 3600;
  /** Пока кошки нет на экране, проверять, не вернулась ли, раз в секунду. */
  const AWAY_TICK_MS = 1000;
  /** С лежаком засыпать уходит в него чаще, чем куда-то ещё. */
  const BED_SLEEP = 0.8;
  const NO_MASK: number[] = Array(SIZE).fill(0);

  /** Крайние столбцы «з-з-з»: из-за края экрана выглядывают только они, а не пустое окно. */
  const [Z_LEFT, Z_RIGHT] = ANIMS[0].zzz.frames.reduce(
    ([lo, hi], f) => {
      for (const row of f) for (let x = 0; x < SIZE; x++) if (row[x] !== '.') [lo, hi] = [Math.min(lo, x), Math.max(hi, x)];
      return [lo, hi];
    },
    [SIZE, -1],
  );

  /** Ответ команды `senses`; здесь только то, что уже нужно. */
  interface Senses {
    idle: boolean;
    typing: boolean;
    session_secs: number;
    active_today_secs: number;
    /** Только в Windows: почему сейчас лучше не мешать; 'no' — можно. */
    quiet?: string;
    /** Только в Windows: идёт ли видео (media.rs). */
    media?: { watching: boolean; title: string; loud: boolean };
    /** Программа в активном окне (имя, не заголовок): месть выбирает, мстить ли в её окно. */
    app?: string | null;
    /** Только в Windows: идёт созвон — занят микрофон или камера, или Zoom показывает экран. Месть тоже молчит. */
    call?: boolean;
    /** Только в Windows: ноутбук работает от батареи. */
    battery?: boolean;
    /** Нажатия и путь мыши с запуска программы — для статистики и достижений. */
    input?: tally.Input;
    /** Активное окно — игра (news/releases.rs): про её патчи — потом, в паузу. */
    game?: boolean;
  }

  /** Файлы в папке, выбранной на первом запуске; до открытия — память, чтобы не ловить null. */
  let store: Store = memoryStore();

  /** Где кошку оставили. Без места — появится у правого края, как в первый раз. */
  function loadSpot(): roam.Spot | null {
    try {
      const s = JSON.parse(store.get('spot') ?? 'null');
      if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y)) return null;
      return { x: s.x, y: s.y, exit: s.exit === 1 || s.exit === -1 ? s.exit : 0 };
    } catch {
      return null;
    }
  }

  /** Где человек поставил миску, лежак или лоток. Без места — по углам основного монитора. */
  function loadPlace(key: 'bowl' | 'bed' | 'litter'): roam.Place | null {
    try {
      const p = JSON.parse(store.get(key) ?? 'null');
      return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null;
    } catch {
      return null;
    }
  }

  /** Галочка «Кормушка»: из файла настроек, ПКМ-меню кошки или окна настроек. */
  let feederOn = false;
  /** Галочка «Лежак» — оттуда же. */
  let bedOn = false;
  /** Галочка «Лоток» — оттуда же. */
  let litterOn = false;
  let bowlPlace: roam.Place | null = null;
  let bedPlace: roam.Place | null = null;
  let litterPlace: roam.Place | null = null;
  /** Миска или лежак упали: окно вещи покажет падение, а не прыгнет на место. */
  let bowlFall = false;
  let bedFall = false;
  let litterFall = false;
  /** Этот сон — в лежаке: пока спит, идёт к нему, куда бы его ни унесли. */
  let bedBound = false;
  /** Окно настроек переносит папку данных: до перезапуска ничего не пишем, иначе запись уйдёт мимо переезда. */
  let frozen = false;
  let belly: Belly = fresh();
  let nap: sleepy.Sleep = sleepy.fresh();
  /** Помодоро: фокус, потягушки, перерыв (pomodoro.ts); null — не идёт. Живёт только в памяти. */
  let focus: pomodoro.Pomodoro | null = null;
  /** Копится за всю жизнь программы (lib/stats); питомец сбежал — цифры остаются. */
  let stats = tally.fresh(Date.now());
  /** Срез сегодняшнего дня и записи дневника (lib/diary); null — хранилище ещё не открыто. */
  let today: diary.Day | null = null;
  let pages: diary.Facts[] = [];
  /** Достижения и наряд за них (lib/awards): полученное не отнимается. */
  let prize = awards.fresh();
  /** Итоги ввода на прошлом опросе: в статистику идёт разница. null — ещё не опрашивали. */
  let lastInput: tally.Input | null = null;
  /** Память загружена: до этого ввод не копим, иначе загрузка затрёт насчитанное. */
  let loaded = false;
  /** Покормили, а кошка не у миски: сначала дойдёт, потом ест. Корм тем временем лежит в миске. */
  let mealPending = false;
  let lastBowl = '';
  let lastBed = '';
  let lastLitter = '';
  /** ЛКМ зажата на кошке: потянут — понесут, отпустят на месте — погладили. */
  let holding = false;
  /** Несут за шкирку: окно двигает Rust, мир кошку не трогает. */
  let carried = false;
  /** Разговорчивость из настроек и что кошка уже наговорила. */
  let chatterLevel: Chatter = 'sometimes';
  /** Окрас: палитра кадра (coat.ts) и характер (breed.ts). Серая — все черты 1, как было всегда. */
  let breed: Breed = 'tabby';
  let coat = palette(breed);
  const trait = () => traits(breed);
  let talk: chatter.Talk = chatter.fresh(Date.now(), chatterLevel, Math.random);
  /** О чём рассказывать факты; пусто — фактов нет. */
  let topics: Topic[] = [];
  /** Имя из настроек: в облачках и шапке меню. */
  let petName = '';
  /** Факты «В этот день» по темам — вперёд встроенных; пусто, пока Википедия не ответила. */
  let wikiFacts: Partial<Record<Topic, string[]>> = {};
  /** За какой день wikiFacts; другой — пора спросить снова. */
  let wikiDay = '';
  /** Раньше этого не спрашиваем: идёт запрос или сети не было — ждём, а не долбим. */
  let wikiNext = 0;
  /**
   * Одна новость про запас, пока её не скажут: news_pick помечает выданное показанным, поэтому
   * берём по одной, а не пачкой. Идёт первой среди фактов своей темы.
   * С `link` — это не новость, а вышедшее у своего (lib/releases.ts): патч игры или серия.
   */
  let held: { topic: Topic; text: string; date: number; source: string; link?: string } | null = null;
  /** На облачке сейчас новость — под ней лайк/диз; голос пойдёт ей. С `link` — «Глянем» откроет ссылку. */
  let voteFor: { topic: Topic; source: string; link?: string } | null = null;
  /** Включены «Новости любимых игр» или «Новые серии аниме». */
  let releasesOn = false;
  /** Раньше этого за новостью не ходим: запрос в пути или новостей не было. */
  let newsNext = 0;
  /** Облачко висит до этих пор; 0 — молчит. */
  let speakingUntil = 0;
  /** Облачко вызвано из трея dev-сборки: висит, даже если кошке не до разговоров. */
  let forced = false;
  /** Последний ответ `senses`; null — Rust ещё не ответил. */
  let senses: Senses | null = null;
  /** Прятки на созвоне: прячется сразу, выходит через calls.RETURN_MS тишины. */
  let hide: calls.Hide = calls.fresh();
  /** Макушка кошки над серединой силуэта, физ. px: сюда облачко ставит хвостик. */
  let head: { x: number; top: number } | null = null;

  let canvas: HTMLCanvasElement;
  let anim: AnimName | null = 'sit';
  let frame: Frame = [];
  let tick = 0;
  let pettedUntil = 0;
  let humanIdle = false;
  /** «Кино вместе»: сеанс, вердикт отзывов о нём и галочка «Подтягивать отзывы». */
  let film: movie.Movie = movie.fresh();
  let filmTitle = '';
  let filmVerdict: Verdict = 'unknown';
  let reviewsOn = false;
  /** Версия, до которой можно обновиться (update.rs), или null. */
  let updateTo: string | null = null;
  /** Вердикты по названию: один фильм — один запрос за жизнь программы (Rust ещё и кэширует на диске). */
  const verdicts = new Map<string, Verdict>();
  /** За краем она спит от скуки на фильме, а не в обиде: громкая сцена может её позвать. */
  let filmNap = false;
  /** Монитор фильма на этот сеанс (movie.screen); null — сеанса нет или место ещё не выбрано. */
  let filmScreen: number | null = null;
  /** Выглянула на громкой сцене: дойдёт до края экрана — спросит, что пропустила. */
  let peekPending = false;
  let lastFilm = Date.now();
  let seenHuman = false;
  /** До этих пор позирует для снимка экрана. */
  let poseUntil = 0;
  /** До этих пор хрумкает содержимым корзины. */
  let crunchUntil = 0;
  /** До этих пор празднует у тортика. */
  let cakeUntil = 0;
  /** Рост (growth.ts): стадия, которую человек видел, и открыт ли выбор формы; форма — из настроек. */
  let growth = growing.fresh();
  let form: Form = 'adult';
  /** Момент роста: когда начался (0 — нет), какой, по каким стадиям и сказала ли уже. */
  let growAt = 0;
  let growKind: growing.Moment = 'grow';
  let growPath: growing.Stage[] = [];
  let growSaid = false;
  /** «Муху съела» (fly.ts): когда началась сценка (0 — нет), когда была прошлая, о какой стадии уже сказала. */
  let flyAt = 0;
  let lastFly = 0;
  let flySaid: fly.Stage | '' = '';
  /** Когда муху ждали в прошлый раз: между проверками — подходящее время для fly.due. */
  let flyCheck = Date.now();
  /** «Босс идёт» (Ctrl+Alt+H или трей): окна спрятаны Rust'ом, кошка молчит и не затевает игр. */
  let bossed = false;
  /** Когда заблокировали экран (Win+L); 0 — не заблокирован. */
  let lockedAt = 0;
  /** До этих пор простой после разблокировки не считается «отошёл». */
  let graceUntil = 0;
  let rest: AnimName = 'sit';
  let restUntil = 0;
  /** Поза сна выбирается при засыпании и держится до пробуждения. */
  let sleepPose: AnimName | null = null;
  let groomUntil = 0;
  let eatUntil = 0;
  /** Мониторы и окна-насесты; null — Rust их не дал (не Windows или ошибка), кошка стоит, где поставили. */
  let world: roam.World | null = null;
  /** Когда курсор последний раз был на мониторе (roam.monitorKey → Date.now()): на погасший кошка не ходит. */
  const seen: Record<string, number> = {};
  let pet: roam.Pet | null = null;
  /** Лазерная точка, физ. px рабочего стола; null — лазер выключен. */
  let dot: roam.Dot | null = null;
  /** Когда точка зажглась; охота — только через DOT_NOTICE_MS. */
  let dotSince = 0;
  /** На прошлом шаге охотилась: бросила — снять охоту один раз. */
  let hunted = false;
  /** Врезалась — до этих пор ошалело стоит со звёздочками. */
  let bonkUntil = 0;
  /** Галочка «Охотник» и где бегает мышь. */
  let hunterOn = false;
  let hunterArea: HunterArea = 'taskbar';
  /** Погоня за мышью; null — мыши нет. */
  let hunt: mouse.Chase | null = null;
  /** Когда пустить следующую мышь; кошка занята — мышь подождёт, пока освободится. */
  let nextHunt = 0;
  /** Мышь вызвана из трея dev-сборки: выбегает, как только кошка дома и не спит, — без ожидания безделья. */
  let huntNow = false;
  /** Галочка «Клубок»; игра с ним (null — нет); когда вынести следующий; вызван из трея dev-сборки. */
  let yarnOn = false;
  let game: yarn.Game | null = null;
  let nextYarn = 0;
  let yarnNow = false;
  /** Режим из настроек: месть — только в «Шалостях». */
  let mode = 'calm';
  /** Обида и перезарядка мести (revenge.ts); сама месть (null — нет); лужа на экране; месть из трея dev-сборки. */
  let grudge = revenge.fresh();
  let payback: revenge.Mission | null = null;
  let puddle: revenge.Puddle | null = null;
  let revengeNow = false;
  /** Лоток (litter.ts): что в нём; поход (null — нет); когда следующий; поход из трея dev-сборки. */
  let box = litter.freshBox();
  let potty: litter.Visit | null = null;
  let nextPotty = 0;
  let pottyNow = false;
  /** Подарок на 100 дней (gift.ts): дарила ли и где лежит; сценка (null — нет); упал; подарок из трея dev-сборки. */
  let present = gift.fresh();
  let giving: gift.Visit | null = null;
  let giftFall = false;
  let giftNow = false;
  let lastGift = '';
  /** Самая важная программа дня по трекеру: спрашиваем, только пока кошка в обиде. */
  let topApp: string | null = null;
  let lastPuddle = '';
  /** Верхние кромки рамок внутри окон — полки для мыши на весь экран. */
  let shelves: roam.Ledge[] = [];
  let lastShelves = 0;
  let lastMouse = '';
  let lickUntil = 0;
  /** Вернулась из-за края — умывается, когда дойдёт до места. */
  let groomOnArrival = false;
  let surveying = false;
  let lastStep = Date.now();
  let lastMove = Date.now();
  let lastWorld = 0;
  let lastSave = 0;
  let lastMask = '';
  let lastPlace = '';
  let timer: ReturnType<typeof setTimeout>;

  /** Сутки сменились: вчерашний срез — запись в дневник, новый день — с текущей статистики. */
  function turnPage(now: number) {
    const key = chatter.dayKey(new Date(now));
    if (!today || today.key === key) return;
    const done = diary.facts(today, stats);
    if (diary.worth(done)) pages = diary.push(pages, done);
    today = diary.begin(key, stats);
    persist(now);
  }

  function persist(now: number) {
    if (frozen) return;
    lastSave = now;
    store.set('belly', save(belly));
    store.set('sleep', sleepy.save(nap));
    store.set('stats', tally.save(stats));
    if (today) store.set('day', diary.save(today));
    store.set('diary', diary.saveList(pages));
    store.set('awards', awards.save(prize));
    store.set('revenge', revenge.save(grudge));
    store.set('growth', growing.save(growth));
    store.set('talk', chatter.save(talk));
    if (pet) store.set('spot', JSON.stringify(roam.spotOf(pet)));
    // окно-опору не храним: после перезапуска у окон другие hwnd — вещь найдёт рамку по точке
    if (bowlPlace) store.set('bowl', JSON.stringify({ x: Math.round(bowlPlace.x), y: Math.round(bowlPlace.y) }));
    if (bedPlace) store.set('bed', JSON.stringify({ x: Math.round(bedPlace.x), y: Math.round(bedPlace.y) }));
    // у лотка рядом с местом — что в нём; места нет (стоит по умолчанию) — только содержимое
    store.set('litter', JSON.stringify({ ...(litterPlace && { x: Math.round(litterPlace.x), y: Math.round(litterPlace.y) }), ...box }));
    store.set('gift', gift.save(present));
  }

  /** Где стоит вещь — в координаты окна для place_pet; мира нет — null, окно стоит, где стояло. */
  function windowAt(t: roam.Thing | null): { x: number | null; bottom: number | null } {
    return t ? { x: Math.round(t.x), bottom: Math.round(t.y) } : { x: null, bottom: null };
  }

  /** Вещь упала, а не уехала с окном: опустилась и стоит уже не на своём окне. */
  const fell = (was: roam.Place, now: roam.Thing): boolean =>
    now.y > was.y + 1 && !(was.hwnd != null && was.hwnd === now.hwnd);

  /** Мир сменился: вещи на рамках едут за окнами, а без окна под собой падают ниже. */
  function resettle() {
    if (!world) return;
    const bowl = bowlPlace && roam.bowlAt(world, bowlPlace);
    if (bowlPlace && bowl) [bowlFall, bowlPlace] = [bowlFall || fell(bowlPlace, bowl), bowl];
    const bed = bedPlace && roam.bedAt(world, bedPlace);
    if (bedPlace && bed) [bedFall, bedPlace] = [bedFall || fell(bedPlace, bed), bed];
    const tray = litterPlace && roam.litterAt(world, litterPlace);
    if (litterPlace && tray) [litterFall, litterPlace] = [litterFall || fell(litterPlace, tray), tray];
    const prey = present.place && gift.lying(present) ? roam.giftAt(world, present.place) : null;
    if (present.place && prey) [giftFall, present] = [giftFall || fell(present.place, prey), gift.moved(present, prey)];
  }

  /**
   * Окно миски рисует корм: запас кормушки (виден и при выключенной) и насыпанное, пока кошка идёт есть.
   * И встаёт, куда его поставили: место считаем здесь, тут же, где кошка к нему ходит.
   */
  function tellBowl() {
    const portions = belly.feeder + (mealPending ? 1 : 0);
    const at = windowAt(world && roam.bowlAt(world, bowlPlace));
    const fall = bowlFall;
    bowlFall = false;
    const key = `${portions} ${at.x} ${at.bottom}`;
    if (key === lastBowl) return;
    lastBowl = key;
    emitTo('bowl', 'bowl', { portions, ...at, fall }).catch(console.error);
  }

  /** Окно лежака: выключен — пустое и сквозное; включён — там, где поставили. */
  function tellBed() {
    const at = windowAt(world && roam.bedAt(world, bedPlace));
    const fall = bedFall;
    bedFall = false;
    const key = `${bedOn} ${at.x} ${at.bottom}`;
    if (key === lastBed) return;
    lastBed = key;
    emitTo('bed', 'bed', { on: bedOn, ...at, fall }).catch(console.error);
  }

  /** Окно лотка: как у лежака, и ещё что в нём — комочки и возраст наполнителя. */
  function tellLitter() {
    const at = windowAt(world && roam.litterAt(world, litterPlace));
    const fall = litterFall;
    litterFall = false;
    const wear = litter.wear(box);
    const key = `${litterOn} ${at.x} ${at.bottom} ${box.clumps} ${wear}`;
    if (key === lastLitter) return;
    lastLitter = key;
    emitTo('litter', 'litter', { on: litterOn, ...at, fall, clumps: box.clumps, wear }).catch(console.error);
  }

  /** Окно подарка: лежит — там, где положила или куда перетащили; принят — трофей; нет — пустое и сквозное. */
  function tellGift() {
    const on = gift.lying(present);
    const at = windowAt(world && on ? roam.giftAt(world, present.place) : null);
    const fall = giftFall;
    giftFall = false;
    const kept = present.state === 'kept';
    const key = `${on} ${at.x} ${at.bottom} ${kept}`;
    if (key === lastGift) return;
    lastGift = key;
    emitTo('gift', 'gift', { on, ...at, fall, kept }).catch(console.error);
  }

  /** Миску, лежак, лоток или подарок перетащили и бросили: падает на ближайшую рамку окна под собой или на пол. */
  function putDown(thing: 'bowl' | 'bed' | 'litter' | 'gift', x: number, bottom: number) {
    const settle = thing === 'bowl' ? roam.bowlAt : thing === 'bed' ? roam.bedAt : thing === 'litter' ? roam.litterAt : roam.giftAt;
    const place = world && settle(world, { x, y: bottom });
    if (place) {
      // окно вещи осталось там, где отпустили: оттуда и падает
      if (thing === 'bowl') [bowlPlace, bowlFall] = [place, true];
      else if (thing === 'bed') [bedPlace, bedFall] = [place, true];
      else if (thing === 'litter') [litterPlace, litterFall] = [place, true];
      else [present, giftFall] = [gift.moved(present, place), true];
      persist(Date.now());
    }
    // бросили туда же, откуда взяли, — ключ не сменился, а окно надо вернуть на опору
    lastBowl = lastBed = lastLitter = lastGift = '';
    render();
  }

  /** Мира нет (не Windows, экран блокировки) — миска нарисована в кадре кошки, идти никуда не надо. */
  const atBowl = (): boolean => !pet || !world || roam.atBowl(pet, world, bowlPlace);

  /** К миске; у миски — мордой к ней, она справа. */
  function toBowl() {
    if (!pet || !world || pet.move === 'out' || away() || pet.hunt || busy()) return;
    const b = roam.bowlSpot(world, bowlPlace);
    if (!b) return;
    if (roam.atBowl(pet, world, bowlPlace)) pet = { ...pet, facing: -1 };
    else if (pet.goal?.surface !== b.surface || pet.goal.x !== b.x) pet = roam.goTo(pet, world, b);
  }

  /** Еда в миске: у миски — ест сразу, иначе сначала идёт к ней. */
  function serve(now: number) {
    if (atBowl()) {
      toBowl();
      meal(now);
    } else {
      mealPending = true;
      toBowl();
    }
  }

  /**
   * Клик по миске — в окне кошки (поза hungry) или в отдельном окне миски. ПКМ забирает порцию из запаса.
   * С кормушкой ЛКМ досыпает порцию (кошка съест её сама, когда проголодается), без неё — кормит сейчас,
   * и сытой кошке не насыпают.
   */
  function bowlClick(button: number, now: number) {
    if (button === 2) {
      belly = takeOut(belly);
    } else if (feederOn) {
      belly = refill(belly);
      stats.fed++;
    } else {
      if (mealPending) return;
      const fed = feedBowl(belly);
      if (fed === belly) return;
      belly = fed;
      stats.fed++;
      serve(now);
    }
    persist(now);
    render();
  }

  function pick(options: [AnimName, number][]): AnimName {
    let r = Math.random() * options.reduce((sum, [, w]) => sum + w, 0);
    for (const [name, w] of options) if ((r -= w) < 0) return name;
    return options[0][0];
  }

  /** Поела — потом умывается. */
  function meal(now: number) {
    eatUntil = now + EAT_MS;
    groomUntil = eatUntil + GROOM_MS;
  }

  /** Кошке нечего делать на экране: ушла за едой, сбежала, досыпает в обиде или у человека созвон. */
  function away(): boolean {
    return belly.gone || belly.away > 0 || sleepy.mood(nap) === 'away' || onCall();
  }

  /**
   * У человека созвон: кошка за краем, молчит, не играет и не мстит — чтобы не спалить его на
   * демонстрации экрана. Сон и голод идут своим чередом: спящая уходит и досыпает там же.
   */
  function onCall(): boolean {
    return calls.onCall(hide);
  }

  /** Вернулась из-за края — выспавшейся или сытой, всё равно сначала умывается. */
  function comeBack(now: number) {
    // поела или простила, а созвон ещё идёт — выйдет, когда кончится (live: !away())
    if (onCall()) return;
    if (pet && world) {
      pet = roam.enter(pet, world);
      groomOnArrival = true;
    } else groomUntil = now + GROOM_MS;
  }

  /**
   * Идёт видео: сеанс засчитан или ещё копится (movie.START_MS). Уже в эти первые секунды не бродит
   * и не играет — иначе после перезапуска успевала уйти на другой монитор и шла обратно.
   */
  function filming(): boolean {
    return film.active || !!senses?.media?.watching;
  }

  /** Перебраться на другое место: посидеть у края пола или на окне, поспать — лучше на окне, а есть лежак — в нём. */
  function wander(kind: 'rest' | 'sleep') {
    if (!pet || !world || pet.move === 'out' || away() || pet.hunt || filming() || busy()) return;
    const bed = kind === 'sleep' && bedOn && Math.random() < BED_SLEEP ? roam.bedAt(world, bedPlace) : null;
    bedBound = bed !== null;
    const spot = bed ? { surface: bed.surface, x: bed.x } : roam.pickSpot(world, pet, kind, Math.random, roam.lived(world, seen, Date.now()));
    pet = roam.goTo(pet, world, spot);
  }

  /** Сидит на мониторе, куда человек давно не смотрел: скорее всего, он выключен. */
  function strayed(): boolean {
    if (!pet || !world) return false;
    const m = roam.monitorOf(world, pet);
    return !!m && !roam.lived(world, seen, Date.now()).includes(world.monitors.indexOf(m));
  }

  /** Смотрит кино: идёт в угол у края монитора с фильмом; уже там — сидит. */
  function toSeat() {
    if (!pet || !world || pet.move === 'out' || pet.hunt || bedBound) return;
    filmScreen = movie.screen(world, pet, filmScreen);
    const g = movie.seat(world, pet, filmScreen);
    if (movie.seated(pet, g)) return;
    if (pet.goal?.surface !== g.surface || pet.goal.x !== g.x) pet = roam.goTo(pet, world, g);
  }

  /**
   * Фильм по сигналу из Rust: сеанс начался — молчит и садится в угол; заскучала — уходит спать
   * за край; громкая сцена, пока она там от скуки, — выглядывает. Название уходит в сеть
   * только с галочкой «Подтягивать отзывы».
   */
  function watch(now: number, s: Senses) {
    const media = s.media;
    const dt = now - lastFilm;
    lastFilm = now;
    const title = media?.watching ? media.title : filmTitle;
    if (title !== filmTitle) {
      filmTitle = title;
      filmVerdict = 'unknown';
      if (film.active) askReviews(title);
    }
    const [next, event] = movie.step(film, dt, !!media?.watching, filmVerdict, Math.random);
    film = next;
    if (event === 'start') {
      stats.films++;
      if (speakingUntil) hush();
      askReviews(filmTitle);
    }
    if (event === 'doze' && sleepy.mood(nap) === 'awake' && !carried) {
      nap = sleepy.bored(nap);
      filmNap = true;
      persist(now);
    }
    if (event === 'end') {
      peekPending = false;
      filmScreen = null;
    }
    // уснула до фильма или в первые секунды сеанса — кино её будит, без обид; нудное — пусть спит.
    // На таймере фокуса — спит при любом кино
    if (film.active && filmVerdict !== 'dull' && sleepy.mood(nap) === 'asleep' && !carried && !pomodoro.focusing(focus)) {
      nap = sleepy.stir(nap);
      sleepPose = null;
      persist(now);
    }
    // зовёт только ушедшую за край: по пути туда громкая сцена её не разворачивает
    if (film.active && media?.loud && filmNap && sleepy.mood(nap) === 'away' && pet?.move === 'out') {
      nap = sleepy.call(nap);
      film = movie.awake(film);
      filmNap = false;
      peekPending = true;
      persist(now);
    }
  }

  /** Скучный ли фильм: только с галочкой отзывов и известным названием; ответ кэшируется. */
  function askReviews(title: string) {
    if (!reviewsOn || !title) return;
    const known = verdicts.get(title);
    if (known) return void (filmVerdict = known);
    invoke<Film | null>('film_reviews', { title })
      .then((f) => {
        const v = verdict(f);
        verdicts.set(title, v);
        if (filmTitle === title) filmVerdict = v;
      })
      .catch((e) => console.warn(e));
  }

  /**
   * Уснула с мыслью о лежаке: лежак сдвинули, окно под ним уехало или пропало — идёт к нему заново,
   * а не засыпает там, где цель потерялась. Лежак выключили — спит, где стоит.
   */
  function toBed() {
    if (!pet || !world || pet.move === 'out' || away() || pet.hunt || busy()) return;
    const b = bedOn ? roam.bedAt(world, bedPlace) : null;
    if (!b) return void (bedBound = false);
    if (roam.atBed(pet, world, bedPlace)) return;
    if (pet.goal?.surface !== b.surface || pet.goal.x !== b.x) pet = roam.goTo(pet, world, { surface: b.surface, x: b.x });
  }

  /**
   * Побудка кликом или тряской курсора. Бодрую не касается — тогда false, и клик просто гладит.
   * Выспавшаяся проснулась и умывается; не доспавшая вялая, злая, а на третий раз уходит за край.
   */
  function disturb(now: number): boolean {
    // на таймере фокуса не будят ни клик, ни тряска, ни руки — и обид за это нет
    if (pomodoro.focusing(focus)) return false;
    const [next, result] = sleepy.poke(nap);
    if (!result) return false;
    nap = next;
    sleepPose = null;
    // не доспавшая может затаить обиду (revenge.ts: шанс зависит от того, как разбудили)
    grudge = revenge.provoke(grudge, result, now, Math.random, mode, trait().touchy);
    stats.woken++;
    if (result === 'wake') groomUntil = now + GROOM_MS;
    // 'leave' — за край она уйдёт сама: это заметит live()
    persist(now);
    return true;
  }

  /** Во сколько раз быстрее копится усталость. */
  /** Во сколько раз быстрее устаёт: от батареи и в «не свои» по хронотипу часы. */
  function tired(): number {
    return (senses?.battery ? BATTERY_TIRED : 1) * chrono.tired(stats.hours, new Date().getHours());
  }

  /** Голод и сон живут по времени работы программы; их события превращаются в позы. */
  function live(now: number) {
    const dt = now - lastStep;
    lastStep = now;
    const [next, event] = step(belly, dt);
    belly = next;
    if (event === 'gone') stats.runaways++;
    stats = tally.tick(stats, dt, !away(), film.active, humanIdle ? -1 : new Date(now).getHours());
    if (today) today = diary.tick(today, dt, { app: senses?.app, human: !humanIdle, asleep: nap.asleep });
    turnPage(now);
    // кормушка сработала посреди фокуса — поест на перерыве, а пока спит
    if (event === 'eat' && pomodoro.focusing(focus)) mealPending = true;
    else if (event === 'eat') serve(now);
    // поела где-то там
    if (event === 'return') comeBack(now);

    // пока смотрит кино, сама не устаёт: когда уснуть на фильме, решает movie.ts. Видео уже
    // играет, но сеанс ещё не засчитан (START_MS) — тоже: иначе успеет уйти спать на лежак
    const watching = filming() && sleepy.mood(nap) === 'awake';
    // на таймере фокуса засыпает, как только освободится, и спит до конца (pomodoro.ts); ушедшая
    // за край досыпает по своим часам и, вернувшись, засыпает уже на таймере
    const timed = pomodoro.focusing(focus) && sleepy.mood(nap) !== 'away';
    if (timed && !carried && !busy() && !mouse.owns(hunt) && !yarn.owns(game) && now >= eatUntil) nap = pomodoro.lull(nap);
    const [rested, mood] = watching ? [nap, null] : timed ? [pomodoro.doze(nap, dt), null] : sleepy.step(nap, dt, humanIdle, tired(), trait().sleepy);
    nap = rested;
    if (mood === 'sleep') {
      stats.naps++;
      sleepPose = pick(SLEEPS);
      wander('sleep');
    }
    if (mood === 'doze') sleepPose = pick(DOZES);
    // полный сон — не меньше NAP_MS, по кошачьим меркам долго: проснувшись, умывается
    if (mood === 'wake') groomUntil = now + GROOM_MS;
    if (mood === 'return') {
      comeBack(now);
      // выспалась за краем посреди фильма — досматривает
      if (filmNap) film = movie.awake(film);
      filmNap = false;
    }

    // фокус кончился — просыпается выспавшейся и потягивается; облачко «Перерыв!» — в breakTime()
    const [clock, ring] = pomodoro.step(focus, now);
    focus = clock;
    if (ring === 'done') {
      if (sleepy.mood(nap) === 'asleep') nap = sleepy.stir(nap);
      sleepPose = null;
      stats.focuses++;
      invoke('set_focus', { until: 0 }).catch(console.error);
    }
    // корм из кормушки дождался перерыва: у миски ест сразу, иначе дойдёт сама (move)
    if (ring === 'stretched' && mealPending && atBowl()) {
      mealPending = false;
      meal(now);
    }

    // Уход и возвращение сверяются с голодом и сном каждый кадр, а не только по событиям:
    // так их не потерять ни при запуске, ни при побудке, ни при «Новом котике».
    // несомую мир не двигает: уйти за край или к миске она успеет, когда отпустят
    if (pet && world && !carried && !mouse.owns(hunt) && !yarn.owns(game) && !busy()) {
      if (!away()) {
        if (pet.move === 'out') comeBack(now);
      } else if (pet.move !== 'out' && pet.exit === 0) pet = roam.leave(pet, world);
      // на полосе заголовка только спят: проснулась — слезает
      if (roam.onStrip(pet) && pet.move === 'still' && sleepy.mood(nap) !== 'asleep') wander('rest');
      // голодная и бодрая — идёт к миске; спящую голод не будит
      if ((isHungry(belly) || mealPending) && sleepy.mood(nap) === 'awake') toBowl();
      // в кино — когда поела и умылась: в пути «eat» не показать, а корм уже съеден
      else if (film.active && sleepy.mood(nap) === 'awake' && !away() && now >= groomUntil) toSeat();
      // разбудили — про лежак забыла до следующего сна
      if (bedBound && sleepy.mood(nap) === 'asleep') toBed();
      else bedBound = false;
    }

    if (event || mood || ring === 'done' || now - lastSave >= SAVE_MS) persist(now);
  }

  /**
   * Охотится, пока светит лазер, — бодрая и дома. Спящую точка не будит, едящую не отвлекает:
   * лазер — игра, а не побудка.
   */
  function hunting(now: number): boolean {
    return (
      dot !== null &&
      now - dotSince >= DOT_NOTICE_MS &&
      !!pet &&
      !!world &&
      pet.move !== 'out' &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil
    );
  }

  /** Гоняться за мышью можно: охотник включён, кошка дома, бодрая, не ест, не в руках и лазер не светит. */
  function canHunt(now: number): boolean {
    return (
      hunterOn &&
      !onTimer() &&
      !bossed &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !filming() &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil &&
      !busy()
    );
  }

  /** Играть с клубком можно: как с мышью, только ещё и сытой — голодная идёт к миске, а не играет. */
  function canYarn(now: number): boolean {
    return (
      yarnOn &&
      !onTimer() &&
      !bossed &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !filming() &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil &&
      !isHungry(belly) &&
      !mealPending &&
      !busy()
    );
  }

  /**
   * Мстить можно: дома, стоит, ни с кем не играет, не в руках, лазер не светит, не ест и не голодна.
   * Злая или вялая спросонья — тоже: так даже понятнее, за что.
   */
  function canRevenge(now: number): boolean {
    const mood = sleepy.mood(nap);
    return (
      !onTimer() &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !away() &&
      pet.move === 'still' &&
      !pet.hunt &&
      !roam.onStrip(pet) &&
      !hunt &&
      !game &&
      !litter.owns(potty) &&
      !gift.owns(giving) &&
      // кино смотрят вместе: на сеансе не мстит
      !filming() &&
      now >= eatUntil &&
      !isHungry(belly) &&
      !mealPending &&
      (mood === 'awake' || mood === 'angry' || mood === 'groggy')
    );
  }

  /** В лоток можно: включён, дома, бодрая, не ест, не в руках, лазер не светит, без кино, мести и игр. */
  function canPotty(now: number): boolean {
    return (
      litterOn &&
      !onTimer() &&
      !bossed &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !filming() &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil &&
      !revenge.owns(payback) &&
      !gift.owns(giving) &&
      !hunt &&
      !game
    );
  }

  /**
   * Сценка подарка идёт: дома, бодрая, не ест, не в руках, лазер не светит, без кино, мести, лотка
   * и игр, мешать можно (не «не мешать», не созвон, не босс). Перестало так быть — сценку бросает.
   */
  function canGift(now: number): boolean {
    return (
      !bossed &&
      !!pet &&
      !!world &&
      !carried &&
      !holding &&
      dot === null &&
      !pet.hunt &&
      !filming() &&
      !away() &&
      sleepy.mood(nap) === 'awake' &&
      now >= eatUntil &&
      !revenge.owns(payback) &&
      !litter.owns(potty) &&
      !mouse.owns(hunt) &&
      !yarn.owns(game) &&
      !onTimer() &&
      unbothered()
    );
  }

  /** Подарок дарить пора: раз за жизнь, с GIFT_AT вместе (или из трея), человек не печатает — на паузе или отошёл. */
  function giftTime(now: number): boolean {
    if (!pet || !senses || giving || speakingUntil || flyAt || !(giftNow || gift.due(present, stats.together)) || !canGift(now)) return false;
    if (giftNow) return pet.move !== 'out';
    return idle(now) && !senses.typing && (moment(now, senses).pause || humanIdle);
  }

  /** Убрали подарок, и она уже идёт за ним, уносит или ест: меню подарка ничего не меняет. */
  const taking = (): boolean => gift.owns(giving) && (giving!.phase === 'take' || giving!.phase === 'carry' || giving!.phase === 'eat');

  /** Кошкой правит своё дело — месть, лоток или подарок: к миске, в лежак и играть пойдёт потом. */
  const busy = (): boolean => revenge.owns(payback) || litter.owns(potty) || gift.owns(giving);
  /** Фокус или потягушки после него: ничего не затевает — ни игр, ни шалостей, ни лотка. */
  const onTimer = (): boolean => !!focus && focus.phase !== 'break';

  /** Можно ли мстить сейчас: «Шалости» (или трей dev-сборки), «не мешать» нет, созвона нет. */
  const gate = (): revenge.Gate => ({ mode: revengeNow ? 'pranks' : mode, quiet: quietNow(), call: senses?.call });
  /** Мешать человеку можно вообще: лужа и начатая месть живут, только пока так. */
  const unbothered = (): boolean => revenge.allowed({ mode: 'pranks', quiet: quietNow(), call: senses?.call });
  /** Почему не мешать: спрятанная от босса кошка тоже не мешает. */
  const quietNow = (): string | undefined => (bossed ? 'boss' : senses?.quiet);

  /** Пустить мышь: кошка стоит без дела — не голодна, не умывается, не идёт спать в лежак. */
  function readyToHunt(now: number): boolean {
    return canHunt(now) && idle(now);
  }

  /** Вынести клубок: так же без дела, и мыши нет — у них одно окно. */
  function readyToYarn(now: number): boolean {
    return canYarn(now) && idle(now) && !hunt;
  }

  /** Стоит без дела: не голодна, не умывается, не идёт спать в лежак, не гладят. */
  function idle(now: number): boolean {
    return (
      pet!.move === 'still' &&
      !pet!.hunt &&
      !roam.onStrip(pet!) &&
      !isHungry(belly) &&
      !mealPending &&
      !bedBound &&
      now >= groomUntil &&
      now >= pettedUntil &&
      now >= poseUntil &&
      now >= crunchUntil &&
      now >= cakeUntil &&
      !flyAt &&
      !growAt
    );
  }

  // игривая зовёт играть чаще, ленивая — реже (breed.ts)
  const huntGap = () => playGap(HUNT_MIN + Math.random() * (HUNT_MAX - HUNT_MIN), trait().playful);
  const yarnGap = () => playGap(YARN_MIN + Math.random() * (YARN_MAX - YARN_MIN), trait().playful);

  /** Мышь или клубок в окно "mouse": где и что делает; null — спрятать. Шлём только перемены. */
  function tellMouse() {
    const v = mouse.view(hunt) ?? yarn.view(game, world);
    const frame = v && 'frame' in v ? v.frame : undefined;
    const at = v && { x: Math.round(v.x), bottom: Math.round(v.y), anim: v.anim, facing: v.facing, frame };
    const key = at ? `${at.x} ${at.bottom} ${at.anim} ${at.facing} ${frame}` : '';
    if (key === lastMouse) return;
    lastMouse = key;
    emitTo('mouse', 'mouse', at).catch(console.error);
  }

  /** Лужа в окно "puddle": середина, низ и кадр; null — пусто. Шлём только перемены. */
  function tellPuddle(now: number) {
    const v = revenge.view(puddle, now);
    const key = v ? `${v.x} ${v.bottom} ${v.frame}` : '';
    if (key === lastPuddle) return;
    lastPuddle = key;
    emitTo('puddle', 'puddle', v).catch(console.error);
  }

  /** Поза на сейчас; null — кошки на экране нет. */
  function choose(now: number): AnimName | null {
    if (carried) return 'carried';
    if (pet?.hunt) {
      if (now < bonkUntil || pet.hunt.mode === 'bonk') return 'bonk';
      if (pet.hunt.mode === 'skid') return 'skid';
      if (roam.isRunning(pet)) return 'run';
      if (pet.hunt.mode === 'crouch' && pet.move === 'still') return 'crouch';
      // прыжок на точку, падение с карниза — те же позы, что в пути; стоит в мёртвой зоне — следит
      return pet.move === 'still' ? 'stand' : pet.move === 'out' ? null : pet.move;
    }
    // месть: шипит, идёт, присаживается над лужей, довольна, уходит вразвалку
    if (pet && payback && revenge.owns(payback)) return revenge.pose(payback, pet);
    // лоток: идёт, сидит, закапывает, носится
    if (pet && potty && litter.owns(potty)) return litter.pose(potty, pet);
    // подарок: несёт мышь, зовёт посмотреть, сидит рядом, мурлычет; за краем её не видно
    if (pet && giving && gift.owns(giving)) return gift.pose(giving, pet, now);
    // за мышью за край — бегом, обратно — шагом; за краем её не видно
    if (pet && hunt && mouse.owns(hunt)) {
      if (pet.move === 'out') return null;
      if (pet.move === 'still') return 'stand';
      return hunt.phase === 'follow' && pet.move === 'walk' ? 'run' : pet.move;
    }
    // с клубком: припадает перед ударом, за укатившимся — бегом
    if (pet && game && yarn.owns(game)) {
      if (pet.move === 'out') return null;
      if (pet.move === 'still') return yarn.pose(game);
      return yarn.running(game) && pet.move === 'walk' ? 'run' : pet.move;
    }
    // в пути — только ходьба, прыжок или падение, чем бы ни была занята голова
    if (pet && pet.move !== 'still' && pet.move !== 'out') return pet.move;
    if (belly.gone || belly.away > 0) return null;
    // на созвоне за краем не видно ничего, даже «з-з-з»
    if (onCall()) return null;
    const mood = sleepy.mood(nap);
    // «з-з-з» — только из-за края; пока не дошла, идёт
    if (mood === 'away') return pet && pet.move !== 'out' ? 'walk' : 'zzz';
    // фокус кончился: потягивается, прежде чем что-то ещё
    if (focus?.phase === 'stretch') return 'stretch';
    if (now < pettedUntil) return 'petted';
    if (now < poseUntil) return 'pose';
    if (now < crunchUntil) return 'crunch';
    if (now < cakeUntil) return 'cake';
    // момент роста — сидит и «вытягивается» на месте
    if (growAt) return 'sit';
    if (flyAt) {
      const s = fly.stage(flyAt, now);
      if (s !== 'done') return fly.pose(s);
    }
    if (now < lickUntil) return 'lick';
    if (now < eatUntil) return 'eat';
    if (mood === 'angry' || mood === 'groggy') return mood;
    if (mood === 'asleep') {
      if (bedOn && pet && world && roam.atBed(pet, world, bedPlace)) return 'bed';
      // на таймере — только калачиком: к нему render() приставит песочные часы
      return (pet && roam.onStrip(pet)) || pomodoro.focusing(focus) ? 'sleep' : (sleepPose ??= pick(SLEEPS));
    }
    // проснулась голодной — сначала к миске, умыться успеет потом; не дошла — сидит и ждёт пути
    if (isHungry(belly) || mealPending) return atBowl() ? 'hungry' : 'sit';
    if (now < groomUntil) return 'groom';
    if (now >= restUntil) {
      rest = pick(RESTS);
      restUntil = now + REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
      // с погасшего монитора — домой, не дожидаясь случая
      if (Math.random() < WANDER || strayed()) wander('rest');
      if (pet?.move === 'walk') return 'walk';
    }
    return rest;
  }

  /**
   * Окно питомца — туда, где кошка: низ окна по линии, которой поза стоит на опоре.
   * «З-з-з» выглядывают из-за того края, за которым она спит, — на экране только буквы.
   */
  function place() {
    if (!pet || !world || carried) return;
    const m = roam.monitorOf(world, pet);
    if (!m) return;
    const half = roam.side(m) / 2;
    const cell = roam.side(m) / SIZE;
    let x = pet.x;
    // у миски кошка стоит над миской: в hungry и eat миска в кадре на BOWL_AT и совпадает с окном
    // миски сама, в позах без миски кошка отходит и сидит слева от неё
    if (roam.atBowl(pet, world, bowlPlace)) x += (BOWL_AT - (bowlLeft(frame) ?? BOWL_X)) * cell;
    if (anim === 'zzz') x = pet.exit < 0 ? m.work.left + half - Z_LEFT * cell : m.work.right + half - (Z_RIGHT + 1) * cell;
    const bottom = pet.y + (SIZE - 1 - (anim ? ground(anim) : SIZE - 1)) * cell;
    const at = { x: Math.round(x), bottom: Math.round(bottom) };
    const was = head;
    head = crown(at, cell);
    if (speakingUntil && head && (head.x !== was?.x || head.top !== was?.top)) invoke('bubble_at', head).catch(console.error);
    const key = `${at.x},${at.bottom}`;
    if (key === lastPlace) return;
    lastPlace = key;
    invoke('place_pet', at).catch(console.error);
  }

  /** Голову ищем в верхних строках силуэта: миска у лап в кадре середину не сдвинет. */
  const HEAD_ROWS = 8;

  /**
   * Макушка кошки в физ. px по окну с серединой `at.x` и низом `at.bottom`: над серединой
   * нарисованных клеток в верхних HEAD_ROWS строках. Пустой кадр — головы нет.
   */
  function crown(at: { x: number; bottom: number }, cell: number): { x: number; top: number } | null {
    const mask = hitMask(frame);
    const top = mask.findIndex((bits) => bits !== 0);
    if (top < 0) return null;
    let lo = SIZE;
    let hi = -1;
    for (const bits of mask.slice(top, top + HEAD_ROWS)) {
      for (let x = 0; x < SIZE; x++) {
        if (!(bits & (1 << x))) continue;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return {
      x: Math.round(at.x - (SIZE * cell) / 2 + ((lo + hi + 1) / 2) * cell),
      top: Math.round(at.bottom - SIZE * cell + top * cell),
    };
  }

  /** Кошке есть когда поговорить: дома, бодрая, стоит, ни с кем не занята. */
  function free(): boolean {
    return (
      !!pet &&
      !!world &&
      !!anim &&
      !carried &&
      !holding &&
      !pet.hunt &&
      !mouse.owns(hunt) &&
      !yarn.owns(game) &&
      !busy() &&
      pet.move === 'still' &&
      !away() &&
      sleepy.mood(nap) === 'awake'
    );
  }

  /** Облачко: убрать, когда пора или кошке стало не до него; сказать новое, когда chatter решит. */
  function chat(now: number) {
    if (speakingUntil) {
      if (now >= speakingUntil || (!free() && !forced)) hush();
      return;
    }
    // на таймере и до облачка «Перерыв!» молчит: и болтовня, и «есть хочу» ждут перерыва
    if (focus && !focus.offered) return;
    // своя реплика у мухи — chatter не перебивает
    if (frozen || !senses || !head || film.active || flyAt) return;
    askWiki(now);
    askNews(now);
    const [next, line] = chatter.say(talk, moment(now, senses), chatterLevel, Math.random, trait().talky);
    talk = next;
    if (line) speak(line.text, now, held && line.text === held.text ? held : null);
  }

  function moment(now: number, s: Senses): chatter.Moment {
    // вышедшее у своего — не посреди игры: подождёт паузы. Тему держит не список тем, а галочка
    const tell = held && !(held.link && s.game) ? held : null;
    return {
      now: new Date(now),
      pause: !s.idle && !s.typing && (s.quiet ?? 'no') === 'no',
      session: s.session_secs,
      today: s.active_today_secs,
      hungry: isHungry(belly) && !mealPending,
      free: free(),
      topics: tell?.link && !topics.includes(tell.topic) ? [...topics, tell.topic] : topics,
      name: petName,
      extra: tell ? { ...wikiFacts, [tell.topic]: [tell.text, ...(wikiFacts[tell.topic] ?? [])] } : wikiFacts,
    };
  }

  /**
   * Новость по темам: одна про запас. Сказали, тему сняли или новость устарела — берём следующую.
   * В рабочее время — только из рабочих тем: остальное chatter всё равно отложит до вечера.
   * На отдыхе и не в игре сначала спрашиваем, не вышло ли что у своего: патч игры, серия аниме.
   */
  function askNews(now: number) {
    const fresh = held && (!!held.link || topics.includes(held.topic)) && !talk.told.includes(held.text) && now / 1000 - held.date < NEWS_STALE_S;
    if (fresh) return;
    held = null;
    const work = chatter.isWork(new Date(now));
    const allowed = topics.filter((t) => !work || chatter.WORK_TOPICS.includes(t));
    const releases = releasesOn && !work && !senses?.game;
    if ((!allowed.length && !releases) || now < newsNext) return;
    newsNext = now + NEWS_RETRY_MS;
    (releases ? rel.pickRelease(invoke) : Promise.resolve(null)).then((r) => {
      if (r) {
        held = { topic: rel.releaseTopic(r), text: rel.releaseLine(r), date: Date.now() / 1000, source: rel.releaseSource(r), link: r.link };
        return;
      }
      if (!allowed.length) return;
      news.pickNews(invoke, allowed, talk.weights).then((item) => {
        const topic = TOPICS.find((t) => t === item?.topic);
        if (item && topic) held = { topic, text: news.newsLine(item), date: item.date, source: item.source };
      });
    });
  }

  /**
   * События дня из Википедии, раз в день (Rust кэширует ответ на диске). Тем не выбрано — в сеть
   * не ходим вовсе. Нет сети — молча живём на встроенном запасе и пробуем снова через час.
   */
  function askWiki(now: number) {
    const day = new Date(now).toDateString();
    if (!topics.length || day === wikiDay || now < wikiNext) return;
    wikiNext = now + WIKI_RETRY_MS;
    invoke<wiki.WikiEvent[]>('wiki_today')
      .then((events) => {
        wikiFacts = wiki.sort(events);
        wikiDay = day;
      })
      .catch((e) => console.warn(e));
  }

  /**
   * Сказать `text` на `ms`; `about` — это новость, под ней будут лайк/диз; с `link` — «Глянем»/«Мимо». Прежнее облачко
   * `say` убирает сам: отдельный hush перед ним — лишний и опасный, две async-команды приходят
   * в Rust в любом порядке, и поздний hush гасит только что показанное облачко. `act` — надпись
   * кнопки-действия под текстом (Bubble.svelte): нажали — придёт bubble-act.
   */
  function speak(text: string, now: number, about: { topic: Topic; source: string; link?: string } | null = null, ms = chatter.shownFor(text), act: string | null = null) {
    if (!head || bossed) return;
    speakingUntil = now + ms;
    voteFor = about && { topic: about.topic, source: about.source, link: about.link };
    invoke('say', { text, ...head, vote: !!about, link: !!about?.link, act }).catch(console.error);
    stats.said++;
    persist(now);
  }

  /**
   * «Сказать что-нибудь» из трея dev-сборки: облачко сразу, мимо паузы, сроков, сна и молчуна.
   * Реплику выбирает тот же chatter.say — видно то, что кошка сказала бы сама.
   */
  function sayNow() {
    if (frozen || !senses || !head || away()) return;
    const now = Date.now();
    const m = { ...moment(now, senses), pause: true, free: true };
    const [next, line] = chatter.say({ ...talk, spoke: 0, next: 0 }, m, 'often', Math.random);
    if (!line) return;
    talk = next;
    forced = true;
    speak(line.text, now);
  }

  /**
   * «Расскажи новость» из меню кошки (и из трея dev-сборки): свежая по любой из тем, мимо сроков
   * и рабочего времени — человек попросил сам. Тем нет или ленты ещё не скачаны — так и говорит,
   * чтобы было видно, что пункт сработал.
   */
  function newsNow() {
    if (frozen || !head || away()) return;
    const show = (text: string, about: { topic: Topic; source: string; link?: string } | null = null) => {
      forced = true;
      // после облачка — обычная тишина GAP_MS, чтобы следом не заговорила сама
      talk = { ...talk, spoke: Date.now() };
      speak(text, Date.now(), about);
    };
    const fromFeeds = () => {
      if (!topics.length) return show(t('Тем не выбрано — новостей не будет.', 'No topics chosen, so no news.'));
      news.pickNews(invoke, topics, talk.weights).then((item) => {
        const topic = TOPICS.find((t) => t === item?.topic);
        if (!item || !topic) return show(t('Новостей пока нет: ленты ещё качаются.', 'No news yet: the feeds are still downloading.'));
        show(news.newsLine(item), { topic, source: item.source });
      });
    };
    // патчи и серии — только на отдыхе; в игре Rust ответит null сам
    if (!releasesOn || chatter.isWork(new Date())) return fromFeeds();
    rel.pickRelease(invoke).then((r) => {
      if (!r) return fromFeeds();
      show(rel.releaseLine(r), { topic: rel.releaseTopic(r), source: rel.releaseSource(r), link: r.link });
    });
  }

  /**
   * Муха прилетает очень редко: человек на паузе, мешать можно, кошка свободна и стоит без дела,
   * облачка нет. Время, когда так не было, в шансы не идёт.
   */
  function flyBy(now: number) {
    const dt = now - flyCheck;
    flyCheck = now;
    if (flyAt || bossed || speakingUntil || film.active || onTimer() || !senses || !free() || !idle(now) || !unbothered()) return;
    if (moment(now, senses).pause && fly.due(lastFly, now, dt, Math.random)) startFly(now);
  }

  function startFly(now: number) {
    flyAt = lastFly = now;
    flySaid = '';
  }

  /** Стадии сценки и облачка к ним. Взяли на руки, погладили, позвали — сценка кончилась. */
  function buzz(now: number) {
    if (!flyAt) return;
    const s = fly.stage(flyAt, now);
    if (s === 'done' || bossed || !free() || now < pettedUntil) {
      // облачко «Срочно!» без новости — бессмыслица: прервали — убрать
      if (s !== 'done' && flySaid === 'urgent' && speakingUntil) hush();
      flyAt = 0;
      flySaid = '';
      return;
    }
    if (s === flySaid) return;
    flySaid = s;
    const text = fly.line(s, petName);
    if (!text) return;
    forced = true;
    // после новости — обычная тишина, чтобы следом не заговорила сама
    talk = { ...talk, spoke: now };
    // облачко держится всю стадию: «Срочно!» — до новости, новость — до конца сценки. С запасом
    // в секунду: иначе chat() успевает погасить «Срочно!» за миг до новости — и снова гонка hush/say
    speak(text, now, null, fly.ms(s) + 1000);
  }

  function hush() {
    speakingUntil = 0;
    forced = false;
    voteFor = null;
    invoke('hush').catch(console.error);
  }

  /** Облачко сценки подарка: держится, хоть кошка и занята; после него — обычная тишина. */
  function giftSay(text: string, now: number) {
    forced = true;
    talk = { ...talk, spoke: now };
    speak(text, now);
  }

  /** Что сценка подарка велела сделать в этот кадр (gift.Cue). */
  function presented(cue: gift.Cue, now: number) {
    if (!pet || !world) return;
    if (cue === 'put') {
      const at = gift.putAt(world, pet);
      const g = at && roam.giftAt(world, at);
      if (!g) return;
      present = gift.given(g);
      giftFall = false;
      persist(now);
      giftSay(gift.presentLine(), now);
    } else if (cue === 'took') {
      present = gift.remove();
      persist(now);
    } else if (cue === 'eat') {
      // за краем головы нет (speak ставит хвостик к макушке): облачко — у края, bubble.rs сам сдвинет его внутрь
      const m = roam.monitorOf(world, pet);
      if (!m || bossed) return;
      const text = gift.chompLine();
      const x = pet.exit < 0 ? m.work.left + 1 : m.work.right - 1;
      forced = true;
      talk = { ...talk, spoke: now };
      speakingUntil = now + chatter.shownFor(text);
      voteFor = null;
      invoke('say', { text, x: Math.round(x), top: Math.round(pet.y - roam.side(m) * 0.6), vote: false }).catch(console.error);
      stats.said++;
    } else {
      // доела — спит за краем, как обиженная; вернётся сама через NAP_MS (live → comeBack)
      nap = sleepy.bored(nap);
      sleepPose = null;
      persist(now);
    }
  }

  /** Перечитать мониторы и окна. Пустой список (экран блокировки) — мира нет, кошка ждёт на месте. */
  async function survey() {
    if (surveying) return;
    surveying = true;
    lastWorld = Date.now();
    try {
      const w = await invoke<roam.World>('world');
      world = w.monitors.length ? w : null;
      const k = world ? roam.looked(world) : -1;
      if (k >= 0) seen[roam.monitorKey(world!.monitors[k])] = lastWorld;
      // полки внутри окон нужны только мыши на весь экран
      if (hunt && hunterArea === 'screen' && lastWorld - lastShelves >= SHELVES_MS) {
        lastShelves = lastWorld;
        shelves = await invoke<roam.Ledge[]>('shelves').catch((e) => (console.error(e), shelves));
      }
      // миска и лежак на рамках едут за окнами тем же шагом, что и кошка на насесте
      resettle();
      tellBowl();
      tellBed();
      tellLitter();
      tellGift();
    } catch (e) {
      console.error(e);
    } finally {
      surveying = false;
    }
  }

  /** Шаг по маршруту: идёт, прыгает, падает или едет на чужом окне — окно питомца следом. */
  function move() {
    const now = Date.now();
    const dt = now - lastMove;
    lastMove = now;
    if (!hunt && !game && pet && world && now >= nextHunt && (huntNow ? canHunt(now) && pet.move !== 'out' : readyToHunt(now))) {
      hunt = mouse.start(mouse.arena(world, hunterArea, shelves), now, Math.random);
      stats.mice++;
      huntNow = false;
      lastShelves = 0;
    }
    if (!game && !hunt && pet && world && now >= nextYarn && (yarnNow ? canYarn(now) && pet.move !== 'out' : readyToYarn(now))) {
      const started = yarn.start(world, pet, now);
      // внешних краёв нет — клубок выносить неоткуда, попробует в следующий раз
      if (started) {
        [game, pet] = started;
        stats.yarns++;
      } else nextYarn = now + yarnGap();
      yarnNow = false;
    }
    // месть: обижена, перезарядка прошла, человек в самой важной программе дня (или ждать надоело)
    if (!payback && pet && world && canRevenge(now) && revenge.ready(grudge, now, gate(), !!topApp && senses?.app === topApp)) {
      const started = revenge.start(world, pet, senses?.app, now);
      if (started) {
        [payback, pet] = started;
        stats.revenges++;
        grudge = revenge.begin(grudge, now);
        revengeNow = false;
        persist(now);
      }
    }
    // лоток: раз в полтора-три часа, когда стоит без дела; из трея dev-сборки — как только свободна
    if (!potty && !payback && !hunt && !game && pet && world && now >= nextPotty && canPotty(now) && (pottyNow ? pet.move !== 'out' : idle(now))) {
      const started = litter.start(world, pet, litterPlace, now);
      if (started) [potty, pet] = started;
      else nextPotty = now + litter.gap(Math.random);
      pottyNow = false;
    }
    // подарок на 100 дней: раз за жизнь, в спокойную минуту; из трея dev-сборки — как только свободна
    if (!potty && !payback && !hunt && !game && pet && world && giftTime(now)) {
      const started = gift.start(world, pet, now);
      if (started) [giving, pet] = started;
      giftNow = false;
    }
    const was = pet && `${pet.move} ${pet.hunt?.mode}`;
    // мышь бегает и пока кошку несут: погоню это прерывает, но мышь удирает своим ходом
    let ruled = false;
    let event: mouse.HuntEvent | null = null;
    if (hunt && pet && world) {
      const arena = mouse.arena(world, hunterArea, shelves);
      if (mouse.owns(hunt) && !canHunt(now)) {
        hunt = mouse.bolt(hunt, arena, pet, Math.random);
        pet = roam.endChase(pet);
      }
      ruled = mouse.owns(hunt);
      let e: mouse.HuntEvent | null;
      let p: roam.Pet;
      [hunt, p, e] = mouse.tick(hunt, arena, pet, now, dt, Math.random);
      // прерванная погоня кошку не трогает: ею дальше правит приложение
      if (ruled) [pet, event] = [p, e];
      if (e === 'lick') {
        lickUntil = now + LICK_MS;
        stats.caught++;
      }
      if (hunt.phase === 'done') {
        hunt = null;
        nextHunt = now + huntGap();
      }
    }
    // клубок так же: прервали — докатывается сам, кошкой дальше правит приложение
    if (game && pet && world) {
      if (yarn.owns(game) && !canYarn(now)) game = yarn.drop(game, now);
      const playing = yarn.owns(game);
      let e: roam.RoamEvent | null;
      let p: roam.Pet;
      [game, p, e] = yarn.tick(game, world, pet, now, dt, Math.random);
      if (playing) [pet, event, ruled] = [p, e, true];
      if (game.phase === 'done') {
        game = null;
        nextYarn = now + yarnGap();
      }
    }
    // месть так же: взяли на руки, лазер, ушла, «не мешать» или созвон — бросает, кошкой правит приложение
    if (payback && pet && world) {
      if (revenge.owns(payback) && (carried || dot !== null || away() || !unbothered() || onTimer())) payback = revenge.drop(payback);
      const acting = revenge.owns(payback);
      let e: roam.RoamEvent | null;
      let p: roam.Pet;
      let spilt: revenge.Puddle | null;
      [payback, p, e, spilt] = revenge.tick(payback, world, pet, now, dt, Math.random);
      if (acting) [pet, event, ruled] = [p, e, true];
      if (spilt) {
        puddle = spilt;
        stats.puddles++;
      }
      if (payback.phase === 'done') payback = null;
    }
    // лоток так же: взяли на руки, лазер, уснула, ушла или лоток выключили — бросает
    if (potty && pet && world) {
      if (litter.owns(potty) && !canPotty(now)) potty = litter.drop(potty);
      const going = litter.owns(potty);
      const phase = potty.phase;
      let e: roam.RoamEvent | null;
      let p: roam.Pet;
      [potty, p, e] = litter.tick(potty, world, pet, litterPlace, now, dt);
      if (going) [pet, event, ruled] = [p, e, true];
      // закопала — в лотке ещё комочек
      if (phase === 'dig' && potty.phase === 'leave') {
        box = litter.used(box);
        if (today) today = diary.potty(today);
        persist(now);
      }
      if (potty.phase === 'done') {
        potty = null;
        nextPotty = now + litter.gap(Math.random);
      }
    }
    // подарок так же: взяли на руки, лазер, кино, «не мешать», созвон — бросает. Уносила мышь — обиделась
    // всё равно: спать уйдёт за край обычным путём
    if (giving && pet && world) {
      if (gift.owns(giving) && !canGift(now)) {
        if (giving.phase === 'carry' || giving.phase === 'eat') nap = sleepy.bored(nap);
        giving = gift.drop(giving);
      }
      const acting = gift.owns(giving);
      let e: roam.RoamEvent | null;
      let p: roam.Pet;
      let cue: gift.Cue | null;
      [giving, p, cue, e] = gift.tick(giving, world, pet, present.place, now, dt);
      if (acting) [pet, event, ruled] = [p, e, true];
      if (cue) presented(cue, now);
      if (giving.phase === 'done') giving = null;
    }
    // лужа едет за своим окном и сохнет сама; «не мешать» или созвон — пропадает сразу
    if (puddle) {
      if (!unbothered()) puddle = null;
      else if (world) puddle = revenge.follow(puddle, world, now);
      if (puddle && revenge.gone(puddle, now)) puddle = null;
    }
    tellPuddle(now);
    tellMouse();
    if (pet && world && !carried) {
      if (ruled) {
        // кошку ведёт погоня
      } else if (dot && hunting(now)) {
        // отскочила от стены — дальше ошалело стоит со звёздочками, пока не придёт в себя
        if (now >= bonkUntil || pet.hunt?.mode === 'bonk') [pet, event] = roam.chase(pet, world, dot, dt);
        if (!hunted) stats.lasers++;
        hunted = true;
        if (event === 'bonk') bonkUntil = now + BONK_MS;
      } else {
        if (hunted) {
          hunted = false;
          bonkUntil = 0;
          pet = roam.endChase(pet);
        }
        [pet, event] = roam.step(pet, world, dt);
      }
      // занесло — всё под лапами отбрасывает по ходу (laser.rs, окно "push"), на экране по-настоящему ничего не двигается
      if (event === 'skid') invoke('skid', { x: pet.x, y: pet.y, dx: pet.facing, dy: 0 }).catch(console.error);
      if (event === 'arrived' && film.active && !mealPending) {
        const m = roam.monitorOf(world, pet);
        if (m) pet = { ...pet, facing: pet.x < (m.rect.left + m.rect.right) / 2 ? 1 : -1 };
        if (peekPending) {
          peekPending = false;
          speak(t('А? Что я пропустила?', 'Huh? What did I miss?'), now);
        }
      }
      if (event === 'arrived' && groomOnArrival) {
        groomOnArrival = false;
        groomUntil = now + GROOM_MS;
      }
      if (event === 'arrived' && roam.atBowl(pet, world, bowlPlace)) {
        pet = { ...pet, facing: -1 };
        if (mealPending) {
          mealPending = false;
          meal(now);
        }
      }
      // дошла, приземлилась или сорвалась — поза меняется сразу, не дожидаясь следующего кадра анимации
      // место — в хранилище на каждой остановке: перезапуск не должен уносить её в угол
      if (event === 'arrived' || event === 'gone') persist(now);
      if (`${pet.move} ${pet.hunt?.mode}` !== was) render();
      else place();
    }
    const perched = pet?.hwnd != null || bowlPlace?.hwnd != null || (bedOn && bedPlace?.hwnd != null) || (litterOn && litterPlace?.hwnd != null) || (gift.lying(present) && present.place?.hwnd != null);
    if (now - lastWorld >= (perched ? PERCH_WORLD_MS : WORLD_MS)) survey();
  }

  function render() {
    const now = Date.now();
    live(now);
    const next = choose(now);
    if (next !== anim) {
      anim = next;
      tick = 0;
    }
    // жирок по сегодняшней дате: если комп не выключали с октября, кошка всё равно потолстеет
    if (anim) {
      // стадия роста: малыш, подросток или взрослая; в момент роста — мерцает между ними
      const kit = growing.animsFor(stageNow(now), fatOn(new Date()));
      const { frames } = kit[anim];
      // в момент роста кадр не листается: перерисовка частая, а мигать должна только стадия
      const still = growAt && anim === 'sit';
      // на таймере — калачик рядом с песочными часами, хвост не качается (hourglass.ts)
      const base =
        pomodoro.focusing(focus) && (anim === 'sleep' || anim === 'bed')
          ? focusFrame(kit.sleep.frames, tick, pomodoro.progress(focus, now), anim === 'bed')
          : frames[still ? 0 : tick % frames.length];
      // наряд по календарю: шапка, тыква — на любую позу с головой анфас
      // мышь в зубах — до наряда: наряд перекрывает макушку, по которой её ищут.
      // Наряд за достижение — в остальные дни: праздничный важнее.
      let drawn = dress(gift.carrying(giving) ? withMouse(base) : base, holidays.outfit(new Date()) ?? awards.worn(prize));
      if (still) drawn = growing.sparkle(drawn, now - growAt);
      // окрас — на готовый кадр, но до зеркала: пятна трёхцветной поворачиваются вместе с ней
      drawn = paint(drawn, breed);
      // все позы нарисованы мордой вправо; «з-з-з» — буквы, их не зеркалят
      frame = pet?.facing === -1 && anim !== 'zzz' ? flip(drawn) : drawn;
      draw(canvas.getContext('2d')!, frame, coat);
    } else {
      frame = [];
      canvas.getContext('2d')!.clearRect(0, 0, SIZE, SIZE);
    }
    // Rust пропускает клики сквозь всё, что не нарисовано, — сообщаем ему форму кадра, если она сменилась.
    // Кошку в пути не поймать: пока идёт, прыгает или падает, клики проходят насквозь.
    const mask = anim && (carried || !pet || pet.move === 'still') ? hitMask(frame) : NO_MASK;
    const key = mask.join(',');
    if (key !== lastMask) {
      lastMask = key;
      invoke('set_hit_mask', { rows: mask }).catch(console.error);
    }
    place();
    tellBowl();
    tellBed();
    tellLitter();
    tellGift();
    if (speakingUntil && !free() && !forced) hush();
  }

  /** У каждой анимации свой темп, поэтому таймер заводится заново на каждый кадр. */
  function loop() {
    tick++;
    buzz(Date.now());
    grows(Date.now());
    render();
    // у малыша и подростка темп тот же, что у взрослой (sprite-young.test.ts)
    timer = setTimeout(loop, growAt ? GROW_TICK_MS : anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
  }

  /** Какая стадия на экране сейчас. */
  function stageNow(now: number): growing.Stage {
    return growAt ? growing.momentAt(growPath, now - growAt) : growing.shown(growth, stats.together, form);
  }

  /** Начать момент роста: сидит, мерцает между стадиями, звёздочки; облачко — когда «вытянулась». */
  function startGrow(now: number, kind: growing.Moment, path: growing.Stage[]) {
    growAt = now;
    growKind = kind;
    growPath = path;
    growSaid = false;
    clearTimeout(timer);
    timer = setTimeout(loop, GROW_TICK_MS);
  }

  /**
   * Момент роста идёт: доиграл — запомнить, что человек его видел. Взяли на руки, погладили,
   * спрятали «боссом» — момент не засчитан, покажется в другой свободный раз.
   */
  function grows(now: number) {
    if (!growAt) return;
    const el = now - growAt;
    if (bossed || !free() || now < pettedUntil) {
      if (growSaid && speakingUntil) hush();
      growAt = 0;
      return;
    }
    if (!growSaid && el >= growing.momentMs(growPath)) {
      growSaid = true;
      speak(
        growKind === 'power'
          ? t('Смотри, что я теперь умею! Форму можно выбрать в настройках.', 'Look what I can do now! You can pick my form in the settings.')
          : t('Смотри, я подросла!', "Look, I've grown!"),
        now,
      );
    }
    if (el < growing.totalMs(growPath)) return;
    growAt = 0;
    growth = growing.apply(growth, stats.together, growKind);
    persist(now);
    // открытое окно настроек меняет подпись «откроется через…» на ползунок
    if (growth.power) emitTo('settings', 'growth', { growth: growing.save(growth), together: stats.together }).catch(console.error);
  }

  /**
   * Клик по кошке гладит, по миске в её кадре — то же, что клик по окну миски.
   * Потянули с зажатой ЛКМ — берут за шкирку и несут; отпустили — падает на то, что под ней.
   * Пока ест, ЛКМ по ней ничего не делает.
   */
  async function poke(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    if (onBowl(frame, x, y)) return bowlClick(e.button, Date.now());
    if (e.button === 2) return void showMenu();
    if (e.button !== 0 || holding) return;
    // ест — не трогать: ни погладить, ни унести от миски недоевшей
    if (Date.now() < eatUntil) return;
    holding = true;
    // шкирка — в CSS px от угла окна: Rust подвинет окно так, чтобы она оказалась под курсором
    const cell = r.width / SIZE;
    const grab = [r.left + SCRUFF_AT[0] * cell, r.top + SCRUFF_AT[1] * cell];
    let drop: { x: number; bottom: number } | null = null;
    try {
      drop = await invoke<{ x: number; bottom: number } | null>('drag_window', { grab });
    } catch (err) {
      console.error(err);
    }
    holding = false;
    const now = Date.now();
    // drop без carried — drag-start обогнал ответ команды; окно всё равно уехало
    if (carried || drop) {
      carried = false;
      lastPlace = '';
      if (drop && pet && world) pet = roam.release(pet, world, drop.x, drop.bottom);
      // посреди фильма перенесли на другой монитор — значит, кино там
      if (film.active && pet && world) filmScreen = movie.petScreen(world, pet);
      lastMove = now;
      persist(now);
    } else if (focus && pomodoro.focusing(focus)) {
      // спит на таймере: не просыпается и не мурчит — говорит, сколько осталось, тычком это не считается
      forced = true;
      talk = { ...talk, spoke: now };
      speak(pomodoro.leftLine(focus, now), now);
    } else if (!disturb(now)) {
      pettedUntil = now + PETTED_MS;
      stats.petted++;
      // гладят без передышки — это уже тычки (revenge.PESTER_CLICKS)
      grudge = revenge.poked(grudge, now, Math.random, mode, trait().touchy);
      talk = chatter.liked(talk, now);
    }
    render();
  }

  /** Rust сообщил, что кошку потянули: всё, чем была занята, бросает, спящая просыпается. */
  function pickUp() {
    if (!holding) return;
    carried = true;
    stats.carried++;
    eatUntil = groomUntil = pettedUntil = bonkUntil = 0;
    groomOnArrival = false;
    if (hunted && pet) pet = roam.endChase(pet);
    hunted = false;
    disturb(Date.now());
    render();
  }

  /** Настройки сменились здесь или в окне настроек — кошка и миска подстраиваются сразу. */
  function applySettings(s: Settings) {
    feederOn = s.feeder;
    bedOn = s.bed;
    // лоток так же: включили — первый поход не сразу; выключили — поход бросит сам (move: canPotty)
    if (s.litter && !litterOn) nextPotty = Date.now() + litter.gap(Math.random);
    litterOn = s.litter;
    // включили — первая мышь не сразу; выключили — мышь удерёт сама (move: canHunt)
    if (s.hunter && !hunterOn) nextHunt = Date.now() + huntGap();
    hunterOn = s.hunter;
    hunterArea = s.hunterArea;
    // клубок так же: включили — не сразу, выключили — укатится сам (move: canYarn)
    if (s.yarn && !yarnOn) nextYarn = Date.now() + yarnGap();
    yarnOn = s.yarn;
    mode = s.mode;
    // новая тема — первый факт или новость про неё скоро, а не через час-три
    if (s.topics.some((x) => !topics.includes(x))) talk = chatter.topicAdded(talk, new Date(), Math.random);
    topics = s.topics;
    // трей и его подсказка тоже зовут питомца по имени
    if (s.name !== petName) invoke('name_pet', { name: s.name }).catch(console.error);
    petName = s.name;
    reviewsOn = s.reviews;
    form = s.form;
    tellUpdates(s.updates);
    // ленты новых тем качаются сразу, а не когда кошка соберётся рассказать
    invoke('news_topics', { topics: [...topics] }).catch(console.error);
    // игры и серии: Rust сам решает, что качать; выключили — отложенное про запас не скажем
    const releases = releasesSetup(s);
    releasesOn = releases.steam || releases.anime !== '';
    if (held?.link && !(held.topic === 'игры' ? releases.steam : releases.anime)) held = null;
    invoke('releases_setup', releases).catch(console.error);
    if (s.chatter !== chatterLevel || s.breed !== breed) {
      chatterLevel = s.chatter;
      setBreed(s.breed);
      talk = chatter.retime(talk, chatterLevel, Date.now(), Math.random, trait().talky);
    }
    invoke('set_capture_hidden', { hidden: s.hideFromCapture }).catch(console.error);
    tellBowl();
    tellBed();
    tellLitter();
  }

  /** Сменили окрас: палитра считается один раз здесь, а не на каждом кадре. */
  function setBreed(b: Breed) {
    breed = b;
    coat = palette(b);
  }

  /** Галочка «проверять обновления» — в update.rs; в ответ уже найденная версия, если есть. */
  function tellUpdates(on: boolean) {
    invoke<string | null>('set_updates', { on })
      .then((v) => {
        if (v) updateTo = v;
      })
      .catch(console.error);
  }

  /**
   * Поставить обновление (пункт в меню кошки или в трее): дописать всё на диск, как перед переносом
   * папки, и отдать Rust. Установщик закроет программу и сам откроет новую версию.
   */
  async function installUpdate() {
    if (frozen || !updateTo) return;
    persist(Date.now());
    frozen = true;
    await store.flush();
    invoke('install_update').catch((e) => {
      console.error(e);
      frozen = false;
      speak(t('Обновиться не вышло, попробуй позже.', "The update didn't work, try again later."), Date.now());
    });
  }

  /** Галочка в ПКМ-меню: сохранить, применить и показать открытому окну настроек. */
  function toggle(field: 'feeder' | 'bed' | 'litter' | 'hideFromCapture' | 'hunter' | 'hunterArea' | 'yarn') {
    if (frozen) return;
    const s = parse(store.get('settings'));
    if (field === 'hunterArea') s.hunterArea = s.hunterArea === 'screen' ? 'taskbar' : 'screen';
    else s[field] = !s[field];
    store.set('settings', serialize(s));
    applySettings(s);
    emitTo('settings', 'settings', s).catch(console.error);
  }

  /** ПКМ по кошке — своё меню (menu.rs): фокус у человека не забирает, выбор приходит событием menu-pick. */
  function showMenu() {
    const s = parse(store.get('settings'));
    const known = tally.days(stats.since, Date.now());
    const items = [
      // шапка с именем: назвали — ведёт в статистику, нет — в настройки, где имя и дают
      s.name
        ? { id: 'about', text: s.name, hint: t(`знакомы ${count(known, ['день', 'дня', 'дней'], ['day', 'days'])}`, `friends for ${count(known, ['день', 'дня', 'дней'], ['day', 'days'])}`) }
        : { id: 'about', text: t('Без имени', 'No name'), hint: t('назвать — в настройках', 'name her in settings') },
      { separator: true },
      ...(updateTo
        ? [{ id: 'update', text: t(`Обновить до ${updateTo}`, `Update to ${updateTo}`), hint: t('перезапустится сама', 'restarts by itself') }, { separator: true }]
        : []),
      {
        id: 'news',
        text: t('Расскажи новость', 'Tell me the news'),
        hint: topics.length ? t('по выбранным темам', 'on your topics') : t('сначала выбери темы', 'pick topics first'),
      },
      // «Фокус 25 минут», а пока идёт — «Отменить фокус» с остатком минут
      pomodoro.menuEntry(focus, Date.now()),
      { separator: true },
      {
        id: 'feeder',
        text: t('Кормушка', 'Feeder'),
        checked: s.feeder,
        hint: s.feeder ? t('клик по миске — про запас', 'click the bowl to stock up') : t('клик по миске — покормить сейчас', 'click the bowl to feed now'),
      },
      { id: 'bed', text: t('Лежак', 'Bed'), checked: s.bed, hint: t('тащи мышью, как и миску', 'drag it like the bowl') },
      { id: 'litter', text: t('Лоток', 'Litter box'), checked: s.litter, hint: t('ПКМ по лотку — убрать или поменять', 'right-click it to scoop or change') },
      { id: 'hideFromCapture', text: t('Прятать от записи экрана', 'Hide from screen capture'), checked: s.hideFromCapture },
      { id: 'laser', text: t('Лазерная указка', 'Laser pointer'), checked: dot !== null, hint: t('или зажать Ctrl; Esc — выключить', 'or hold Ctrl; Esc turns it off') },
      { id: 'hunter', text: t('Охотник', 'Hunter'), checked: s.hunter, hint: t('иногда пробегает мышь', 'a mouse runs by now and then') },
      // в меню нет радиокнопок: область — галочкой, снятая — панель задач
      { id: 'hunterArea', text: t('Мышь по всему экрану', 'Mouse on the whole screen'), checked: s.hunterArea === 'screen', hint: t('иначе — по панели задач', 'otherwise along the taskbar') },
      { id: 'yarn', text: t('Клубок', 'Yarn'), checked: s.yarn, hint: t('раз в час-два катает по панели задач', 'rolls it along the taskbar every hour or two') },
      { separator: true },
      { id: 'stats', text: t('Статистика…', 'Stats…') },
      { id: 'settings', text: t('Настройки…', 'Settings…') },
    ];
    invoke('open_menu', { owner: 'pet', items }).catch(console.error);
  }

  function menuPick(id: string) {
    if (id === 'feeder' || id === 'bed' || id === 'litter' || id === 'hideFromCapture' || id === 'hunter' || id === 'hunterArea' || id === 'yarn') toggle(id);
    else if (id === 'laser') invoke('set_laser', { on: dot === null }).catch(console.error);
    else if (id === 'settings') invoke('open_settings').catch(console.error);
    else if (id === 'stats') invoke('open_stats').catch(console.error);
    else if (id === 'update') installUpdate();
    // без тем рассказывать нечего — ведём туда, где их выбирают
    else if (id === 'news' && topics.length) newsNow();
    else if (id === 'news') invoke('open_settings').catch(console.error);
    else if (id === 'about') invoke(petName ? 'open_stats' : 'open_settings').catch(console.error);
    else if (id === 'focus') startFocus();
    else if (id === 'focus-cancel') cancelFocus();
  }

  /**
   * «Фокус 25 минут» из меню кошки или трея: всё бросает и засыпает на таймере (live), облачко
   * убирает сразу. Трею — срок, чтобы пункт стал «Отменить фокус» с остатком минут.
   */
  function startFocus() {
    if (frozen) return;
    focus = pomodoro.start(Date.now());
    pettedUntil = 0;
    if (speakingUntil) hush();
    invoke('set_focus', { until: focus.until }).catch(console.error);
    render();
  }

  /** «Отменить фокус»: просыпается без обид, как после разблокировки экрана; фокус не засчитан. */
  function cancelFocus() {
    if (!pomodoro.focusing(focus)) return;
    focus = null;
    invoke('set_focus', { until: 0 }).catch(console.error);
    if (sleepy.mood(nap) === 'asleep' && !carried) {
      nap = sleepy.stir(nap);
      sleepPose = null;
    }
    if (speakingUntil) hush();
    persist(Date.now());
    render();
  }

  /** Облачко «Перерыв!» висит минуту: кнопку надо успеть заметить, а ныть весь перерыв незачем. */
  const OFFER_MS = 60_000;

  /**
   * Облачко «Перерыв! Поиграем?» с кнопкой «Лазер». Ждёт, пока человеку можно мешать: созвон, игра
   * на весь экран, «не мешать», экран заблокирован — не сейчас; не дождалось за OFFER_WAIT_MS —
   * перерыв кончается молча (pomodoro.step). Голодная сначала просит покормить.
   */
  function breakTime(now: number) {
    if (!focus || !pomodoro.offerDue(focus) || frozen || bossed || carried || !head || away() || onCall()) return;
    if ((senses?.quiet ?? 'no') !== 'no' || sleepy.mood(nap) !== 'awake') return;
    forced = true;
    // после облачка — обычная тишина, чтобы следом не заговорила сама
    talk = { ...talk, spoke: now };
    speak(pomodoro.offerLine(isHungry(belly) || mealPending), now, null, OFFER_MS, pomodoro.offerAct());
    focus = pomodoro.offered(focus, now);
  }

  /** Разблокировали экран: спала, пока человека не было, — просыпается без обид и радуется. */
  function unlocked(now: number) {
    const long = now - lockedAt >= LOCK_JOY_MS;
    lockedAt = 0;
    graceUntil = now + UNLOCK_GRACE_MS;
    if (carried || sleepy.mood(nap) !== 'asleep' || pomodoro.focusing(focus)) return;
    nap = sleepy.stir(nap);
    sleepPose = null;
    if (long) pettedUntil = now + JOY_MS;
    persist(now);
  }

  async function sense() {
    try {
      // До первого движения мыши трекер считает человека отошедшим, а сон липкий: без этого
      // кошка засыпала бы на NAP_MS прямо на старте. Скучать начинает, только увидев человека.
      senses = await invoke<Senses>('senses');
      seenHuman ||= !senses.idle;
      if (loaded && senses.input) {
        stats = tally.absorb(stats, lastInput, senses.input);
        lastInput = senses.input;
      }
      watch(Date.now(), senses);
      const locked = senses.quiet === 'away';
      if (locked && !lockedAt) lockedAt = Date.now();
      if (!locked && lockedAt) unlocked(Date.now());
      // заблокировал экран — точно отошёл, кошка засыпает сразу; за фильмом человек не трогает мышь — это не «отошёл»
      humanIdle = locked || (seenHuman && senses.idle && !film.active && Date.now() >= graceUntil);
      const hid = calls.onCall(hide);
      hide = calls.step(hide, senses.call ?? false, Date.now());
      if (calls.onCall(hide) && !hid) stats.calls++;
      // созвон начался — облачко убрать сразу, даже проверочное из трея
      if (onCall() && speakingUntil) hush();
      // важная программа дня нужна, только пока кошка в обиде
      if (revenge.holds(grudge, Date.now())) topApp = await invoke<string | null>('top_app');
    } catch (e) {
      console.error(e);
    }
    breakTime(Date.now());
    party(Date.now());
    boast(Date.now());
    flyBy(Date.now());
    chat(Date.now());
  }

  /** Окну статистики — достижения: полученные, ближайшие и наряд. Окно закрыто — событие никуда не уйдёт. */
  function sendAwards() {
    emitTo('stats', 'awards', prize).catch(console.error);
  }

  /**
   * Новое достижение: сверить со статистикой и сказать одним облачком — в общем лимите, как
   * обычные реплики: пауза в работе, кошка свободна, после прошлого облачка прошло GAP_MS.
   * Не вышло — достижение ждёт в prize.unsaid, а не теряется.
   */
  function boast(now: number) {
    if (!loaded) return;
    const was = prize;
    prize = awards.check(prize, stats, now);
    if (prize !== was) {
      sendAwards();
      persist(now);
    }
    if (!prize.unsaid.length || frozen || bossed || speakingUntil || flyAt || film.active || !senses || !head) return;
    const pause = !senses.idle && !senses.typing && (senses.quiet ?? 'no') === 'no';
    if (!pause || now - talk.spoke < chatter.GAP_MS || !free() || !unbothered()) return;
    const due = awards.herald(prize);
    if (!due) return;
    prize = due[0];
    talk = { ...talk, spoke: now };
    speak(due[1], now);
  }

  /** Тортик или годовщина: ждёт, пока кошка свободна, облачко пусто и человеку можно мешать. */
  function party(now: number) {
    if (bossed || speakingUntil || flyAt || growAt || now < cakeUntil || onTimer() || !free() || !unbothered()) return;
    const due = holidays.celebrate(stats, now);
    if (due) {
      [stats] = due;
      cakeUntil = now + CAKE_MS;
      speak(due[1], now);
      persist(now);
      return;
    }
    // подросла — показывает в следующий свободный раз, после тортика за те же часы
    const m = growing.due(growth, stats.together);
    if (m) startGrow(now, m, growing.steps(growth, stats.together, m));
  }

  onMount(() => {
    let alive = true;
    let moving: ReturnType<typeof setInterval> | undefined;
    // Сначала память и мир, потом первый кадр: иначе кошка мелькнёт там, где окно поставил Rust, и перепрыгнет.
    // Ставим туда, где оставили; запустили, пока она в отлучке или в обиде, — она сразу за краем.
    // Старые записи из localStorage переезжают в папку данных один раз, при первом открытии.
    Promise.all([open(tauriBackend(invoke), localLegacy()), survey()]).then(([opened]) => {
      if (!alive) return;
      store = opened;
      const settings = parse(store.get('settings'));
      feederOn = settings.feeder;
      bedOn = settings.bed;
      litterOn = settings.litter;
      nextPotty = Date.now() + litter.gap(Math.random);
      chatterLevel = settings.chatter;
      setBreed(settings.breed);
      topics = settings.topics;
      reviewsOn = settings.reviews;
      tellUpdates(settings.updates);
      hunterOn = settings.hunter;
      hunterArea = settings.hunterArea;
      nextHunt = Date.now() + huntGap();
      yarnOn = settings.yarn;
      nextYarn = Date.now() + yarnGap();
      mode = settings.mode;
      // имя — репликам и трею; иначе после перезапуска кошка безымянная, пока не тронешь настройки
      petName = settings.name;
      if (petName) invoke('name_pet', { name: petName }).catch(console.error);
      talk = chatter.load(store.get('talk'), Date.now(), chatterLevel, Math.random, trait().talky);
      bowlPlace = loadPlace('bowl');
      bedPlace = loadPlace('bed');
      litterPlace = loadPlace('litter');
      box = litter.loadBox(store.get('litter'));
      present = gift.load(store.get('gift'));
      // Rust создаёт окна спрятанными от записи экрана; выключил человек галочку — показываемся
      invoke('set_capture_hidden', { hidden: settings.hideFromCapture }).catch(console.error);
      belly = load(store.get('belly'));
      nap = sleepy.load(store.get('sleep'));
      stats = tally.load(store.get('stats'), Date.now());
      prize = awards.load(store.get('awards'));
      loaded = true;
      // записи о росте нет, а статистика или сытость есть — обновились со старой версии: кошка взрослая
      growth = growing.load(store.get('growth'), store.get('stats') !== null || store.get('belly') !== null);
      form = settings.form;
      grudge = revenge.load(store.get('revenge'), Date.now());
      if (world) pet = roam.restore(world, loadSpot(), away());
      // дневник: вчерашний день, если программу закрыли до полуночи, запишется прямо сейчас
      today = diary.load(store.get('day'), chatter.dayKey(new Date()), stats);
      pages = diary.loadList(store.get('diary'));
      turnPage(Date.now());
      lastMove = Date.now();
      render();
      timer = setTimeout(loop, anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
      moving = setInterval(move, MOVE_MS);
    });
    sense();
    const id = setInterval(sense, SENSES_MS);
    // «Новый котик» в трее: только взамен сбежавшего, живую кошку не подменяет; статистика остаётся
    const unlisten = listen('adopt', () => {
      if (!belly.gone) return;
      belly = fresh();
      nap = sleepy.fresh();
      // новый котик — снова малыш, счёт с нынешнего общего времени; форма — снова своя
      growth = growing.fresh(stats.together);
      growAt = 0;
      const s = parse(store.get('settings'));
      if (s.form !== 'adult') {
        s.form = 'adult';
        store.set('settings', serialize(s));
        applySettings(s);
        emitTo('settings', 'settings', s).catch(console.error);
      }
      comeBack(Date.now());
      persist(Date.now());
      render();
    });
    // Rust заметил, что курсором трясут над кошкой: будит так же, как клик, но не гладит
    const unshake = listen('shake', () => {
      if (disturb(Date.now())) render();
    });
    const unclick = listen<{ button: number }>('bowl-click', (e) => bowlClick(e.payload.button, Date.now()));
    // окна миски и лежака открылись позже кошки — расскажем им всё ещё раз
    const unhello = listen('bowl-hello', () => {
      lastBowl = '';
      tellBowl();
    });
    const unbedHello = listen('bed-hello', () => {
      lastBed = '';
      tellBed();
    });
    const unbowlDrop = listen<{ x: number; bottom: number }>('bowl-drop', (e) => putDown('bowl', e.payload.x, e.payload.bottom));
    const unbedDrop = listen<{ x: number; bottom: number }>('bed-drop', (e) => putDown('bed', e.payload.x, e.payload.bottom));
    // лежак потащили из-под спящей кошки — будит, как клик
    const unbedGrab = listen('bed-grab', () => {
      if (pet && world && roam.atBed(pet, world, bedPlace) && disturb(Date.now())) render();
    });
    // окно лотка — так же, как лежака
    const unlitterHello = listen('litter-hello', () => {
      lastLitter = '';
      tellLitter();
    });
    const unlitterDrop = listen<{ x: number; bottom: number }>('litter-drop', (e) => putDown('litter', e.payload.x, e.payload.bottom));
    // лоток выдернули из-под кошки — передумала; по дороге к нему — пойдёт туда, где бросят
    const unlitterGrab = listen('litter-grab', () => {
      if (!potty || !litter.owns(potty) || !pet || !world || !roam.atLitter(pet, world, litterPlace)) return;
      potty = litter.drop(potty);
      render();
    });
    // ПКМ по лотку (Thing.svelte): «Убрать» — комочки, «Поменять» — весь наполнитель
    const unscoop = listen('litter-scoop', () => {
      box = litter.scoop(box);
      persist(Date.now());
      tellLitter();
    });
    const unchange = listen('litter-change', () => {
      box = litter.change();
      persist(Date.now());
      tellLitter();
    });
    // окно подарка — так же, как лотка
    const ungiftHello = listen('gift-hello', () => {
      lastGift = '';
      tellGift();
    });
    const ungiftDrop = listen<{ x: number; bottom: number }>('gift-drop', (e) => putDown('gift', e.payload.x, e.payload.bottom));
    // ПКМ по подарку (Thing.svelte): «Принять» — мурлычет, мышка остаётся трофеем. Занята или спит —
    // просто трофей, без мурлыканья
    const unaccept = listen('gift-accept', () => {
      const now = Date.now();
      if (present.state !== 'given' || taking()) return;
      present = gift.accept(present);
      if (giving?.phase === 'wait') giving = null;
      if (!giving && pet && (pet.move === 'still' || pet.move === 'walk') && canGift(now)) {
        [giving, pet] = gift.thank(pet, now);
        giftSay(gift.purrLine(), now);
      }
      persist(now);
      render();
    });
    // «Убрать»: ждущий подарок — обижается, уносит мышь за край, ест там и спит; трофей убирают молча.
    // Не может пойти (спит, за краем, занята) — подарок просто пропадает
    const unremove = listen('gift-remove', () => {
      const now = Date.now();
      if (!gift.lying(present) || taking()) return;
      if (giving?.phase === 'wait') giving = null;
      const back = present.state === 'given' && !giving && pet && world && canGift(now) ? gift.takeBack(world, pet, present.place, now) : null;
      if (back) {
        [giving, pet] = back;
        giftSay(gift.hurtLine(), now);
      } else present = gift.remove();
      persist(now);
      render();
    });
    // «Позвать питомца» в трее. Досыпает за краем в обиде — прощает и приходит оттуда же
    // (вход сделает live()); ушедшую за едой и пропавшую зов не вернёт. Дома зов ничего не
    // делает: позвали дважды — не телепортируется; с отключённого монитора и так снимет roam.
    const uncall = listen('call', () => {
      if (sleepy.mood(nap) !== 'away') return;
      nap = sleepy.call(nap);
      sleepPose = null;
      persist(Date.now());
      render();
    });
    // пункт есть только в трее dev-сборки (lib.rs, debug_assertions)
    const unsay = listen('dev-say', sayNow);
    // «Проголодаться» оттуда же: к миске она пойдёт сама, как проголодавшаяся по часам, — спящая после пробуждения
    const unhungry = listen('dev-hungry', () => {
      belly = starve(belly);
      persist(Date.now());
      render();
    });
    // «Охотник» оттуда же: выключен — включает; мышь выбегает сразу, спящую кошку — дождётся
    const unhunter = listen('dev-hunter', () => {
      if (!hunterOn) toggle('hunter');
      nextHunt = 0;
      huntNow = true;
    });
    // «Клубок» из трея dev-сборки: выключен — включает; выносит сразу, как кошка свободна
    const unyarn = listen('dev-yarn', () => {
      if (!yarnOn) toggle('yarn');
      nextYarn = 0;
      yarnNow = true;
    });
    const unnews = listen('dev-news', newsNow);
    // «Лоток» оттуда же: выключен — включает; идёт в него, как только свободна
    // «Муха» оттуда же: сразу, мимо редкости и паузы человека — была бы кошка свободна
    const unfly = listen('dev-fly', () => {
      if (!bossed && !flyAt && free()) startFly(Date.now());
    });
    // «Подарок» оттуда же: заново, мимо 2400 часов и «раз за жизнь»; пока мышка лежит — не дарит
    const ungift = listen('dev-gift', () => {
      if (gift.lying(present) || giving) return;
      present = gift.fresh();
      giftNow = true;
    });
    // «Рост» оттуда же: момент, который пора показать; не пора — просто показать малыша, подростка и взрослую
    const ungrow = listen('dev-grow', () => {
      if (bossed || growAt || !free()) return;
      const m = growing.due(growth, stats.together);
      startGrow(Date.now(), m ?? 'grow', m ? growing.steps(growth, stats.together, m) : [0, 1, 2]);
    });
    const unlitter = listen('dev-litter', () => {
      if (!litterOn) toggle('litter');
      nextPotty = 0;
      pottyNow = true;
    });
    // «Месть» оттуда же: обида сразу, мимо режима, шанса и перезарядки; «не мешать» и созвон — не мимо
    const unrevenge = listen('dev-revenge', () => {
      grudge = revenge.dare(grudge, Date.now());
      revengeNow = true;
    });
    // нашлась версия новее (update.rs): пункт в меню; ставить зовут и из трея
    // «Фокус 25 минут» и «Отменить фокус» из трея (lib.rs) — то же, что в меню кошки
    const unfocus = listen('focus', startFocus);
    const unfocusCancel = listen('focus-cancel', cancelFocus);
    const unupdate = listen<string>('update', (e) => {
      updateTo = e.payload;
    });
    const uninstall = listen('update-install', installUpdate);
    // окно настроек уже сохранило файл; кеш обновляем, чтобы следующая галочка в меню не затёрла его старьём
    // Слушаем своим окном: глобальный listen поймал бы и наш же emitTo('settings', 'settings').
    const win = getCurrentWebviewWindow();
    const unsettings = win.listen<Settings>('settings', (e) => {
      if (frozen) return;
      const s = parse(serialize(e.payload));
      store.set('settings', serialize(s));
      applySettings(s);
    });
    // Перед переносом папки: дописать всё и замолчать. Удачный перенос перезапустит программу,
    // неудачный пришлёт thaw.
    const unfreeze = win.listen('freeze', async () => {
      persist(Date.now());
      frozen = true;
      await store.flush();
      emitTo('settings', 'frozen').catch(console.error);
    });
    const unthaw = win.listen('thaw', () => {
      frozen = false;
    });
    const unpick = win.listen<{ id: string }>('menu-pick', (e) => menuPick(e.payload.id));
    // окно «Статистика» спрашивает свежие цифры: в файле они догоняют только при сохранении
    const unstats = win.listen('stats-ask', () => {
      emitTo('stats', 'stats', stats).catch(console.error);
      emitTo('stats', 'diary', { today: today && diary.facts(today, stats), pages }).catch(console.error);
      sendAwards();
    });
    // наряд выбрали в окне статистики: наряд, «без наряда» или «сама»
    const unwear = win.listen<unknown>('wear', (e) => {
      prize = awards.choose(prize, e.payload);
      persist(Date.now());
      sendAwards();
      render();
    });
    // своим окном: такое же событие Rust шлёт и окнам миски и лежака
    const undrag = win.listen('drag-start', pickUp);
    // лазер: Rust шлёт курсор, пока указка включена, — охоту ведёт move()
    const unlaser = win.listen<roam.Dot>('laser', (e) => {
      if (dot === null) dotSince = Date.now();
      dot = e.payload;
    });
    const unlaserOff = win.listen('laser-off', () => {
      dot = null;
    });
    // облачко смахнули кликом: окно уже спряталось само, кошка запоминает и болтает реже
    const unboss = win.listen<boolean>('boss', (e) => {
      bossed = e.payload;
      if (bossed && speakingUntil) hush();
    });
    // снимают экран: свободная кошка позирует; занятая своим делом не отвлекается
    const unshot = win.listen('shot', () => {
      if (!bossed && free()) poseUntil = Date.now() + POSE_MS;
    });
    // очистили корзину: свободная кошка хрумкает выброшенным
    const uncrunch = win.listen('crunch', () => {
      if (!bossed && free()) crunchUntil = Date.now() + CRUNCH_MS;
    });
    const unshoo = win.listen('bubble-shoo', () => {
      speakingUntil = 0;
      voteFor = null;
      // проверочное облачко смахнули — кошке не в укор
      if (forced) {
        forced = false;
        return;
      }
      talk = chatter.shoo(talk, chatterLevel, Math.random, trait().talky);
      persist(Date.now());
    });
    // лайк/диз под новостью: окно уже спряталось; тема и источник — чаще или реже, болтать реже не станет.
    // Под патчем или серией — «Глянем» (open) открывает ссылку, «Мимо» просто убирает; вкусов не трогаем
    const unvote = win.listen<{ up: boolean; open?: boolean }>('bubble-vote', (e) => {
      const about = voteFor;
      speakingUntil = 0;
      forced = false;
      voteFor = null;
      if (!about) return;
      if (about.link) {
        if (e.payload.open) invoke('open_link', { url: about.link }).catch(console.error);
        return;
      }
      talk = chatter.vote(talk, about.topic, e.payload.up);
      invoke('news_vote', { source: about.source, up: e.payload.up }).catch(console.error);
      persist(Date.now());
    });
    // кнопка «Лазер» в облачке «Перерыв!»: облачко уже спряталось само, указку включает Rust
    const unact = win.listen('bubble-act', () => {
      speakingUntil = 0;
      forced = false;
      voteFor = null;
      invoke('set_laser', { on: true }).catch(console.error);
    });
    return () => {
      alive = false;
      persist(Date.now());
      clearTimeout(timer);
      clearInterval(moving);
      clearInterval(id);
      const offs = [unlisten, unshake, unclick, unhello, unbedHello, unbowlDrop, unbedDrop, unbedGrab, uncall, unsay, unhungry, unhunter, unyarn, unnews, unrevenge, unupdate, uninstall];
      offs.push(unlitterHello, unlitterDrop, unlitterGrab, unscoop, unchange, unlitter, unfly, unfocus, unfocusCancel, ungrow);
      offs.push(ungiftHello, ungiftDrop, unaccept, unremove, ungift);
      for (const off of [...offs, unsettings, unfreeze, unthaw, unpick, unstats, unwear, undrag, unlaser, unlaserOff, unshoo, unvote, unact, unboss, unshot, uncrunch]) off.then((f) => f());
    };
  });
</script>

<!-- Встроенное меню WebView2 («Назад», «Обновить», «Проверить») питомцу ни к чему; своё — в showMenu. -->
<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width={SIZE} height={SIZE} onpointerdown={poke}></canvas>

<style>
  /* Квадрат по центру окна: окно может оказаться шире спрайта (минимальная ширина окна в Windows),
     и тянуть кошку вслед за ним нельзя. Rust считает попадание курсора по той же геометрии. */
  canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(100vw, 100vh);
    height: min(100vw, 100vh);
    image-rendering: pixelated;
  }
</style>
