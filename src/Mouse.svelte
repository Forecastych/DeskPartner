<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { draw, flip, MOUSE_ANIMS, SIZE } from './lib/sprite';

  /**
   * Что шлёт окно кошки каждый кадр погони или игры: где мышь или клубок (физ. px, как в place_pet)
   * и что делает; null — никого нет.
   */
  interface MouseState {
    x: number;
    bottom: number;
    anim: keyof typeof MOUSE_ANIMS;
    facing: 1 | -1;
    /** Кадр задан снаружи (клубок крутится от пройденного пути); нет — по времени. */
    frame?: number;
  }

  let canvas: HTMLCanvasElement;
  let state: MouseState | null = null;
  let lastPlace = '';
  let lastFrame = '';

  /** Кадры крутит само окно мыши: окно кошки шлёт только позу и место. */
  function render(now: number) {
    const ctx = canvas.getContext('2d')!;
    if (!state) {
      if (lastFrame) ctx.clearRect(0, 0, SIZE, SIZE);
      lastFrame = '';
      return;
    }
    const anim = MOUSE_ANIMS[state.anim];
    const i = (state.frame ?? Math.floor(now / anim.ms)) % anim.frames.length;
    const key = `${state.anim}:${i}:${state.facing}`;
    if (key === lastFrame) return;
    lastFrame = key;
    const frame = anim.frames[i];
    draw(ctx, state.facing < 0 ? flip(frame) : frame);
  }

  onMount(() => {
    // мышь не ловит кликов: всё насквозь, даже по ней самой — её ловит кошка, а не человек
    invoke('set_hit_mask', { rows: Array(SIZE).fill(0) }).catch(console.error);
    let raf = requestAnimationFrame(function loop(now) {
      render(now);
      raf = requestAnimationFrame(loop);
    });
    const unlisten = listen<MouseState | null>('mouse', (e) => {
      state = e.payload;
      if (!state) return;
      const at = { x: Math.round(state.x), bottom: Math.round(state.bottom) };
      const key = `${at.x},${at.bottom}`;
      if (key === lastPlace) return;
      lastPlace = key;
      invoke('place_pet', at).catch(console.error);
    });
    return () => {
      cancelAnimationFrame(raf);
      unlisten.then((f) => f());
    };
  });
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width={SIZE} height={SIZE}></canvas>

<style>
  /* Та же геометрия, что у кошки: квадрат по центру окна. */
  canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(100vw, 100vh);
    height: min(100vw, 100vh);
    image-rendering: pixelated;
  }
</style>
