<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { feedBowl, fresh, isHungry, load, refill, save, step, takeOut, type Belly } from './lib/hunger';
  import { ANIMS, draw, fatOn, hitMask, onBowl, SIZE, type AnimName, type Frame } from './lib/sprite';

  const PETTED_MS = 1500;
  /** Поза отдыха держится от 2 до 5 минут, потом кошка может перелечь. */
  const REST_MIN_MS = 2 * 60_000;
  const REST_MAX_MS = 5 * 60_000;
  /** Позы отдыха с весами: чаще сидит, иногда буханкой анфас или боком. */
  const RESTS: [AnimName, number][] = [['sit', 2], ['loaf', 1], ['sideLoaf', 1]];
  /** Как засыпает: обычно калачиком, иногда уткнувшись головой в пол — анфас или боком. */
  const SLEEPS: [AnimName, number][] = [['sleep', 3], ['faceplant', 1], ['sidePlant', 1]];
  /** Проспала дольше этого — по кошачьим меркам долго, проснувшись, умывается. */
  const LONG_SLEEP_MS = 10 * 60_000;
  const GROOM_MS = 6000;
  /** Ест столько, потом умывается. */
  const EAT_MS = 8000;
  /** Уходит и возвращается за это время — растворяясь; настоящая ходьба к краю экрана будет с движением. */
  const WALK_MS = 3000;
  /** Как часто спрашивать у Rust, что делает человек. Питомцу спешить некуда. */
  const SENSES_MS = 2000;
  /** Голод пишется на диск раз в минуту и на каждом событии: упадёт программа — потеряется не больше минуты. */
  const SAVE_MS = 60_000;
  /** Пока кошки нет на экране, проверять, не вернулась ли, раз в секунду. */
  const AWAY_TICK_MS = 1000;
  const NO_MASK: number[] = Array(SIZE).fill(0);

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

  /** Галочка «Кормушка» — пока только ключ в хранилище; окно настроек будет писать сюда же. */
  const feederOn = read('feeder') === '1';
  let belly: Belly = load(read('belly'));
  const stats = loadStats();

  let canvas: HTMLCanvasElement;
  let anim: AnimName | null = 'sit';
  let frame: Frame = [];
  let tick = 0;
  let pettedUntil = 0;
  let humanIdle = false;
  let rest: AnimName = 'sit';
  let restUntil = 0;
  /** Поза сна выбирается при засыпании и держится, пока человек не вернётся. */
  let sleep: AnimName | null = null;
  let asleepSince = 0;
  let groomUntil = 0;
  let eatUntil = 0;
  /** Уходит (за едой или насовсем) или возвращается: до этого момента идёт и растворяется. */
  let walkUntil = 0;
  let lastStep = Date.now();
  let lastSave = 0;
  let lastMask = '';
  let timer: ReturnType<typeof setTimeout>;

  function persist(now: number) {
    lastSave = now;
    write('belly', save(belly));
    write('stats', JSON.stringify(stats));
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

  function walk(now: number, show: boolean) {
    walkUntil = now + WALK_MS;
    canvas.style.opacity = show ? '1' : '0';
  }

  /** Голод живёт по времени работы программы; события голода превращаются в позы. */
  function live(now: number) {
    const [next, event] = step(belly, now - lastStep, feederOn);
    lastStep = now;
    belly = next;
    if (event === 'eat') meal(now);
    if (event === 'leave' || event === 'gone') walk(now, false);
    if (event === 'return') {
      walk(now, true);
      // поела где-то там, вернулась — умывается
      groomUntil = walkUntil + GROOM_MS;
    }
    if (event || now - lastSave >= SAVE_MS) persist(now);
  }

  /** Поза на сейчас; null — кошки на экране нет. */
  function choose(now: number): AnimName | null {
    if (now < walkUntil) return 'walk';
    if (belly.gone || belly.away > 0) return null;
    if (now < pettedUntil) return 'petted';
    if (now < eatUntil) return 'eat';
    if (humanIdle) {
      if (!sleep) asleepSince = now;
      return (sleep ??= pick(SLEEPS));
    }
    if (sleep) {
      if (now - asleepSince >= LONG_SLEEP_MS) groomUntil = now + GROOM_MS;
      sleep = null;
    }
    // проснулась голодной — сначала к миске, умыться успеет потом
    if (isHungry(belly)) return 'hungry';
    if (now < groomUntil) return 'groom';
    if (now >= restUntil) {
      rest = pick(RESTS);
      restUntil = now + REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
    }
    return rest;
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
      frame = frames[tick % frames.length];
      draw(canvas.getContext('2d')!, frame);
    } else {
      frame = [];
      canvas.getContext('2d')!.clearRect(0, 0, SIZE, SIZE);
    }
    // Rust пропускает клики сквозь всё, что не нарисовано, — сообщаем ему форму кадра, если она сменилась.
    // Уходящую сквозь пальцы кошку не поймать: пока идёт и растворяется, клики проходят насквозь.
    const mask = anim && anim !== 'walk' ? hitMask(frame) : NO_MASK;
    const key = mask.join(',');
    if (key !== lastMask) {
      lastMask = key;
      invoke('set_hit_mask', { rows: mask }).catch(console.error);
    }
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
    } else if (e.button === 0) {
      pettedUntil = now + PETTED_MS;
      stats.petted++;
    }
    render();
  }

  async function sense() {
    try {
      humanIdle = (await invoke<Senses>('senses')).idle;
    } catch (e) {
      console.error(e);
    }
  }

  onMount(() => {
    canvas.style.transition = `opacity ${WALK_MS}ms linear`;
    if (belly.gone || belly.away > 0) canvas.style.opacity = '0';
    render();
    timer = setTimeout(loop, anim ? ANIMS[0][anim].ms : AWAY_TICK_MS);
    sense();
    const id = setInterval(sense, SENSES_MS);
    // «Новый котик» в трее: только взамен сбежавшего, живую кошку не подменяет; статистика остаётся
    const unlisten = listen('adopt', () => {
      if (!belly.gone) return;
      belly = fresh();
      walk(Date.now(), true);
      persist(Date.now());
      render();
    });
    return () => {
      clearTimeout(timer);
      clearInterval(id);
      unlisten.then((off) => off());
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
