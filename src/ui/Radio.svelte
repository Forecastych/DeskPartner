<script lang="ts" generics="T extends string">
  // Один вариант из нескольких. row — строка с пиксельной точкой, card — карточка в ряд
  // (выбор питомца). Варианты одной группы связывает общий name, выбранное — bind:group.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    group: T;
    value: T;
    name: string;
    disabled?: boolean;
    variant?: 'row' | 'card';
    hint?: string;
    /** Зовётся после того, как group уже поменялся. */
    onchange?: () => void;
    children: Snippet;
  }

  let { group = $bindable(), value, name, disabled = false, variant = 'row', hint, onchange, children }: Props = $props();

  const id = $props.id();
  const on = $derived(group === value);

  function pick() {
    group = value;
    onchange?.();
  }
</script>

<label class={['radio', variant, variant === 'card' && 'ui-px']} class:on class:off={disabled} class:has-hint={hint}>
  <input
    type="radio"
    {name}
    {value}
    checked={on}
    {disabled}
    onchange={pick}
    aria-describedby={hint ? `${id}-hint` : undefined}
  />
  {#if variant === 'row'}
    <span class="dot ui-px" aria-hidden="true">
      {#if on}<Icon name="dot" />{/if}
    </span>
  {/if}
  <span class="text">
    <span class="label">{@render children()}</span>
    {#if hint}<small id="{id}-hint">{hint}</small>{/if}
  </span>
</label>

<style>
  .radio {
    position: relative;
    cursor: pointer;
  }
  .off {
    opacity: 0.55;
    cursor: default;
  }
  input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
  }
  .text {
    display: flex;
    flex-direction: column;
  }
  .has-hint .label {
    font-weight: 600;
  }
  small {
    color: var(--ui-muted);
    font-size: 12.5px;
  }

  .row {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 8px 10px;
  }
  .row:hover:not(.off) {
    background: var(--ui-soft);
  }
  .dot {
    --lift: 2px;
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    margin: 4px 0 0 var(--ui-b);
    background: var(--ui-card);
    color: var(--ui-accent);
  }
  .row:hover:not(.off) .dot {
    --edge: var(--ui-accent);
  }

  /* Карточка: выбранная обведена цветом и приподнята */
  .card {
    --lift: 0px;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    padding: 14px 8px;
    background: var(--ui-card);
  }
  .card .label {
    font: 700 14px var(--ui-font-pixel);
  }
  .card .text {
    align-items: center;
  }
  .card.has-hint .label {
    font-weight: 700;
  }
  .card:not(.on) {
    --edge: var(--ui-line);
  }
  .card.on {
    --edge: var(--ui-accent);
    --lift: var(--ui-lift);
    background: var(--ui-soft);
  }
  .card:hover:not(.off):not(.on) {
    --edge: var(--ui-accent-hi);
  }

  .radio:has(:focus-visible) .dot,
  .card:has(:focus-visible) {
    outline: 2px solid var(--ui-accent);
    outline-offset: calc(var(--ui-b) + 2px);
  }
</style>
