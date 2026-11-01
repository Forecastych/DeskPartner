<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import * as roam from './lib/roam';
  import { bowlFrame, draw, hitMask, SIZE } from './lib/sprite';

  /** Мониторы меняются редко: подключили второй, сдвинули панель задач. Раз в пару секунд хватает. */
  const WORLD_MS = 2000;

  /** Что пишет окно кошки: сколько корма насыпано. Голод и кормушку считает оно, миска только рисует. */
  interface BowlState {
    portions: number;
  }

  let canvas: HTMLCanvasElement;
  let portions = 0;
  let lastPlace = '';
  let lastMask = '';

  function render() {
    const frame = bowlFrame(portions);
    draw(canvas.getContext('2d')!, frame);
    const key = hitMask(frame).join(',');
    if (key === lastMask) return;
    lastMask = key;
    invoke('set_hit_mask', { rows: hitMask(frame) }).catch(console.error);
  }

  /** Встать в угол основного монитора: низ окна — на пол, как и у кошки, что придёт есть. */
  async function place() {
    try {
      const world = await invoke<roam.World>('world');
      const at = roam.bowlAt(world);
      if (!at) return;
      const floor = roam.surfaces(world).find((s) => s.id === at.surface)!;
      const pos = { x: Math.round(at.x), bottom: Math.round(floor.y) };
      const key = `${pos.x},${pos.bottom}`;
      if (key === lastPlace) return;
      lastPlace = key;
      await invoke('place_pet', pos);
    } catch (e) {
      console.error(e);
    }
  }

  // ЛКМ — насыпать, ПКМ — забрать порцию; что из этого выйдет, решает окно кошки
  function poke(e: PointerEvent) {
    emitTo('pet', 'bowl-click', { button: e.button }).catch(console.error);
  }

  onMount(() => {
    render();
    place();
    const id = setInterval(place, WORLD_MS);
    const unlisten = listen<BowlState>('bowl', (e) => {
      portions = e.payload.portions;
      render();
    });
    // окно кошки могло открыться раньше и уже всё сказать — спросим ещё раз
    emitTo('pet', 'bowl-hello').catch(console.error);
    return () => {
      clearInterval(id);
      unlisten.then((off) => off());
    };
  });
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width={SIZE} height={SIZE} onpointerdown={poke}></canvas>

<style>
  /* Та же геометрия, что у кошки: квадрат по центру окна, Rust считает попадание так же. */
  canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(100vw, 100vh);
    height: min(100vw, 100vh);
    image-rendering: pixelated;
  }
</style>
