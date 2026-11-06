<script lang="ts">
  // Окно «Статистика»: только смотреть. Цифры копит окно кошки; сразу показываем то, что лежит
  // в файле, а пока окно открыто — раз в пару секунд спрашиваем у кошки свежие.
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import { t } from './lib/i18n';
  import { parse } from './lib/settings';
  import * as tally from './lib/stats';
  import { Dialog, Hint, Section } from './ui';

  /** Как часто спрашивать кошку, пока окно открыто. */
  const ASK_MS = 2000;

  const win = getCurrentWebviewWindow();

  let stats = $state<tally.Stats | null>(null);
  let now = $state(Date.now());
  let name = $state('');
  /** Кошка ответила: дальше файл не нужен, он отстаёт до сохранения. */
  let live = false;

  const groups = $derived(stats ? tally.groups(stats, now) : []);

  onMount(() => {
    invoke<string | null>('load_state', { key: 'settings' })
      .then((raw) => (name = parse(raw).name))
      .catch(console.error);
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

<Dialog title={name ? `${name}: ${t('статистика', 'stats')}` : t('Статистика', 'Stats')}>
  {#if stats}
    {#each groups as g, i (g.title)}
      <Section title={g.title} rule={i > 0}>
        <dl>
          {#each g.rows as r (r.label)}
            <div class="cell ui-px">
              <dt>{r.label}</dt>
              <dd>
                <span class="value">{r.value}</span>
                {#if r.meter !== undefined}
                  <span class="meter ui-px" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(r.meter * 100)} aria-label={r.label}>
                    <i style:width="{Math.round(Math.min(Math.max(r.meter, 0), 1) * 100)}%"></i>
                  </span>
                {/if}
                {#if r.hint}<span class="hint">{r.hint}</span>{/if}
              </dd>
            </div>
          {/each}
        </dl>
      </Section>
    {/each}
    <Hint>{t('Цифры живут только в папке данных на этом компьютере и никуда не отправляются.', 'These numbers live only in the data folder on this computer and are never sent anywhere.')}</Hint>
  {:else}
    <Hint>{t('Считаем…', 'Counting…')}</Hint>
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
    min-width: 0;
    overflow-wrap: anywhere;
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
  .meter {
    display: block;
    height: var(--ui-s2);
    margin: var(--ui-s1) 0;
    background: var(--ui-soft);
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--ui-accent);
  }
  @media (prefers-color-scheme: dark) {
    .value {
      color: var(--ui-accent);
    }
  }
</style>
