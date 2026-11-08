<script lang="ts">
  // Выбор формы питомца в настройках (src/lib/growth.ts). Открывается моментом силы после месяца
  // чистого времени вместе; до этого — подпись, сколько осталось. Меняет только внешность.
  // Сохраняет Settings.svelte: change и input всплывают к нему (id="form" — см. typed).
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import * as growing from './lib/growth';
  import { t } from './lib/i18n';
  import { FORMS, type Form } from './lib/settings';
  import * as tally from './lib/stats';
  import { Group, Hint } from './ui';

  interface Props {
    form: Form;
    disabled?: boolean;
  }

  let { form = $bindable(), disabled = false }: Props = $props();

  const NAMES: Record<Form, string> = {
    kitten: t('малыш', 'kitten'),
    teen: t('подросток', 'teen'),
    adult: t('взрослая', 'adult'),
  };

  /** null — ещё не прочитали: ничего не показываем, чтобы подпись не мигнула ползунком. */
  let growth = $state<growing.Growth | null>(null);
  let together = $state(0);
  const left = $derived(growth ? growing.remaining(growth, together) : 0);

  onMount(() => {
    load();
    // момент силы случился, пока окно открыто: подпись сменится ползунком сразу
    const off = getCurrentWebviewWindow().listen<{ growth: string; together: number }>('growth', (e) => {
      growth = growing.load(e.payload.growth, true);
      together = e.payload.together;
    });
    return () => {
      off.then((f) => f());
    };
  });

  async function load() {
    try {
      const [g, s, b] = await Promise.all(
        (['growth', 'stats', 'belly'] as const).map((key) => invoke<string | null>('load_state', { key })),
      );
      // то же правило, что у питомца: записи о росте нет, а прошлое есть — кошка из старой версии
      growth = growing.load(g, s !== null || b !== null);
      together = tally.load(s, Date.now()).together;
    } catch {
      // не прочиталось — молчим: форма не главное в настройках
    }
  }

  function pick(e: Event & { currentTarget: HTMLInputElement }) {
    form = FORMS[Number(e.currentTarget.value)] ?? 'adult';
  }
</script>

{#if growth}
  <Group legend={t('Форма', 'Form')}>
    {#if growth.power}
      <input
        id="form"
        class="ui-px"
        type="range"
        min="0"
        max={FORMS.length - 1}
        step="1"
        value={FORMS.indexOf(form)}
        oninput={pick}
        {disabled}
        aria-valuetext={NAMES[form]}
        aria-describedby="form-hint"
      />
      <div class="ticks" aria-hidden="true">
        {#each FORMS as f}
          <span class:on={f === form}>{NAMES[f]}</span>
        {/each}
      </div>
      <Hint id="form-hint">{t('Меняет только внешность — характер и привычки те же.', 'Changes only the looks: same habits and character.')}</Hint>
    {:else}
      <Hint>
        {left > 0
          ? t(
              `Откроется через ${tally.duration(left)} вместе: можно будет снова сделать питомца малышом или подростком.`,
              `Unlocks after ${tally.duration(left)} more together: then you can make your pet a kitten or a teen again.`,
            )
          : t('Уже скоро — питомец сам покажет.', 'Very soon: your pet will show you.')}
      </Hint>
    {/if}
  </Group>
{/if}

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
  .ticks {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin-top: var(--ui-s2);
    color: var(--ui-muted);
    font-size: 12.5px;
  }
  .ticks span:nth-child(2) {
    text-align: center;
  }
  .ticks span:last-child {
    text-align: right;
  }
  .ticks .on {
    color: var(--ui-text);
    font-weight: 600;
  }
</style>
