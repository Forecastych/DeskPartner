<script lang="ts">
  // Пиксельный значок из pixels.ts. Цвет — currentColor, размер клетки — `cell` CSS-пикселей.
  import { gridOf, ICONS, pixelPath, type IconName } from './pixels';

  interface Props {
    name: IconName;
    cell?: number;
  }

  let { name, cell = 2 }: Props = $props();

  const rows = $derived(ICONS[name]);
  const grid = $derived(gridOf(rows));
</script>

<svg
  width={grid.w * cell}
  height={grid.h * cell}
  viewBox="0 0 {grid.w} {grid.h}"
  shape-rendering="crispEdges"
  aria-hidden="true"
  focusable="false"
>
  <path d={pixelPath(rows)} fill="currentColor" />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
