<script lang="ts">
  // Окно «Статистика»: только смотреть. Цифры копит окно кошки; сразу показываем то, что лежит
  // в файле, а пока окно открыто — раз в пару секунд спрашиваем у кошки свежие.
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import * as tally from './lib/stats';
  import { Dialog, Hint, Section } from './ui';

  /** Как часто спрашивать кошку, пока окно открыто. */
  const ASK_MS = 2000;

  const win = getCurrentWebviewWindow();

  let stats = $state<tally.Stats | null>(null);
  let now = $state(Date.now());
  /** Кошка ответила: дальше файл не нужен, он отстаёт до сохранения. */
  let live = false;

  const groups = $derived(stats ? tally.groups(stats, now) : []);

  onMount(() => {
    invoke<string | null>('load_state', { key: 'stats' })
      .then((raw) => {
        if (!live) stats = tally.load(raw, Date.now());
      })
      .catch(console.error);
    // своим окном: глобальный listen поймал бы и чужие 'stats'
    const off = win.listen<tally.Stats>('stats', (e) => {
      live = true;
      now = Date.now();
      stats = tally.load(JSON.stringify(e.payload), now);
    });
    const ask = () => emitTo('pet', 'stats-ask').catch(console.error);
    ask();
    const id = setInterval(ask, ASK_MS);
    return () => {
      clearInterval(id);
      off.then((f) => f());
    };
  });
</script>

<Dialog title="Статистика">
  {#if stats}
    {#each groups as g, i (g.title)}
      <Section title={g.title} rule={i > 0}>
        <dl>
          {#each g.rows as r (r.label)}
            <div class="cell ui-px">
              <dt>{r.label}</dt>
              <dd>
                <span class="value">{r.value}</span>
                {#if r.hint}<span class="hint">{r.hint}</span>{/if}
              </dd>
            </div>
          {/each}
        </dl>
      </Section>
    {/each}
    <Hint>Цифры живут только в папке данных на этом компьютере и никуда не отправляются.</Hint>
  {:else}
    <Hint>Считаем…</Hint>
  {/if}
</Dialog>

<style>
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: calc(var(--ui-s3) + var(--ui-b));
    margin: 0 var(--ui-b) var(--ui-s3);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--ui-s1);
    padding: var(--ui-s2) var(--ui-s3);
    background: var(--ui-card);
  }
  dt {
    color: var(--ui-muted);
    font-size: 12px;
  }
  dd {
    display: flex;
    flex-direction: column;
    margin: 0;
  }
  .value {
    color: var(--ui-accent-lo);
    font: 700 18px/1.2 var(--ui-font-pixel);
  }
  .hint {
    color: var(--ui-muted);
    font-size: 12px;
  }
  @media (prefers-color-scheme: dark) {
    .value {
      color: var(--ui-accent);
    }
  }
</style>
