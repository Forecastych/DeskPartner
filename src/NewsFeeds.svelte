<script lang="ts">
  // Раздел «Новости» в настройках: какие ленты качаются для выбранных тем, когда обновились,
  // отвечают ли и сколько новостей в запасе. Rust (news_status) спрашиваем раз в несколько секунд,
  // пока окно открыто: так видно, как ленты новой темы скачались сразу после галочки.
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { feedState, newsStatus, newsSummary, type NewsStatus } from './lib/news';
  import { Button, Hint } from './ui';

  /** Как часто переспрашивать статус. */
  const POLL_MS = 5000;
  /** После «Обновить сейчас» — спросить вскоре: поток уже проснулся. */
  const SOON_MS = 700;

  let status = $state<NewsStatus | null>(null);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  async function poll() {
    clearTimeout(timer);
    const st = await newsStatus(invoke);
    if (!alive) return;
    failed = st === null;
    if (st) status = st;
    timer = setTimeout(poll, POLL_MS);
  }

  function refresh() {
    invoke('news_refresh').catch(console.error);
    if (status) status = { ...status, busy: true };
    clearTimeout(timer);
    timer = setTimeout(poll, SOON_MS);
  }

  onMount(() => {
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  });
</script>

{#if failed && !status}
  <Hint tone="error">Не удалось узнать, как дела у лент.</Hint>
{:else if status}
  <p>{newsSummary(status)}</p>
  {#if status.feeds.length}
    <ul class="feeds">
      {#each status.feeds as f (f.source + f.topics.join())}
        <li>
          <span class="name">{f.source}{f.lang === 'en' ? ' (англ.)' : ''}</span>
          <span class="topics">— {f.topics.join(', ')}</span>
          <span class="state" class:bad={f.ok === false}>{feedState(f, status.now, status.busy)}</span>
        </li>
      {/each}
    </ul>
    <Hint>
      Под новостью в облачке есть «Ещё» и «Мимо»: тема и источник будут попадаться чаще или реже.
    </Hint>
    <Button onclick={refresh} disabled={status.busy}>{status.busy ? 'Обновляются…' : 'Обновить сейчас'}</Button>
  {/if}
{/if}

<style>
  .feeds {
    margin: 0 0 var(--ui-s2);
    padding: 0;
    list-style: none;
  }
  li {
    padding: var(--ui-s1) 0;
    border-bottom: 1px solid var(--ui-line);
  }
  li:last-child {
    border-bottom: 0;
  }
  .name {
    font-weight: 700;
  }
  .topics {
    color: var(--ui-muted);
  }
  .state {
    display: block;
    color: var(--ui-muted);
    font-size: 13px;
  }
  .bad {
    color: var(--ui-danger);
  }
</style>
