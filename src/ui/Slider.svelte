<script lang="ts">
  // Ползунок: пиксельная дорожка и квадратный бегунок с контуром. Был у выбора формы в настройках
  // (FormSlider), теперь общий — им же выбирают длину фокуса прямо в меню кошки и трея.
  // Остальные атрибуты (id, oninput, onwheel, aria-*) уходят прямо в <input>; input и change
  // всплывают как от обычного поля — окна на них строят автосохранение.
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type' | 'children'> {
    value: number;
    min: number;
    max: number;
    step?: number;
  }

  let { value = $bindable(), min, max, step = 1, ...rest }: Props = $props();
</script>

<input class="ui-px" type="range" {min} {max} {step} bind:value {...rest} />

<style>
  input {
    --lift: 0px;
    display: block;
    width: calc(100% - 2 * var(--ui-b));
    height: 10px;
    margin: var(--ui-s2) var(--ui-b);
    background: var(--ui-soft);
    cursor: pointer;
    appearance: none;
  }
  input:disabled {
    opacity: 0.55;
    cursor: default;
  }
  input::-webkit-slider-thumb {
    width: 14px;
    height: 22px;
    background: var(--ui-accent);
    box-shadow:
      0 calc(var(--ui-b) * -1) 0 0 var(--ui-ink),
      0 var(--ui-b) 0 0 var(--ui-ink),
      calc(var(--ui-b) * -1) 0 0 0 var(--ui-ink),
      var(--ui-b) 0 0 0 var(--ui-ink);
    appearance: none;
  }
  input:hover:not(:disabled)::-webkit-slider-thumb {
    background: var(--ui-accent-hi);
  }
  input:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: calc(var(--ui-b) + 4px);
  }
</style>
