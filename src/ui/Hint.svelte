<script lang="ts">
  // Текст-пояснение. muted — серая приписка, note — плашка «обрати внимание» (может держать
  // кнопку), error — ошибка в красной рамке; диктор читает её сразу.
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'muted' | 'note' | 'error';
    id?: string;
    /** Для плашки, которая появляется по ходу дела: status — диктор прочитает её без фокуса. */
    role?: 'status' | 'alert';
    children: Snippet;
  }

  let { tone = 'muted', id, role, children }: Props = $props();
</script>

{#if tone === 'note'}
  <div {id} class="note ui-px" {role}>{@render children()}</div>
{:else if tone === 'error'}
  <p {id} class="error ui-px" role={role ?? 'alert'}>{@render children()}</p>
{:else}
  <p {id} class="muted" {role}>{@render children()}</p>
{/if}

<style>
  .muted {
    margin: var(--ui-s2) 0 14px;
    color: var(--ui-muted);
  }
  .note,
  .error {
    --lift: 0px;
    margin: var(--ui-s3) var(--ui-b) var(--ui-s3);
    padding: var(--ui-s2) var(--ui-s3);
    user-select: text;
  }
  .note {
    --edge: var(--ui-line);
    --drop: transparent;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
    background: var(--ui-soft);
  }
  .error {
    --edge: var(--ui-danger);
    --drop: transparent;
    background: var(--ui-danger-bg);
    color: var(--ui-danger);
  }
</style>
