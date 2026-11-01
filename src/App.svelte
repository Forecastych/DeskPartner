<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { feedBowl, fresh, isHungry, load, refill, save, step, takeOut, type Belly } from './lib/hunger';
  import * as roam from './lib/roam';
  import * as sleepy from './lib/sleep';
  import { ANIMS, draw, fatOn, flip, ground, hitMask, onBowl, SIZE, type AnimName, type Frame } from './lib/sprite';

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

  // localStorage может бросить (запрет хранилища) — кошка тогда живёт без памяти, но живёт
  function read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function write(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(e);
    }
  }
  function loadStats(): Stats {
    try {
      const s = JSON.parse(read('stats') ?? '{}');
      return { fed: Number(s.fed) || 0, petted: Number(s.petted) || 0 };
    } catch {
      return { fed: 0, petted: 0 };
    }
  }

  /** Где кошку оставили. Без места — появится у правого края, как в первый раз. */
  function loadSpot(): roam.Spot | null {
    try {
      const s = JSON.parse(read('spot') ?? 'null');
      if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y)) return null;
      return { x: s.x, y: s.y, exit: s.exit === 1 || s.exit === -1 ? s.exit : 0 };
    } catch {
      return null;
    }
  }

  /** Галочка «Кормушка» — пока только ключ в хранилище; окно настроек будет писать сюда же. */
  const feederOn = read('feeder') === '1';
  let belly: Belly = load(read('belly'));
  let nap: sleepy.Sleep = sleepy.load(read('sleep'));
  const stats = loadStats();

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
    write('belly', save(belly));
    write('sleep', sleepy.save(nap));
    write('stats', JSON.stringify(stats));
    if (pet) write('spot', JSON.stringify(roam.spotOf(pet)));
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
    if (event === 'eat') meal(now);
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
    // проснулась голодной — сначала к миске, умыться успеет потом
    if (isHungry(belly)) return 'hungry';
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
  }

  /** У каждой анимации свой темп, поэтому таймер заводится заново на каждый кадр. */
  function loop() {
    tick++;
    render();
    timer = setTimeout(loop, anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
  }

  /**
   * Клик по кошке гладит, по миске — кормит. С кормушкой ЛКМ досыпает порцию (кошка съест её на
   * следующем кадре сама), ПКМ забирает. Без кормушки миска сытой кошке не нужна и не рисуется.
   */
  function poke(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    const now = Date.now();
    if (anim === 'hungry' && onBowl(frame, x, y)) {
      if (feederOn) {
        belly = e.button === 2 ? takeOut(belly) : refill(belly);
        if (e.button !== 2) stats.fed++;
      } else {
        const fed = feedBowl(belly);
        if (fed === belly) return;
        belly = fed;
        stats.fed++;
        meal(now);
      }
      persist(now);
    } else if (e.button === 0 && !disturb(now)) {
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
    // Сначала мир, потом первый кадр: иначе кошка мелькнёт там, где окно поставил Rust, и перепрыгнет.
    // Ставим туда, где оставили; запустили, пока она в отлучке или в обиде, — она сразу за краем.
    survey().then(() => {
      if (!alive) return;
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
    return () => {
      alive = false;
      persist(Date.now());
      clearTimeout(timer);
      clearInterval(moving);
      clearInterval(id);
      unlisten.then((off) => off());
      unshake.then((off) => off());
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
