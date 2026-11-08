<script lang="ts">
  // Окрас в карточке выбора: кошка сидит в этом окрасе, нарисована тем же draw, что и на экране.
  import { paint, palette } from './lib/coat';
  import type { Breed } from './lib/settings';
  import { ANIMS, draw, SIZE } from './lib/sprite';

  let { breed }: { breed: Breed } = $props();

  let canvas: HTMLCanvasElement;

  $effect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    draw(ctx, paint(ANIMS[0].sit.frames[0], breed), palette(breed));
  });
</script>

<canvas bind:this={canvas} width={SIZE} height={SIZE} aria-hidden="true"></canvas>

<style>
  canvas {
    display: block;
    width: 64px;
    height: 64px;
    image-rendering: pixelated;
  }
</style>
