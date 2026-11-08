<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import { Placer } from './lib/fall';
  import { t } from './lib/i18n';
  import type { MenuItem } from './lib/menu';
  import { bedFrame, bedMask, draw, litterFrame, litterMask, SIZE, type Frame } from './lib/sprite';

  // Окно вещи на полу — лежака или лотка; какой именно, говорит метка окна. События те же,
  // что у миски, с именем вещи: `bed`, `bed-drop`, `bed-grab`, `bed-hello` (и `litter-…`).
  // У лотка ещё ПКМ-меню: выбор уходит кошке событием `litter-scoop` или `litter-change`.
  const SPRITES: Record<string, [(s: ThingState) => Frame, (f: Frame) => number[]]> = {
    bed: [bedFrame, bedMask],
    litter: [(s) => litterFrame(s.clumps, s.wear), litterMask],
  };
  const me = getCurrentWebviewWindow();
  const name = me.label in SPRITES ? me.label : 'bed';
  const [frameOf, maskOf] = SPRITES[name];

  /** Что пишет окно кошки: включена ли вещь и где она стоит (физ. px, как в place_pet). */
  interface ThingState {
    on: boolean;
    x: number | null;
    bottom: number | null;
    /** Упал: бросили или рамку под ним убрали. */
    fall: boolean;
    /** Только у лотка: комочков в наполнителе и насколько он старый. */
    clumps?: number;
    wear?: number;
  }

  const NO_MASK: number[] = Array(SIZE).fill(0);

  let canvas: HTMLCanvasElement;
  let state: ThingState = { on: false, x: null, bottom: null, fall: false };
  let lastMask = '';
  const placer = new Placer(
    (s) => void invoke('place_pet', { ...s }).catch(console.error),
    () => window.devicePixelRatio,
  );

  function render() {
    const ctx = canvas.getContext('2d')!;
    let mask = NO_MASK;
    if (state.on) {
      const frame = frameOf(state);
      draw(ctx, frame);
      mask = maskOf(frame);
    } else ctx.clearRect(0, 0, SIZE, SIZE);
    const key = mask.join(',');
    if (key === lastMask) return;
    lastMask = key;
    invoke('set_hit_mask', { rows: mask }).catch(console.error);
  }

  /** ПКМ по лотку: вычерпать комочки или сменить наполнитель целиком. Меню у курсора (menu.rs). */
  function openMenu() {
    const clumps = state.clumps ?? 0;
    const items: MenuItem[] = [
      { id: 'scoop', text: t('Убрать лоток', 'Scoop the box'), hint: clumps ? t('вычерпать комочки', 'take the clumps out') : t('пока чисто', 'clean so far'), disabled: !clumps },
      { id: 'change', text: t('Поменять лоток', 'Change the litter'), hint: t('весь наполнитель на свежий', 'all fresh litter'), disabled: !clumps && !state.wear },
    ];
    invoke('open_menu', { owner: name, items }).catch(console.error);
  }

  /** ЛКМ тащит вещь; куда она упадёт, решает окно кошки. Щелчок ничего не делает, ПКМ — меню лотка. */
  async function poke(e: PointerEvent) {
    if (e.button === 2 && name === 'litter' && state.on) return openMenu();
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
    if (drop) emitTo('pet', `${name}-drop`, drop).catch(console.error);
  }

  onMount(() => {
    render();
    const unlisten = listen<ThingState>(name, (e) => {
      state = e.payload;
      render();
      const { on, x, bottom, fall } = state;
      if (on && x !== null && bottom !== null) placer.go({ x, bottom }, fall);
    });
    // выбор в меню лотка Rust шлёт окну-владельцу, то есть сюда
    const unpick = me.listen<{ id: string }>('menu-pick', (e) => {
      if (e.payload.id === 'scoop' || e.payload.id === 'change') emitTo('pet', `${name}-${e.payload.id}`).catch(console.error);
    });
    // вещь выдернули из-под кошки (лежак — проснётся, лоток — передумает); слушаем своим окном: Rust шлёт сюда
    const ungrab = me.listen('drag-start', () => {
      emitTo('pet', `${name}-grab`).catch(console.error);
    });
    // окно кошки могло открыться раньше и уже всё сказать — спросим ещё раз
    emitTo('pet', `${name}-hello`).catch(console.error);
    return () => {
      placer.stop();
      for (const off of [unlisten, ungrab, unpick]) off.then((f) => f());
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
