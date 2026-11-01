<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { ANIMS, draw, fatOn, hitMask, SIZE, type AnimName } from './lib/sprite';

  const PETTED_MS = 1500;
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
  let lastMask = '';
  let timer: ReturnType<typeof setTimeout>;

  function choose(): AnimName {
    if (Date.now() < pettedUntil) return 'petted';
    return humanIdle ? 'sleep' : 'sit';
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
