<script lang="ts">
  // Окно настроек. Кнопки «Сохранить» нет: каждое изменение сразу пишется на диск и уходит питомцу.
  // Поля те же, что в мастере первого запуска (SettingsFields), плюс смена папки данных.
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount, tick } from 'svelte';
  import { defaults, parse, serialize, type Settings } from './lib/settings';
  import { dirHint, errorText, isDriveRoot, pickDir, samePath } from './lib/setup';
  import NewsFeeds from './NewsFeeds.svelte';
  import SettingsFields from './SettingsFields.svelte';
  import { Button, Dialog, Group, Hint, Radio, Section, TextInput } from './ui';

  /** Сколько ждать, пока питомец допишет файлы перед переносом. Не ответил — переносим всё равно. */
  const FREEZE_WAIT_MS = 3000;
  /** Ключ TMDB сохраняем, когда человек перестал печатать: change приходит только по уходу с поля. */
  const KEY_SAVE_MS = 600;
  /** Сколько окно ждёт последнего сохранения при закрытии. Диск завис — закрываемся всё равно. */
  const CLOSE_WAIT_MS = 2000;

  // Свой listen, а не глобальный: глобальный ловит событие с этим именем для любого окна,
  // то есть и наш собственный emitTo('pet', 'settings').
  const win = getCurrentWebviewWindow();

  let settings = $state(defaults());
  /** Пока настройки не прочитаны, поля выключены: иначе первое касание затёрло бы файл умолчаниями. */
  let loaded = $state(false);
  let saveError = $state('');
  let saved = $state(false);

  let current = $state('');
  let suggested = $state<string[]>([]);
  let dir = $state('');
  let rootPicked = $state<string | null>(null);
  let keepRoot = $state<string | null>(null);
  let moving = $state(false);
  let moveError = $state('');
  let dirInput = $state<HTMLInputElement>();

  /** Сохранения по очереди: две быстрые галочки не должны прийти на диск в обратном порядке. */
  let queue: Promise<void> = Promise.resolve();
  /** Питомец успел прислать свои настройки раньше, чем дочитался файл, — они свежее. */
  let fromPet = false;
  /** Ключ печатают, а сохранение ещё не ушло. */
  let keyTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    load();
    const off = win.listen<Settings>('settings', (e) => {
      fromPet = true;
      // галочка в меню кошки; ключ, который человек сейчас печатает, не стираем
      const draft = document.activeElement?.id === 'tmdb' ? settings.tmdbKey : null;
      Object.assign(settings, parse(serialize(e.payload)));
      if (draft !== null) settings.tmdbKey = draft;
    });
    // Закрыли окно, пока фокус в поле ключа: change уже не придёт — дописываем сами
    const offClose = win.onCloseRequested(async () => {
      if (keyTimer !== undefined) save();
      await Promise.race([queue, new Promise((r) => setTimeout(r, CLOSE_WAIT_MS))]);
    });
    return () => {
      off.then((f) => f());
      offClose.then((f) => f());
    };
  });

  async function load() {
    try {
      const [raw, dataDir] = await Promise.all([
        invoke<string | null>('load_state', { key: 'settings' }),
        invoke<string | null>('data_dir'),
      ]);
      if (!fromPet) Object.assign(settings, parse(raw));
      current = dataDir ?? '';
      loaded = true;
    } catch (e) {
      saveError = `Не удалось прочитать настройки: ${errorText(e)}`;
    }
    try {
      suggested = await invoke<string[]>('suggest_dirs');
    } catch {
      // без подсказок папку всё равно можно вписать или выбрать
    }
  }

  /** Любое поле поменялось (change всплывает из SettingsFields). Ключ TMDB приходит сюда по уходу с поля. */
  function changed() {
    settings.tmdbKey = settings.tmdbKey.trim();
    save();
  }

  /** Ключ печатают: сохранить, когда пальцы остановятся. Само поле не трогаем — каретка не прыгнет. */
  function typed(e: Event) {
    if ((e.target as HTMLElement | null)?.id !== 'tmdb') return;
    clearTimeout(keyTimer);
    keyTimer = setTimeout(save, KEY_SAVE_MS);
  }

  function save() {
    clearTimeout(keyTimer);
    keyTimer = undefined;
    const s: Settings = { ...$state.snapshot(settings), tmdbKey: settings.tmdbKey.trim() };
    queue = queue.then(() => persist(s));
  }

  async function persist(s: Settings) {
    try {
      await invoke<void>('save_state', { key: 'settings', value: serialize(s) });
      await invoke<void>('set_capture_hidden', { hidden: s.hideFromCapture });
      await emitTo('pet', 'settings', s);
      saveError = '';
      saved = true;
    } catch (e) {
      saveError = `Не удалось сохранить: ${errorText(e)}`;
      saved = false;
    }
  }

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
    moveError = '';
    try {
      const picked = await open({ directory: true, title: 'Новая папка для данных питомца', defaultPath: dir || current || undefined });
      if (typeof picked === 'string') take(picked);
    } catch (e) {
      moveError = `Не удалось открыть выбор папки: ${errorText(e)}`;
    }
  }

  /** Попросить питомца дописать всё и замолчать; ждём ответа не дольше FREEZE_WAIT_MS. */
  async function freezePet() {
    let done = () => {};
    const frozen = new Promise<void>((r) => (done = r));
    let off: (() => void) | undefined;
    try {
      off = await win.listen('frozen', () => done());
      await emitTo('pet', 'freeze');
      await Promise.race([frozen, new Promise((r) => setTimeout(r, FREEZE_WAIT_MS))]);
    } catch (e) {
      console.error(e);
    } finally {
      off?.();
    }
  }

  async function refocus(el: HTMLElement | undefined) {
    await tick();
    el?.focus();
  }

  async function move() {
    if (moving) return;
    const path = dir.trim();
    moveError = '';
    if (!path) {
      moveError = 'Выбери новую папку.';
      return refocus(dirInput);
    }
    // как в мастере: вписали корень руками — сначала показать подпапку, а не молча её создать
    if (isDriveRoot(path) && path !== keepRoot) return take(path);
    if (samePath(path, current)) {
      moveError = 'Данные уже лежат в этой папке.';
      return refocus(dirInput);
    }
    moving = true;
    // недопечатанный ключ — на диск до переезда, а не в старую папку посреди него
    if (keyTimer !== undefined) save();
    await queue;
    await freezePet();
    try {
      await invoke<void>('move_data_dir', { dir: path });
      // Успех: программа перезапускается сама, это окно закроется вместе с ней
    } catch (e) {
      emitTo('pet', 'thaw').catch(console.error);
      moveError = errorText(e);
      moving = false;
      await refocus(dirInput);
    }
  }
