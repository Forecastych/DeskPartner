<script lang="ts">
  // Занос лазерной точки: Rust снял кусок экрана вокруг крутого разворота (laser.rs), здесь этот
  // снимок рисуется поверх того же места и на полсекунды «отбрасывается» по ходу точки, а потом
  // пружинит обратно. Пиксели живут только в этом окне и только пока идёт эффект.
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { DURATION_MS, envelope, field, render, type Shot } from './lib/push';

  let canvas: HTMLCanvasElement;
  /** Какой эффект сейчас главный: новый разворот обрывает старый. */
  let current = 0;
  /** Окно показано (push_show прошёл, push_done ещё нет). */
  let shown = false;

  const frame = () => new Promise<number>((done) => requestAnimationFrame(done));

  /** Холст — пиксель в пиксель с экраном: CSS-размер делим на масштаб монитора. */
  function fit(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    const cw = `${w / dpr}px`;
    const ch = `${h / dpr}px`;
    if (canvas.style.width !== cw) canvas.style.width = cw;
    if (canvas.style.height !== ch) canvas.style.height = ch;
  }

  async function play(shot: Shot) {
    const id = shot.id;
    current = id;
    const ctx = canvas.getContext('2d')!;
    try {
      // старый эффект ещё на экране — сначала стереть, чтобы он не мелькнул на новом месте
      if (shown) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await frame();
        if (current !== id) return;
      }
      const { width: w, height: h } = shot;
      const buf = await invoke<ArrayBuffer>('push_pixels', { id });
      if (current !== id) return;
      if (buf.byteLength !== w * h * 4) throw new Error(`снимок ${buf.byteLength} байт вместо ${w * h * 4}`);
      let src: Uint8ClampedArray | null = new Uint8ClampedArray(buf);
      let img: ImageData | null = new ImageData(w, h);
      const f = field(shot);
      canvas.width = w; // заодно очищает холст
      canvas.height = h;
      fit(w, h);
      // окно показываем ещё прозрачным: под ним тот же экран, что на снимке, так что ничего
      // не мелькнёт, даже если первый кадр опоздает
      await invoke('push_show', { id });
      shown = true;
      if (current !== id) return;
      const t0 = performance.now();
      for (;;) {
        const t = (await frame()) - t0;
        if (current !== id) return;
        if (t >= DURATION_MS) break;
        fit(w, h);
        render(src, img.data, w, h, f, envelope(t));
        ctx.putImageData(img, 0, 0);
      }
      // снимок больше не нужен: стереть, отпустить и только потом прятать окно
      ctx.clearRect(0, 0, w, h);
      src = null;
      img = null;
      await frame();
      await frame();
      if (current !== id) return;
      await invoke('push_done', { id });
      shown = false;
    } catch (e) {
      console.error(e);
      if (current === id && shown) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        invoke('push_done', { id }).catch(console.error);
        shown = false;
      }
    }
  }

  onMount(() => {
    const unlisten = listen<Shot>('push', (e) => {
      play(e.payload);
    });
    return () => {
      unlisten.then((off) => off());
    };
  });
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<canvas bind:this={canvas} width="1" height="1"></canvas>

<style>
  /* Левый верхний угол — в угол окна: Rust ставит окно ровно на снятое место. */
  canvas {
    position: absolute;
    left: 0;
    top: 0;
    display: block;
    image-rendering: pixelated;
    pointer-events: none;
  }
</style>
