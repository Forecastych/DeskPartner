<script lang="ts">
  // Окно «Статистика»: только смотреть. Цифры копит окно кошки; сразу показываем то, что лежит
  // в файле, а пока окно открыто — раз в пару секунд спрашиваем у кошки свежие.
  // Вкладка «Дневник» — записи кошки о прошедших днях (lib/diary), свежие сверху.
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import { dayKey } from './lib/chatter';
  import * as diary from './lib/diary';
  import * as awards from './lib/awards';
  import * as holidays from './lib/holidays';
  import { t } from './lib/i18n';
  import { parse } from './lib/settings';
  import { ANIMS, draw, dress, type Frame } from './lib/sprite';
  import * as tally from './lib/stats';
  import type { Wear } from './lib/wardrobe';
  import { Button, Dialog, Hint, Icon, Radio, Section } from './ui';

  /** Как часто спрашивать кошку, пока окно открыто. */
  const ASK_MS = 2000;
  const DAY_MS = 86_400_000;

  const win = getCurrentWebviewWindow();

  let stats = $state<tally.Stats | null>(null);
  let now = $state(Date.now());
  let name = $state('');
  let tab = $state<'stats' | 'diary'>('stats');
  /** Записи дневника, свежие сверху. */
  let pages = $state<diary.Facts[]>([]);
  /** Сегодняшний день так, как он идёт сейчас; null — кошка ещё не ответила. */
  let draft = $state<diary.Facts | null>(null);
  /** Какую запись листаем: 0 — самая свежая. */
  let at = $state(0);
  /** Кошка ответила: дальше файл не нужен, он отстаёт до сохранения. */
  let live = false;

  const groups = $derived(stats ? tally.groups(stats, now) : []);
  const todayKey = $derived(dayKey(new Date(now)));
  // Сегодняшняя запись видна вечером, а пока записей нет совсем — сразу: видно, что дневник ведётся
  const shown = $derived.by(() => {
    const evening = new Date(now).getHours() >= diary.EVENING || pages.length === 0;
    const today = draft && draft.day === todayKey && evening && diary.worth(draft) ? [draft] : [];
    return [...today, ...pages.filter((p) => p.day !== todayKey)];
  });
  const page = $derived(shown[Math.min(at, shown.length - 1)] ?? null);

  function when(day: string): string {
    if (day === todayKey) return t('Сегодня · ещё пишется', 'Today · still writing');
    if (day === dayKey(new Date(now - DAY_MS))) return t('Вчера', 'Yesterday');
    return diary.title(day, todayKey);
  }

  /** Достижения: из файла, потом от кошки вместе со статистикой. */
  let prize = $state<awards.Prize | null>(null);
  const board = $derived(stats && prize ? awards.board(prize, stats, now) : null);
  const own = $derived(prize ? awards.wardrobe(prize) : []);
  /** В радиокнопках «сама» — строка: null в group не положить. */
  let choice = $state<Wear | 'none' | 'auto'>('auto');
  /** Праздничный наряд сейчас важнее выбранного — сказать об этом под выбором. */
  const holiday = $derived(holidays.outfit(new Date(now)) !== null);

  const SIT: Frame = ANIMS[0].sit.frames[0];

  /** Кошка в наряде на маленьком холсте: пиксели 1:1, увеличивает CSS. */
  function paint(canvas: HTMLCanvasElement, frame: Frame) {
    const put = (f: Frame) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, f);
    };
    put(frame);
    return { update: put };
  }

  function wear() {
    if (!prize) return;
    const c = choice === 'auto' ? null : choice;
    prize = awards.choose(prize, c);
    emitTo('pet', 'wear', c).catch(console.error);
  }

  function takePrize(p: awards.Prize) {
    prize = p;
    choice = p.wear ?? 'auto';
  }

  onMount(() => {
    invoke<string | null>('load_state', { key: 'settings' })
      .then((raw) => (name = parse(raw).name))
      .catch(console.error);
    invoke<string | null>('load_state', { key: 'stats' })
      .then((raw) => {
        if (!live) stats = tally.load(raw, Date.now());
      })
      .catch(console.error);
    invoke<string | null>('load_state', { key: 'diary' })
      .then((raw) => {
        if (!live) pages = diary.loadList(raw);
      })
      .catch(console.error);
    // своим окном: глобальный listen поймал бы и чужие 'stats'
    const off = win.listen<tally.Stats>('stats', (e) => {
      live = true;
      now = Date.now();
      stats = tally.load(JSON.stringify(e.payload), now);
    });
    const offDiary = win.listen<{ today: unknown; pages: unknown }>('diary', (e) => {
      live = true;
      draft = diary.clean(e.payload.today);
      pages = diary.loadList(JSON.stringify(e.payload.pages));
    });
    invoke<string | null>('load_state', { key: 'awards' })
      .then((raw) => {
        if (!prize) takePrize(awards.load(raw));
      })
      .catch(console.error);
    const offAwards = win.listen<awards.Prize>('awards', (e) => takePrize(awards.load(JSON.stringify(e.payload))));
    const ask = () => emitTo('pet', 'stats-ask').catch(console.error);
    ask();
    const id = setInterval(ask, ASK_MS);
    return () => {
      clearInterval(id);
      off.then((f) => f());
      offDiary.then((f) => f());
      offAwards.then((f) => f());
    };
  });