</script>

<Dialog title="DeskPartner" busy={moving}>
  {#snippet header()}
    <h1>Настройки</h1>
  {/snippet}

  <!-- change всплывает от любого поля: так автосохранению не нужно знать, какие поля есть.
       input — только ради ключа TMDB, см. typed -->
  <div onchange={changed} oninput={typed}>
    <Section title="Питомец и темы">
      <SettingsFields bind:settings part="pet" disabled={!loaded || moving} />
    </Section>

    <Section title="Главные галочки" rule>
      <SettingsFields bind:settings part="toggles" disabled={!loaded || moving} />
    </Section>
  </div>

  {#if saveError}
    <Hint tone="error">{saveError}</Hint>
  {/if}

  <Section title="Новости" rule>
    <NewsFeeds />
  </Section>

  <Section title="Папка данных" rule>
    <p>
      Сейчас: <span class="ui-mono">{current || 'не выбрана'}</span>
    </p>

    {#if suggested.length}
      <Group legend="Предлагаем">
        {#each suggested as s, i}
          <Radio
            name="dir"
            value={s}
            bind:group={dir}
            onchange={() => take(s)}
            disabled={moving}
            hint="{dirHint(i, suggested.length, s)}{samePath(s, current) ? ' — сейчас здесь' : ''}"
          >
            <span class="ui-mono">{s}</span>
          </Radio>
        {/each}
      </Group>
    {/if}

    <TextInput
      id="dir"
      label="Новая папка"
      bind:el={dirInput}
      bind:value={dir}
      onchange={() => take(dir)}
      mono
      spellcheck="false"
      autocomplete="off"
      placeholder="Например, E:\DeskPartner"
      aria-describedby="move-how"
      disabled={moving}
    >
      <Button onclick={browse} disabled={moving}>Обзор…</Button>
    </TextInput>

    {#if rootPicked}
      <Hint tone="note" role="status">
        <span>Это корень диска {rootPicked} — сложим всё в отдельную папку <span class="ui-mono">{dir}</span>.</span>
        <Button variant="link" onclick={useRoot}>Нет, прямо в корень</Button>
      </Hint>
    {/if}

    <Hint id="move-how">
      Данные переедут в новую папку, и питомец перезапустится. Если там уже лежат данные
      питомца, будут использованы они, а не нынешние.
    </Hint>

    <Button variant="primary" onclick={move} disabled={moving} aria-describedby="move-how">
      {moving ? 'Переносим…' : 'Перенести'}
    </Button>

    {#if moveError}
      <Hint tone="error">{moveError}</Hint>
    {/if}
  </Section>

  {#snippet footer()}
    <span class="saved" role="status">
      {saved ? 'Сохранено.' : 'Изменения сохраняются сразу.'}
    </span>
  {/snippet}
</Dialog>

<style>
  .saved {
    color: var(--ui-muted);
  }
</style>
