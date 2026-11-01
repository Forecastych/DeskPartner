<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { draw, hitMask, IDLE, PETTED, SIZE, type Frame } from './lib/sprite';

  const FRAME_MS = 600;
  const PETTED_MS = 1500;

  let canvas: HTMLCanvasElement;
  let tick = 0;
  let pettedUntil = 0;
  let lastMask = '';

  function render() {
    const frames = Date.now() < pettedUntil ? PETTED : IDLE;
    const frame: Frame = frames[tick % frames.length];
    draw(canvas.getContext('2d')!, frame);
    // Rust пропускает клики сквозь всё, что не нарисовано, — сообщаем ему форму кадра, если она сменилась
    const mask = hitMask(frame);
    const key = mask.join(',');
    if (key !== lastMask) {
      lastMask = key;
      invoke('set_hit_mask', { rows: mask }).catch(console.error);
    }
  }

  function pet() {
    pettedUntil = Date.now() + PETTED_MS;
    render();
  }

  onMount(() => {
    render();
    const id = setInterval(() => {
      tick++;
      render();
    }, FRAME_MS);
    return () => clearInterval(id);
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
