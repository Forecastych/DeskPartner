<script lang="ts">
  // Окно первого запуска: три коротких экрана. Всё выбранное потом меняется в настройках,
  // поэтому здесь только главное и без длинных объяснений.
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount, tick } from 'svelte';
  import { defaults, serialize, suggestName } from './lib/settings';
  import { dirHint, errorText, isDriveRoot, pickDir } from './lib/setup';
  import SettingsFields from './SettingsFields.svelte';
  import { Button, Dialog, Group, Hint, Radio, TextInput } from './ui';

  const TITLES = ['Где хранить данные', 'Питомец и темы', 'Главные галочки'];

  let step = $state(0);
  // имя сразу предложено: стереть проще, чем придумать с нуля
  let settings = $state({ ...defaults(), name: suggestName(Math.random) });
  let dir = $state('');
  let suggested = $state<string[]>([]);
  /** Корень диска, вместо которого подставили `X:\DeskPartner`; показываем, чтобы можно было отказаться. */
  let rootPicked = $state<string | null>(null);
  /** Человек отказался от подпапки — корень больше не переспрашиваем. */
  let keepRoot = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');
  let heading = $state<HTMLElement>();
  let dirInput = $state<HTMLInputElement>();
  let submit = $state<HTMLButtonElement>();

  /** Пока шёл вызов, кнопки были выключены и фокус слетел — вернуть его туда, где чинить ошибку. */
  async function refocus(el: HTMLElement | undefined) {
    await tick();
    el?.focus();
  }

  onMount(async () => {
    try {
      // мастер мог закрыться после первого экрана: папка уже выбрана — её и предлагаем
      const [current, dirs] = await Promise.all([invoke<string | null>('data_dir'), invoke<string[]>('suggest_dirs')]);
      suggested = dirs;
      if (!dir) dir = current ?? suggested[0] ?? '';
    } catch (e) {
      // Без подсказок человек всё равно может вписать или выбрать папку сам
      error = `Не удалось подобрать папку: ${errorText(e)}`;
    }
  });

  /** Выбрали корень диска — предлагаем подпапку, а не сыпать файлы прямо в корень. */
  function take(path: string) {
    ({ dir, root: rootPicked } = pickDir(path, keepRoot));
  }

  function useRoot() {
    if (rootPicked === null) return;
    keepRoot = rootPicked;
    dir = rootPicked;
    rootPicked = null;
  }

  async function browse() {
    error = '';
    try {
      const picked = await open({ directory: true, title: 'Папка для данных питомца', defaultPath: dir || undefined });
      if (typeof picked === 'string') take(picked);
    } catch (e) {
      error = `Не удалось открыть выбор папки: ${errorText(e)}`;
    }
  }

  async function go(n: number) {
    step = n;
    error = '';
    await tick();
    // Фокус на заголовок: экранный диктор прочитает новый шаг, Tab пойдёт с начала экрана
    heading?.focus();
  }

  async function next() {
    if (busy) return;
    if (step === 0) {
      const path = dir.trim();
      if (!path) {
        error = 'Выбери папку для данных.';
        return;
      }
      // Вписали корень руками и сразу нажали «Далее» — сначала показать подпапку, а не молча её создать
      if (isDriveRoot(path) && path !== keepRoot) {
        take(path);
        return;
      }
      busy = true;
      error = '';
      try {
        await invoke<void>('set_data_dir', { dir: path });
        busy = false;
        await go(1);
      } catch (e) {
        error = errorText(e);
        busy = false;
        await refocus(dirInput);
      }
    } else if (step === 1) {
      await go(2);
    } else {
      await finish(false);
    }
  }

  /** «Пропустить» оставляет на третьем экране осторожные значения по умолчанию. */
  async function finish(skip: boolean) {
    if (busy) return;
    if (skip) {
      const d = defaults();
      Object.assign(settings, {
        gameWindow: d.gameWindow,
        sites: d.sites,
        reviews: d.reviews,
        tmdbKey: d.tmdbKey,
        feeder: d.feeder,
        hideFromCapture: d.hideFromCapture,
        mode: d.mode,
        chatter: d.chatter,
      });
    }
    busy = true;
    error = '';
    const s = { ...$state.snapshot(settings), tmdbKey: settings.tmdbKey.trim() };
    try {
      await invoke<void>('save_state', { key: 'settings', value: serialize(s) });
      await invoke<void>('set_capture_hidden', { hidden: s.hideFromCapture });
      await invoke<void>('finish_setup');
      // Успех: Rust закрывает окно сам, кнопки остаются занятыми до конца
    } catch (e) {
      error = errorText(e);
      busy = false;
      await refocus(submit);
    }
  }

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    next();
  }
