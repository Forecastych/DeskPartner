<script lang="ts">
  // Кнопка: primary — главное действие окна, secondary — всё остальное, link — ссылка в тексте.
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'link';
    /** Сама кнопка — чтобы вернуть на неё фокус после ошибки. */
    el?: HTMLButtonElement;
  }

  let { variant = 'secondary', el = $bindable(), type = 'button', children, ...rest }: Props = $props();
</script>

<button bind:this={el} {type} class={['btn', variant, variant !== 'link' && 'ui-px']} {...rest}>
  {@render children?.()}
</button>

<style>
  .btn {
    padding: 6px 16px;
    border: 0;
    border-radius: 0;
    font: 700 13px/1.4 var(--ui-font-pixel);
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  /* нажатие: кнопка садится на свою тень */
  .ui-px:active:not(:disabled) {
    --lift: 0px;
    transform: translate(var(--ui-lift), var(--ui-lift));
  }
  .btn:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: calc(var(--ui-b) + 3px);
  }

  .primary {
    min-width: 96px;
    background: linear-gradient(to top, var(--ui-accent-lo) 0 var(--ui-b), var(--ui-accent) var(--ui-b));
    color: var(--ui-on-accent);
  }
  .primary:hover:not(:disabled) {
    background: linear-gradient(to top, var(--ui-accent) 0 var(--ui-b), var(--ui-accent-hi) var(--ui-b));
  }

  .secondary {
    background: linear-gradient(to top, var(--ui-line) 0 var(--ui-b), var(--ui-card) var(--ui-b));
    color: var(--ui-text);
  }
  .secondary:hover:not(:disabled) {
    background: linear-gradient(to top, var(--ui-line) 0 var(--ui-b), var(--ui-soft) var(--ui-b));
  }

  .link {
    padding: 0;
    background: none;
    color: var(--ui-accent);
    font: inherit;
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }
  .link:focus-visible {
    outline-offset: 2px;
  }
</style>
