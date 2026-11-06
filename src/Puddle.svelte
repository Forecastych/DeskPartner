<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { draw, PUDDLE_FRAMES, SIZE } from './lib/sprite';

  /**
   * Лужа мести (src/lib/revenge.ts). Только картинка: окно прозрачно для мыши целиком (Rust,
   * revenge.rs, ставит его так при создании), фокуса не берёт и всегда спрятано от записи экрана.
   * Окно кошки шлёт середину и низ лужи (физ. px, как в place_pet) и кадр; null — лужи нет.
   * Сама лужа ничего не знает ни об окне, на котором «лежит», ни о его содержимом.
   */
  interface PuddleState {
    x: number;
    bottom: number;
    frame: number;
  }

  let canvas: HTMLCanvasElement;
  let lastPlace = '';
  let lastFrame = -1;

  function show(state: PuddleState | null) {
    const ctx = canvas.getContext('2d')!;
    const frame = state ? PUDDLE_FRAMES[state.frame] : undefined;
    if (!state || !frame) {
      if (lastFrame >= 0) ctx.clearRect(0, 0, SIZE, SIZE);
      lastFrame = -1;
      return;
    }
    // сначала переставить, потом рисовать: новая лужа не мелькнёт на месте старой
    const key = `${state.x},${state.bottom}`;
    if (key !== lastPlace) {
      lastPlace = key;
      invoke('place_pet', { x: state.x, bottom: state.bottom }).catch(console.error);
    }
    if (state.frame === lastFrame) return;
    lastFrame = state.frame;
    // draw чистит холст сам; полупрозрачные клетки не копятся
    draw(ctx, frame);
  }

  onMount(() => {
    const unlisten = listen<PuddleState | null>('puddle', (e) => show(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  });
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width={SIZE} height={SIZE}></canvas>

<style>
  /* Та же геометрия, что у кошки и мыши: квадрат по центру окна. */
  canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(100vw, 100vh);
    height: min(100vw, 100vh);
    image-rendering: pixelated;
  }
</style>