</script>

{#snippet tabs()}
  <div class="tabs" role="tablist" aria-label={t('Разделы', 'Sections')}>
    <button type="button" role="tab" class="tab ui-px" aria-selected={tab === 'stats'} onclick={() => (tab = 'stats')}>{t('Цифры', 'Numbers')}</button>
    <button type="button" role="tab" class="tab ui-px" aria-selected={tab === 'diary'} onclick={() => (tab = 'diary')}>{t('Дневник', 'Diary')}</button>
  </div>
{/snippet}

<Dialog title={name ? `${name}: ${t('статистика', 'stats')}` : t('Статистика', 'Stats')} header={tabs}>
  {#if tab === 'diary'}
    {#if page}
      <article class="page ui-px" aria-live="polite">
        <h2>{when(page.day)}</h2>
        <p>{diary.write(page)}</p>
        <span class="sign"><Icon name="paw" cell={2} />{name || t('кошка', 'the cat')}</span>
      </article>
      {#if shown.length > 1}
        <nav class="pager" aria-label={t('Листать дневник', 'Turn the pages')}>
          <Button disabled={at >= shown.length - 1} onclick={() => (at = Math.min(at + 1, shown.length - 1))}>‹ {t('Раньше', 'Older')}</Button>
          <span class="count">{t(`${at + 1} из ${shown.length}`, `${at + 1} of ${shown.length}`)}</span>
          <Button disabled={at === 0} onclick={() => (at = Math.max(at - 1, 0))}>{t('Позже', 'Newer')} ›</Button>
        </nav>
      {/if}
    {:else}
      <Hint tone="note">{t('Первая запись появится, когда кончится день: кошка пишет дневник по вечерам.', 'The first entry appears when the day is over: the cat writes in her diary in the evening.')}</Hint>
    {/if}
    <Hint>
      {t(
        `В дневник попадают только названия программ, без заголовков окон и файлов. Хранятся последние ${diary.KEEP} дней, только на этом компьютере.`,
        `The diary only mentions program names, never window titles or files. The last ${diary.KEEP} days are kept, on this computer only.`,
      )}
    </Hint>
  {:else if stats}
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
    {#if board}
      <Section title={t('Достижения', 'Achievements')} rule>
        {#if board.got.length}
          <ul class="awards">
            {#each board.got as a (a.id)}
              <li class="award ui-px">
                <span class="medal ui-px" aria-hidden="true"></span>
                <span class="what">
                  <b>{a.title}</b>
                  <small>{a.about}{#if a.wear} · {awards.wearName(a.wear)}{/if}</small>
                </span>
                <small class="when">{tally.date(a.at)}</small>
              </li>
            {/each}
          </ul>
        {:else}
          <Hint>{t('Пока ни одного — первое совсем близко.', 'None yet, but the first one is close.')}</Hint>
        {/if}
        {#if board.next.length}
          <h3>{t('Следующие', 'Up next')}</h3>
          <ul class="awards">
            {#each board.next as a (a.id)}
              <li class="award next ui-px">
                <span class="medal ui-px" aria-hidden="true"></span>
                <span class="what">
                  <b>{a.title}</b>
                  <small>{a.about}{#if a.wear} · {awards.wearName(a.wear)}{/if}</small>
                  <span class="meter ui-px" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(a.meter * 100)} aria-label={a.title}>
                    <i style:width="{Math.round(a.meter * 100)}%"></i>
                  </span>
                </span>
                <small class="when">{a.progress}</small>
              </li>
            {/each}
          </ul>
          {#if board.left > 0}
            <Hint>{t(`И ещё ${board.left} впереди.`, `${board.left} more ahead.`)}</Hint>
          {/if}
        {/if}
      </Section>
      {#if own.length}
        <Section title={t('Наряд', 'Outfit')} rule>
          <div class="wardrobe">
            <Radio variant="card" name="wear" value="auto" bind:group={choice} onchange={wear} hint={t('новый наряд', 'newest')}>
              <canvas class="cat" width="32" height="32" use:paint={dress(SIT, prize ? awards.worn({ ...prize, wear: null }) : null)}></canvas>
              {t('Сама', 'Auto')}
            </Radio>
            <Radio variant="card" name="wear" value="none" bind:group={choice} onchange={wear}>
              <canvas class="cat" width="32" height="32" use:paint={SIT}></canvas>
              {t('Без наряда', 'None')}
            </Radio>
            {#each own as w (w)}
              <Radio variant="card" name="wear" value={w} bind:group={choice} onchange={wear}>
                <canvas class="cat" width="32" height="32" use:paint={dress(SIT, w)}></canvas>
                {awards.wearName(w)}
              </Radio>
            {/each}
          </div>
          {#if holiday}
            <Hint>{t('Сегодня праздник — кошка в праздничном наряде, выбранный подождёт.', "It's a holiday: the festive outfit comes first, yours will wait.")}</Hint>
          {/if}
        </Section>
      {/if}
    {/if}
    <Hint>{t('Цифры живут только в папке данных на этом компьютере и никуда не отправляются.', 'These numbers live only in the data folder on this computer and are never sent anywhere.')}</Hint>
  {:else}
    <Hint>{t('Считаем…', 'Counting…')}</Hint>
  {/if}
</Dialog>

<style>
  .tabs {
    display: flex;
    gap: calc(var(--ui-s3) + var(--ui-b));
    padding: 0 var(--ui-b);
  }
  .tab {
    --lift: 0px;
    --edge: var(--ui-line);
    padding: 4px 14px;
    border: 0;
    background: var(--ui-card);
    color: var(--ui-muted);
    font: 700 13px/1.4 var(--ui-font-pixel);
    cursor: pointer;
  }
  .tab[aria-selected='true'] {
    --edge: var(--ui-ink);
    --lift: var(--ui-lift);
    background: var(--ui-accent);
    color: var(--ui-on-accent);
  }
  .tab:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: calc(var(--ui-b) + 3px);
  }

  .page {
    margin: var(--ui-s3) var(--ui-b) var(--ui-s4);
    padding: var(--ui-s3) var(--ui-s4) var(--ui-s4);
    background: var(--ui-card);
    /* тетрадная линейка: строки текста ложатся на неё */
    background-image: repeating-linear-gradient(transparent 0 25px, var(--ui-line) 25px 26px);
    background-position: 0 calc(var(--ui-s3) + 31px);
    user-select: text;
  }
  .page h2 {
    margin: 0 0 var(--ui-s1);
    color: var(--ui-accent-lo);
    font: 700 15px/26px var(--ui-font-pixel);
  }
  .page p {
    margin: 0;
    font-size: 15px;
    line-height: 26px;
  }
  .sign {
    display: flex;
    gap: var(--ui-s2);
    align-items: center;
    justify-content: flex-end;
    color: var(--ui-muted);
    font: 700 13px/26px var(--ui-font-pixel);
  }
  .pager {
    display: flex;
    gap: var(--ui-s3);
    align-items: center;
    justify-content: space-between;
    margin: 0 var(--ui-b) var(--ui-s3);
  }
  .count {
    color: var(--ui-muted);
    font: 700 13px var(--ui-font-pixel);
  }

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
  h3 {
    margin: var(--ui-s3) var(--ui-b) var(--ui-s2);
    color: var(--ui-muted);
    font: 700 12px var(--ui-font-pixel);
  }
  .awards {
    display: flex;
    flex-direction: column;
    gap: calc(var(--ui-s2) + var(--ui-b));
    margin: 0 var(--ui-b) var(--ui-s3);
    padding: 0;
    list-style: none;
  }
  .award {
    display: flex;
    gap: var(--ui-s3);
    align-items: center;
    min-width: 0;
    padding: var(--ui-s2) var(--ui-s3);
    background: var(--ui-card);
  }
  /* пиксельная медалька: полученная — цветом, следующая — пустая */
  .medal {
    --lift: 0px;
    flex: none;
    width: var(--ui-s3);
    height: var(--ui-s3);
    background: var(--ui-accent);
  }
  .next .medal {
    --edge: var(--ui-line);
    background: var(--ui-soft);
  }
  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .what b {
    font: 700 14px var(--ui-font-pixel);
  }
  .what small,
  .when {
    color: var(--ui-muted);
    font-size: 12px;
  }
  .when {
    flex: none;
    text-align: right;
    white-space: nowrap;
  }
  .wardrobe {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: var(--ui-b) calc(var(--ui-b) * 2 + var(--ui-lift)) calc(var(--ui-b) * 2 + var(--ui-lift)) var(--ui-b);
  }
  .wardrobe :global(.card) {
    flex: 0 1 96px;
    min-width: 84px;
  }
  .cat {
    display: block;
    width: 64px;
    height: 64px;
    margin: 0 auto var(--ui-s1);
    image-rendering: pixelated;
  }
  @media (prefers-color-scheme: dark) {
    .value,
    .page h2 {
      color: var(--ui-accent);
    }
  }
</style>
