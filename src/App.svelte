<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { feedBowl, fresh, isHungry, load, refill, save, step, takeOut, type Belly } from './lib/hunger';
  import * as roam from './lib/roam';
  import { parse } from './lib/settings';
  import * as sleepy from './lib/sleep';
  import { ANIMS, BOWL_X, bowlLeft, draw, fatOn, flip, ground, hitMask, onBowl, SIZE, type AnimName, type Frame } from './lib/sprite';
  import { localLegacy, memoryStore, open, tauriBackend, type Store } from './lib/store';

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
  /** Шаг движения: 25 раз в секунду — окно едет ровно, а Rust успевает его двигать. */
  const MOVE_MS = 40;
  /** Мониторы и окна перечитываются раз в секунду; пока кошка сидит на чужом окне — чаще: его могут потащить. */
  const WORLD_MS = 1000;
  const PERCH_WORLD_MS = 200;
  /** С такой вероятностью, сменив позу отдыха, кошка перебирается на другое место. */
  const WANDER = 0.5;
  /** Как часто спрашивать у Rust, что делает человек. Питомцу спешить некуда. */
  const SENSES_MS = 2000;
  /** Голод пишется на диск раз в минуту и на каждом событии: упадёт программа — потеряется не больше минуты. */
  const SAVE_MS = 60_000;
  /** Пока кошки нет на экране, проверять, не вернулась ли, раз в секунду. */
  const AWAY_TICK_MS = 1000;
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
  }

  /** Копится за всю жизнь программы; питомец сбежал — цифры остаются. */
  interface Stats {
    fed: number;
    petted: number;
  }

  /** Файлы в папке, выбранной на первом запуске; до открытия — память, чтобы не ловить null. */
  let store: Store = memoryStore();

  function loadStats(): Stats {
    try {
      const s = JSON.parse(store.get('stats') ?? '{}');
      return { fed: Number(s.fed) || 0, petted: Number(s.petted) || 0 };
    } catch {
      return { fed: 0, petted: 0 };
    }
  }

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

  /** Галочка «Кормушка» из настроек первого запуска; меню, когда появится, будет писать туда же. */
  let feederOn = false;
  let belly: Belly = fresh();
  let nap: sleepy.Sleep = sleepy.fresh();
  let stats: Stats = { fed: 0, petted: 0 };
  /** Покормили, а кошка не у миски: сначала дойдёт, потом ест. Корм тем временем лежит в миске. */
  let mealPending = false;
  let lastBowl = '';

  let canvas: HTMLCanvasElement;
  let anim: AnimName | null = 'sit';
  let frame: Frame = [];
  let tick = 0;
  let pettedUntil = 0;
  let humanIdle = false;
  let seenHuman = false;
  let rest: AnimName = 'sit';
  let restUntil = 0;
  /** Поза сна выбирается при засыпании и держится до пробуждения. */
  let sleepPose: AnimName | null = null;
  let groomUntil = 0;
  let eatUntil = 0;
  /** Мониторы и окна-насесты; null — Rust их не дал (не Windows или ошибка), кошка стоит, где поставили. */
  let world: roam.World | null = null;
  let pet: roam.Pet | null = null;
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

  function persist(now: number) {
    lastSave = now;
    store.set('belly', save(belly));
    store.set('sleep', sleepy.save(nap));
    store.set('stats', JSON.stringify(stats));
    if (pet) store.set('spot', JSON.stringify(roam.spotOf(pet)));
  }

  /** Окно миски рисует корм: в кормушке — порции, без неё — насыпанное, пока кошка идёт есть. */
  function tellBowl() {
    const portions = (feederOn ? belly.feeder : 0) + (mealPending ? 1 : 0);
    const key = String(portions);
    if (key === lastBowl) return;
    lastBowl = key;
    emitTo('bowl', 'bowl', { portions }).catch(console.error);
  }

  /** Мира нет (не Windows, экран блокировки) — миска нарисована в кадре кошки, идти никуда не надо. */
  const atBowl = (): boolean => !pet || !world || roam.atBowl(pet, world);

  /** К миске; у миски — мордой к ней, она справа. */
  function toBowl() {
    if (!pet || !world || pet.move === 'out' || away()) return;
    const b = roam.bowlAt(world);
    if (!b) return;
    if (roam.atBowl(pet, world)) pet = { ...pet, facing: -1 };
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
   * Клик по миске — в окне кошки (поза hungry) или в отдельном окне миски. С кормушкой ЛКМ досыпает
   * порцию (кошка съест её сама, когда проголодается), ПКМ забирает. Без кормушки сытой кошке не насыпают.
   */
  function bowlClick(button: number, now: number) {
    if (feederOn) {
      belly = button === 2 ? takeOut(belly) : refill(belly);
      if (button !== 2) stats.fed++;
    } else {
      if (button === 2 || mealPending) return;
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

  /** Кошке нечего делать на экране: ушла за едой, сбежала или досыпает в обиде. */
  function away(): boolean {
    return belly.gone || belly.away > 0 || sleepy.mood(nap) === 'away';
  }

  /** Вернулась из-за края — выспавшейся или сытой, всё равно сначала умывается. */
  function comeBack(now: number) {
    if (pet && world) {
      pet = roam.enter(pet, world);
      groomOnArrival = true;
    } else groomUntil = now + GROOM_MS;
  }

  /** Перебраться на другое место: посидеть у края пола или на окне, поспать — лучше на окне. */
  function wander(kind: 'rest' | 'sleep') {
    if (pet && world && pet.move !== 'out' && !away()) pet = roam.goTo(pet, world, roam.pickSpot(world, pet, kind, Math.random));
  }

  /**
   * Побудка кликом или тряской курсора. Бодрую не касается — тогда false, и клик просто гладит.
   * Выспавшаяся проснулась и умывается; не доспавшая вялая, злая, а на третий раз уходит за край.
   */
  function disturb(now: number): boolean {
    const [next, result] = sleepy.poke(nap);
    if (!result) return false;
    nap = next;
    sleepPose = null;
    if (result === 'wake') groomUntil = now + GROOM_MS;
    // 'leave' — за край она уйдёт сама: это заметит live()
    persist(now);
    return true;
  }

  /** Голод и сон живут по времени работы программы; их события превращаются в позы. */
  function live(now: number) {
    const dt = now - lastStep;
    lastStep = now;
    const [next, event] = step(belly, dt, feederOn);
    belly = next;
    if (event === 'eat') serve(now);
    // поела где-то там
    if (event === 'return') comeBack(now);

    const [rested, mood] = sleepy.step(nap, dt, humanIdle);
    nap = rested;
    if (mood === 'sleep') {
      sleepPose = pick(SLEEPS);
      wander('sleep');
    }
    if (mood === 'doze') sleepPose = pick(DOZES);
    // полный сон — не меньше NAP_MS, по кошачьим меркам долго: проснувшись, умывается
    if (mood === 'wake') groomUntil = now + GROOM_MS;
    if (mood === 'return') comeBack(now);

    // Уход и возвращение сверяются с голодом и сном каждый кадр, а не только по событиям:
    // так их не потерять ни при запуске, ни при побудке, ни при «Новом котике».
    if (pet && world) {
      if (!away()) {
        if (pet.move === 'out') comeBack(now);
      } else if (pet.move !== 'out' && pet.exit === 0) pet = roam.leave(pet, world);
      // на полосе заголовка только спят: проснулась — слезает
      if (roam.onStrip(pet) && pet.move === 'still' && sleepy.mood(nap) !== 'asleep') wander('rest');
      // голодная и бодрая — идёт к миске; спящую голод не будит
      if ((isHungry(belly) || mealPending) && sleepy.mood(nap) === 'awake') toBowl();
    }

    if (event || mood || now - lastSave >= SAVE_MS) persist(now);
  }

  /** Поза на сейчас; null — кошки на экране нет. */
  function choose(now: number): AnimName | null {
    // в пути — только ходьба, прыжок или падение, чем бы ни была занята голова
    if (pet && pet.move !== 'still' && pet.move !== 'out') return pet.move;
    if (belly.gone || belly.away > 0) return null;
    const mood = sleepy.mood(nap);
    // «з-з-з» — только из-за края; пока не дошла, идёт
    if (mood === 'away') return pet && pet.move !== 'out' ? 'walk' : 'zzz';
    if (now < pettedUntil) return 'petted';
    if (now < eatUntil) return 'eat';
    if (mood === 'angry' || mood === 'groggy') return mood;
    if (mood === 'asleep') return pet && roam.onStrip(pet) ? 'sleep' : (sleepPose ??= pick(SLEEPS));
    // проснулась голодной — сначала к миске, умыться успеет потом; не дошла — сидит и ждёт пути
    if (isHungry(belly) || mealPending) return atBowl() ? 'hungry' : 'sit';
    if (now < groomUntil) return 'groom';
    if (now >= restUntil) {
      rest = pick(RESTS);
      restUntil = now + REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
      if (Math.random() < WANDER) wander('rest');
      if (pet?.move === 'walk') return 'walk';
    }
    return rest;
  }

  /**
   * Окно питомца — туда, где кошка: низ окна по линии, которой поза стоит на опоре.
   * «З-з-з» выглядывают из-за того края, за которым она спит, — на экране только буквы.
   */
  function place() {
    if (!pet || !world) return;
    const m = roam.monitorOf(world, pet);
    if (!m) return;
    const half = roam.side(m) / 2;
    const cell = roam.side(m) / SIZE;
    let x = pet.x;
    // у миски окно кошки ложится так, чтобы миска в кадре совпала с окном миски: ест — наклоняется
    const bowl = roam.atBowl(pet, world) ? bowlLeft(frame) : null;
    if (bowl !== null) x += (BOWL_X - bowl) * cell;
    if (anim === 'zzz') x = pet.exit < 0 ? m.work.left + half - Z_LEFT * cell : m.work.right + half - (Z_RIGHT + 1) * cell;
    const bottom = pet.y + (SIZE - 1 - (anim ? ground(anim) : SIZE - 1)) * cell;
    const at = { x: Math.round(x), bottom: Math.round(bottom) };
    const key = `${at.x},${at.bottom}`;
    if (key === lastPlace) return;
    lastPlace = key;
    invoke('place_pet', at).catch(console.error);
  }

  /** Перечитать мониторы и окна. Пустой список (экран блокировки) — мира нет, кошка ждёт на месте. */
  async function survey() {
    if (surveying) return;
    surveying = true;
    lastWorld = Date.now();
    try {
      const w = await invoke<roam.World>('world');
      world = w.monitors.length ? w : null;
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
    if (pet && world) {
      const was = pet.move;
      const [next, event] = roam.step(pet, world, dt);
      pet = next;
      if (event === 'arrived' && groomOnArrival) {
        groomOnArrival = false;
        groomUntil = now + GROOM_MS;
      }
      if (event === 'arrived' && roam.atBowl(pet, world)) {
        pet = { ...pet, facing: -1 };
        if (mealPending) {
          mealPending = false;
          meal(now);
        }
      }
      // дошла, приземлилась или сорвалась — поза меняется сразу, не дожидаясь следующего кадра анимации
      // место — в хранилище на каждой остановке: перезапуск не должен уносить её в угол
      if (event === 'arrived' || event === 'gone') persist(now);
      if (pet.move !== was) render();
      else place();
    }
    if (now - lastWorld >= (pet?.hwnd != null ? PERCH_WORLD_MS : WORLD_MS)) survey();
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
      const { frames } = ANIMS[fatOn(new Date())][anim];
      const drawn = frames[tick % frames.length];
      // все позы нарисованы мордой вправо; «з-з-з» — буквы, их не зеркалят
      frame = pet?.facing === -1 && anim !== 'zzz' ? flip(drawn) : drawn;
      draw(canvas.getContext('2d')!, frame);
    } else {
      frame = [];
      canvas.getContext('2d')!.clearRect(0, 0, SIZE, SIZE);
    }
    // Rust пропускает клики сквозь всё, что не нарисовано, — сообщаем ему форму кадра, если она сменилась.
    // Кошку в пути не поймать: пока идёт, прыгает или падает, клики проходят насквозь.
    const mask = anim && (!pet || pet.move === 'still') ? hitMask(frame) : NO_MASK;
    const key = mask.join(',');
    if (key !== lastMask) {
      lastMask = key;
      invoke('set_hit_mask', { rows: mask }).catch(console.error);
    }
    place();
    tellBowl();
  }

  /** У каждой анимации свой темп, поэтому таймер заводится заново на каждый кадр. */
  function loop() {
    tick++;
    render();
    timer = setTimeout(loop, anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
  }

  /** Клик по кошке гладит, по миске в её кадре — то же, что клик по окну миски. */
  function poke(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    const now = Date.now();
    if (onBowl(frame, x, y)) return bowlClick(e.button, now);
    if (e.button === 0 && !disturb(now)) {
      pettedUntil = now + PETTED_MS;
      stats.petted++;
    }
    render();
  }

  async function sense() {
    try {
      // До первого движения мыши трекер считает человека отошедшим, а сон липкий: без этого
      // кошка засыпала бы на NAP_MS прямо на старте. Скучать начинает, только увидев человека.
      const { idle } = await invoke<Senses>('senses');
      seenHuman ||= !idle;
      humanIdle = seenHuman && idle;
    } catch (e) {
      console.error(e);
    }
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
      // Rust создаёт окна спрятанными от записи экрана; выключил человек галочку — показываемся
      invoke('set_capture_hidden', { hidden: settings.hideFromCapture }).catch(console.error);
      belly = load(store.get('belly'));
      nap = sleepy.load(store.get('sleep'));
      stats = loadStats();
      if (world) pet = roam.restore(world, loadSpot(), away());
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
      comeBack(Date.now());
      persist(Date.now());
      render();
    });
    // Rust заметил, что курсором трясут над кошкой: будит так же, как клик, но не гладит
    const unshake = listen('shake', () => {
      if (disturb(Date.now())) render();
    });
    const unclick = listen<{ button: number }>('bowl-click', (e) => bowlClick(e.payload.button, Date.now()));
    // окно миски открылось позже кошки — расскажем ему про корм ещё раз
    const unhello = listen('bowl-hello', () => {
      lastBowl = '';
      tellBowl();
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
    return () => {
      alive = false;
      persist(Date.now());
      clearTimeout(timer);
      clearInterval(moving);
      clearInterval(id);
      for (const off of [unlisten, unshake, unclick, unhello, uncall]) off.then((f) => f());
    };
  });
</script>

<!-- Встроенное меню WebView2 («Назад», «Обновить», «Проверить») питомцу ни к чему; своё меню — позже. -->
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
