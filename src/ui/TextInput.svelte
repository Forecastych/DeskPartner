<script lang="ts">
  // Однострочное поле с подписью сверху. children встают в ряд справа — например, «Обзор…».
  // Остальные атрибуты (onchange, placeholder, aria-*) уходят прямо в <input>.
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type' | 'children'> {
    id: string;
    value: string;
    label?: string;
    /** Пути и ключи — моноширинным: так видно каждую букву. */
    mono?: boolean;
    el?: HTMLInputElement;
    children?: Snippet;
  }

  let { id, value = $bindable(''), label, mono = false, el = $bindable(), children, ...rest }: Props = $props();
</script>

<div class="field">
  {#if label}<label for={id}>{label}</label>{/if}
  <div class="row">
    <input {id} type="text" class="ui-px" class:ui-mono={mono} bind:this={el} bind:value {...rest} />
    {@render children?.()}
  </div>
</div>

<style>
  .field {
    margin: var(--ui-s1) 0 var(--ui-s3);
  }
  label {
    display: block;
    margin-bottom: 6px;
    font-weight: 600;
  }
  .row {
    display: flex;
    gap: 14px;
    align-items: center;
    padding-left: var(--ui-b);
  }
  input {
    --lift: 0px;
    --drop: transparent;
    flex: 1;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin: var(--ui-b) 0;
    padding: 6px 10px;
    border: 0;
    border-radius: 0;
    background: var(--ui-card);
    color: var(--ui-text);
    font: inherit;
    user-select: text;
  }
  /* фокус — контур цвета акцента, без системной обводки */
  input:focus {
    --edge: var(--ui-accent);
    outline: none;
  }
  input:disabled {
    opacity: 0.6;
  }
</style>