</script>

<Dialog title="DeskPartner · первый запуск" {onsubmit} {busy}>
  {#snippet header()}
    <ol class="steps" aria-label="Шаги настройки">
      {#each TITLES as t, i}
        <li class:done={i < step} class:now={i === step} aria-current={i === step ? 'step' : undefined}>
          <span class="ui-sr">Шаг {i + 1} из {TITLES.length}: {t}{i < step ? ' (готово)' : ''}</span>
        </li>
      {/each}
    </ol>
    <h1 bind:this={heading} tabindex="-1">{TITLES[step]}</h1>
  {/snippet}

  {#if step === 0}
    <p>
      Выбери папку: туда лягут питомец, дневник, файл интересов и кэш фактов. Системный диск
      лучше не загромождать, поэтому сначала предлагаем другой диск.
    </p>

    {#if suggested.length}
      <Group legend="Предлагаем">
        {#each suggested as s, i}
          <Radio
            name="dir"
            value={s}
            bind:group={dir}
            onchange={() => take(s)}
            disabled={busy}
            hint="{dirHint(i, suggested.length, s)}{i === 0 ? ' — лучший вариант' : ''}"
          >
            <span class="ui-mono">{s}</span>
          </Radio>
        {/each}
      </Group>
    {/if}

    <TextInput
      id="dir"
      label="Папка"
      bind:el={dirInput}
      bind:value={dir}
      onchange={() => take(dir)}
      mono
      spellcheck="false"
      autocomplete="off"
      placeholder="Например, D:\DeskPartner"
      disabled={busy}
    >
      <Button onclick={browse} disabled={busy}>Обзор…</Button>
    </TextInput>

    {#if rootPicked}
      <Hint tone="note" role="status">
        <span>Это корень диска {rootPicked} — сложим всё в отдельную папку <span class="ui-mono">{dir}</span>.</span>
        <Button variant="link" onclick={useRoot}>Нет, прямо в корень</Button>
      </Hint>
    {/if}

    <Hint>
      Передумаешь — папку можно сменить в настройках, данные переедут сами. В профиле Windows
      (AppData) хранится только путь к этой папке.
    </Hint>
  {:else if step === 1}
    <SettingsFields bind:settings part="pet" disabled={busy} wizard />
  {:else}
    <Hint>Почти всё выключено — это осторожная версия. Включай только то, что нужно; потом можно поменять.</Hint>

    <SettingsFields bind:settings part="toggles" disabled={busy} wizard />
  {/if}

  {#if error}
    <Hint tone="error">{error}</Hint>
  {/if}

  {#snippet footer()}
    {#if step > 0}
      <Button onclick={() => go(step - 1)} disabled={busy}>Назад</Button>
    {/if}
    <span class="grow"></span>
    {#if step === 2}
      <Button onclick={() => finish(true)} disabled={busy}>Пропустить</Button>
    {/if}
    <Button type="submit" variant="primary" bind:el={submit} disabled={busy}>
      {#if busy}
        {step === 0 ? 'Проверяем папку…' : 'Выпускаем питомца…'}
      {:else}
        {step === 2 ? 'Готово' : 'Далее'}
      {/if}
    </Button>
  {/snippet}
</Dialog>

<style>
  /* Общий вид окна — в src/ui, здесь только то, что есть лишь у мастера */
  .steps {
    display: flex;
    gap: 6px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }
  /* шаги — клетки: пройденный бледный, текущий длинный, как полоска сытости */
  .steps li {
    width: 9px;
    height: 9px;
    background: var(--ui-line);
    transition: width 0.2s steps(4);
  }
  .steps li.done {
    background: var(--ui-accent);
    opacity: 0.5;
  }
  .steps li.now {
    width: 27px;
    background: var(--ui-accent);
  }
  .grow {
    flex: 1;
  }
</style>
