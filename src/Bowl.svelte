<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { Placer } from './lib/fall';
  import { bowlFrame, draw, hitMask, SIZE } from './lib/sprite';

  /**
   * Что пишет окно кошки: сколько корма насыпано и где стоит миска (физ. px, как в place_pet).
   * Голод, кормушку и место считает оно, миска только рисует и встаёт куда сказали.
   */
  interface BowlState {
    portions: number;
    x: number | null;
    bottom: number | null;
    /** Упала: бросили или рамку под ней убрали. */
    fall: boolean;
  }

  let canvas: HTMLCanvasElement;
  let portions = 0;
  let lastMask = '';
  const placer = new Placer(
    (s) => void invoke('place_pet', { ...s }).catch(console.error),
    () => window.devicePixelRatio,
  );

  function render() {
    const frame = bowlFrame(portions);
    draw(canvas.getContext('2d')!, frame);
    const key = hitMask(frame).join(',');
    if (key === lastMask) return;
    lastMask = key;
    invoke('set_hit_mask', { rows: hitMask(frame) }).catch(console.error);
  }

  /**
   * ЛКМ: потащили — миска переезжает, щёлкнули — насыпать. ПКМ — забрать порцию.
   * Что из этого выйдет и куда миска упадёт, решает окно кошки.
   */
  async function poke(e: PointerEvent) {
    if (e.button !== 0) return void emitTo('pet', 'bowl-click', { button: e.button }).catch(console.error);
    let drop: { x: number; bottom: number } | null = null;
    try {
      placer.grab();
      drop = await invoke<{ x: number; bottom: number } | null>('drag_window', { grab: null });
    } catch (err) {
      console.error(err);
    } finally {
      placer.release(drop);
    }
    if (drop) emitTo('pet', 'bowl-drop', drop).catch(console.error);
    else emitTo('pet', 'bowl-click', { button: 0 }).catch(console.error);
  }

  onMount(() => {
    render();
    const unlisten = listen<BowlState>('bowl', (e) => {
      portions = e.payload.portions;
      render();
      const { x, bottom, fall } = e.payload;
      if (x !== null && bottom !== null) placer.go({ x, bottom }, fall);
    });
    // окно кошки могло открыться раньше и уже всё сказать — спросим ещё раз
    emitTo('pet', 'bowl-hello').catch(console.error);
    return () => {
      placer.stop();
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
