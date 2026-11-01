<script lang="ts">
  // Галочка. row — пиксельный квадратик с подписью и пояснением, chip — плашка из ряда
  // «можно несколько». Сам <input> спрятан, но не display:none: иначе до него не дойти с клавиатуры.
  // Событие change всплывает как от обычного поля — окна на нём строят автосохранение.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    checked?: boolean;
    disabled?: boolean;
    variant?: 'row' | 'chip';
    /** Пояснение мелким шрифтом под подписью; диктор прочитает его вместе с галочкой. */
    hint?: string;
    value?: string;
    children: Snippet;
  }

  let { checked = $bindable(false), disabled = false, variant = 'row', hint, value, children }: Props = $props();

  const id = $props.id();
</script>

<label class={['check', variant, variant === 'chip' && 'ui-px']} class:on={checked} class:off={disabled} class:has-hint={hint}>
  <input type="checkbox" bind:checked {value} {disabled} aria-describedby={hint ? `${id}-hint` : undefined} />
  {#if variant === 'row'}
    <span class="box ui-px" aria-hidden="true">
      {#if checked}<Icon name="tick" />{/if}
    </span>
  {/if}
  <span class="text">
    <span class="label">{@render children()}</span>
    {#if hint}<small id="{id}-hint">{hint}</small>{/if}
  </span>
</label>

<style>
  .check {
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

  .row {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 10px 0;
  }
  .box {
    --lift: 2px;
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    margin: 4px 0 0 var(--ui-b);
    background: var(--ui-card);
    color: var(--ui-on-accent);
  }
  .on .box {
    background: var(--ui-accent);
  }
  .row:hover:not(.off) .box {
    --edge: var(--ui-accent);
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

  /* Плашка: выбранная заливается цветом, как нажатая кнопка */
  .chip {
    --edge: var(--ui-line);
    --lift: 0px;
    --drop: transparent;
    padding: 4px 12px;
    background: var(--ui-card);
  }
  .chip:hover:not(.off) {
    --edge: var(--ui-accent);
  }
  .chip.on {
    --edge: var(--ui-ink);
    background: var(--ui-accent);
    color: var(--ui-on-accent);
  }

  .check:has(:focus-visible) .box,
  .chip:has(:focus-visible) {
    outline: 2px solid var(--ui-accent);
    outline-offset: calc(var(--ui-b) + 2px);
  }
</style>
