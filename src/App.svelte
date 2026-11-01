<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { ANIMS, draw, fatOn, hitMask, SIZE, type AnimName } from './lib/sprite';

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
  /** Как часто спрашивать у Rust, что делает человек. Питомцу спешить некуда. */
  const SENSES_MS = 2000;

  /** Ответ команды `senses`; здесь только то, что уже нужно. */
  interface Senses {
    idle: boolean;
  }

  let canvas: HTMLCanvasElement;
  let anim: AnimName = 'sit';
  let tick = 0;
  let pettedUntil = 0;
  let humanIdle = false;
  let rest: AnimName = 'sit';
  let restUntil = 0;
  /** Поза сна выбирается при засыпании и держится, пока человек не вернётся. */
  let sleep: AnimName | null = null;
  let asleepSince = 0;
  let groomUntil = 0;
  let lastMask = '';
  let timer: ReturnType<typeof setTimeout>;

  function pick(options: [AnimName, number][]): AnimName {
    let r = Math.random() * options.reduce((sum, [, w]) => sum + w, 0);
    for (const [name, w] of options) if ((r -= w) < 0) return name;
    return options[0][0];
  }

  function choose(): AnimName {
    const now = Date.now();
    if (now < pettedUntil) return 'petted';
    if (humanIdle) {
      if (!sleep) asleepSince = now;
      return (sleep ??= pick(SLEEPS));
    }
    if (sleep) {
      if (now - asleepSince >= LONG_SLEEP_MS) groomUntil = now + GROOM_MS;
      sleep = null;
    }
    if (now < groomUntil) return 'groom';
    if (now >= restUntil) {
      rest = pick(RESTS);
      restUntil = now + REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
    }
    return rest;
  }

  function render() {
    const next = choose();
    if (next !== anim) {
      anim = next;
      tick = 0;
    }
    // жирок по сегодняшней дате: если комп не выключали с октября, кошка всё равно потолстеет
    const { frames } = ANIMS[fatOn(new Date())][anim];
    const frame = frames[tick % frames.length];
    draw(canvas.getContext('2d')!, frame);
    // Rust пропускает клики сквозь всё, что не нарисовано, — сообщаем ему форму кадра, если она сменилась
    const mask = hitMask(frame);
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
    timer = setTimeout(loop, ANIMS[0][anim].ms);
  }

  function pet() {
    pettedUntil = Date.now() + PETTED_MS;
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
    render();
    timer = setTimeout(loop, ANIMS[0][anim].ms);
    sense();
    const id = setInterval(sense, SENSES_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(id);
    };
  });
</script>

<!-- Встроенное меню WebView2 («Назад», «Обновить», «Проверить») питомцу ни к чему; своё меню — позже. -->
<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width={SIZE} height={SIZE} onpointerdown={pet}></canvas>

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
