<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import { Placer } from './lib/fall';
  import { bedFrame, bedMask, draw, SIZE } from './lib/sprite';

  /** Что пишет окно кошки: включён ли лежак и где он стоит (физ. px, как в place_pet). */
  interface BedState {
    on: boolean;
    x: number | null;
    bottom: number | null;
    /** Упал: бросили или рамку под ним убрали. */
    fall: boolean;
  }

  const NO_MASK: number[] = Array(SIZE).fill(0);

  let canvas: HTMLCanvasElement;
  let on = false;
  let lastMask = '';
  const placer = new Placer(
    (s) => void invoke('place_pet', { ...s }).catch(console.error),
    () => window.devicePixelRatio,
  );

  function render() {
    const ctx = canvas.getContext('2d')!;
    let mask = NO_MASK;
    if (on) {
      const frame = bedFrame();
      draw(ctx, frame);
      mask = bedMask(frame);
    } else ctx.clearRect(0, 0, SIZE, SIZE);
    const key = mask.join(',');
    if (key === lastMask) return;
    lastMask = key;
    invoke('set_hit_mask', { rows: mask }).catch(console.error);
  }

  /** ЛКМ тащит лежак; куда он упадёт, решает окно кошки. Щелчок и ПКМ ничего не делают. */
  async function poke(e: PointerEvent) {
    if (e.button !== 0) return;
    let drop: { x: number; bottom: number } | null = null;
    try {
      placer.grab();
      drop = await invoke<{ x: number; bottom: number } | null>('drag_window', { grab: null });
    } catch (err) {
      console.error(err);
    } finally {
      placer.release(drop);
    }
    if (drop) emitTo('pet', 'bed-drop', drop).catch(console.error);
  }

  onMount(() => {
    render();
    const unlisten = listen<BedState>('bed', (e) => {
      on = e.payload.on;
      render();
      const { x, bottom, fall } = e.payload;
      if (on && x !== null && bottom !== null) placer.go({ x, bottom }, fall);
    });
    // лежак выдернули из-под спящей кошки — она проснётся; слушаем своим окном: Rust шлёт сюда
    const ungrab = getCurrentWebviewWindow().listen('drag-start', () => {
      emitTo('pet', 'bed-grab').catch(console.error);
    });
    // окно кошки могло открыться раньше и уже всё сказать — спросим ещё раз
    emitTo('pet', 'bed-hello').catch(console.error);
    return () => {
      placer.stop();
      for (const off of [unlisten, ungrab]) off.then((f) => f());
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
