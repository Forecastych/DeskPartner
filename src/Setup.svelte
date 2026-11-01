<script lang="ts">
  // Окно первого запуска: три коротких экрана. Всё выбранное потом меняется в настройках,
  // поэтому здесь только главное и без длинных объяснений.
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount, tick } from 'svelte';
  import { CHATTER, defaults, MODES, serialize, TOPICS, type Chatter, type Mode } from './lib/settings';
  import { appFolderFor, driveOf, errorText, isDriveRoot } from './lib/setup';

  const TITLES = ['Где хранить данные', 'Питомец и темы', 'Главные галочки'];

  const MODE_TEXT: Record<Mode, [string, string]> = {
    calm: ['Спокойный', 'живёт рядом и не мешает'],
    pranks: ['Шалости', 'иногда тянет курсор, только когда мышь стоит'],
  };
  const CHATTER_TEXT: Record<Chatter, [string, string]> = {
    quiet: ['Молчун', 'сам не заговаривает'],
    sometimes: ['Иногда', 'облачко раз в 10–30 минут'],
    often: ['Часто', 'заговаривает чаще'],
  };
  // Собака и дракон видны заранее, чтобы было понятно: кошка не единственная навсегда
  const PETS = [
    { id: 'cat', name: 'Кошка', ready: true },
    { id: 'dog', name: 'Собака', ready: false },
    { id: 'dragon', name: 'Дракон', ready: false },
  ];

  let step = $state(0);
  let settings = $state(defaults());
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

  /** Подпись к предложенной папке. Последняя у Rust — всегда папка пользователя на системном диске. */
  function hint(i: number, path: string): string {
    if (i === suggested.length - 1) return 'в папке пользователя, на системном диске';
    const d = driveOf(path);
    return d ? `отдельный диск ${d}` : 'отдельный диск';
  }

  /** Выбрали корень диска — предлагаем подпапку, а не сыпать файлы прямо в корень. */
  function take(path: string) {
    const sub = path !== keepRoot ? appFolderFor(path) : null;
    rootPicked = sub ? path.trim() : null;
    dir = sub ?? path;
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

<form class="setup" {onsubmit} aria-busy={busy}>
  <header>
    <p class="brand">DeskPartner · первый запуск</p>
    <ol class="dots" aria-label="Шаги настройки">
      {#each TITLES as t, i}
        <li class:done={i < step} class:now={i === step} aria-current={i === step ? 'step' : undefined}>
          <span class="sr">Шаг {i + 1} из {TITLES.length}: {t}{i < step ? ' (готово)' : ''}</span>
        </li>
      {/each}
    </ol>
    <h1 bind:this={heading} tabindex="-1">{TITLES[step]}</h1>
  </header>

  <main>
    {#if step === 0}
      <p>
        Выбери папку: туда лягут питомец, дневник, файл интересов и кэш фактов. Системный диск
        лучше не загромождать, поэтому сначала предлагаем другой диск.
      </p>

      {#if suggested.length}
        <fieldset>
          <legend>Предлагаем</legend>
          {#each suggested as s, i}
            <label class="option">
              <input type="radio" name="dir" value={s} bind:group={dir} onchange={() => take(s)} disabled={busy} />
              <span>
                <span class="path">{s}</span>
                <small>{hint(i, s)}{i === 0 ? ' — лучший вариант' : ''}</small>
              </span>
            </label>
          {/each}
        </fieldset>
      {/if}

      <div class="field">
        <label for="dir">Папка</label>
        <div class="row">
          <input
            id="dir"
            type="text"
            bind:this={dirInput}
            bind:value={dir}
            onchange={() => take(dir)}
            spellcheck="false"
            autocomplete="off"
            placeholder="Например, D:\DeskPartner"
            disabled={busy}
          />
          <button type="button" class="secondary" onclick={browse} disabled={busy}>Обзор…</button>
        </div>
      </div>

      {#if rootPicked}
        <div class="note" role="status">
          <span>Это корень диска {rootPicked} — сложим всё в отдельную папку <span class="path">{dir}</span>.</span>
          <button type="button" class="link" onclick={useRoot}>Нет, прямо в корень</button>
        </div>
      {/if}

      <p class="muted">
        Передумаешь — папку можно сменить в настройках, данные переедут сами. В профиле Windows
        (AppData) хранится только путь к этой папке.
      </p>
    {:else if step === 1}
      <fieldset>
        <legend>Питомец</legend>
        <div class="pets">
          {#each PETS as p}
            <label class="card" class:off={!p.ready}>
              <input type="radio" name="pet" value={p.id} bind:group={settings.pet} disabled={!p.ready || busy} />
              <span class="pet-name">{p.name}</span>
              {#if !p.ready}<small>скоро</small>{/if}
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset>
        <legend>О чём рассказывать факты</legend>
        <p class="muted">Можно выбрать несколько; список потом меняется в настройках.</p>
        <div class="chips">
          {#each TOPICS as t}
            <label class="chip">
              <input type="checkbox" value={t} bind:group={settings.topics} disabled={busy} />
              <span>{t}</span>
            </label>
          {/each}
        </div>
      </fieldset>
    {:else}
      <p class="muted">Почти всё выключено — это осторожная версия. Включай только то, что нужно; потом можно поменять.</p>

      <div class="toggles">
        <label class="toggle">
          <input type="checkbox" bind:checked={settings.gameWindow} aria-describedby="d-game" disabled={busy} />
          <span>
            <b>Заходить в окно игры</b>
            <small id="d-game">Играешь в Hearthstone или другие неспешные игры? Включи — питомец посидит с тобой.</small>
          </span>
        </label>

        <label class="toggle">
          <input type="checkbox" bind:checked={settings.sites} aria-describedby="d-sites" disabled={busy} />
          <span>
            <b>Узнавать сайты в браузере</b>
            <small id="d-sites">Точнее угадывает интересы: заголовок окна сверяется со списком и не сохраняется.</small>
          </span>
        </label>

        <label class="toggle">
          <input type="checkbox" bind:checked={settings.reviews} aria-describedby="d-reviews" disabled={busy} />
          <span>
            <b>Подтягивать отзывы о фильмах</b>
            <small id="d-reviews">Нужен твой бесплатный ключ TMDB — своего ключа в программе нет.</small>
          </span>
        </label>

        {#if settings.reviews}
          <div class="sub">
            <div class="field">
              <label for="tmdb">Ключ TMDB (API Key)</label>
              <input
                id="tmdb"
                type="text"
                bind:value={settings.tmdbKey}
                spellcheck="false"
                autocomplete="off"
                aria-describedby="tmdb-how"
                disabled={busy}
              />
            </div>
            <ol id="tmdb-how" class="guide">
              <li>Зарегистрируйся на <span class="path">themoviedb.org</span> — это бесплатно.</li>
              <li>В профиле открой Settings → API и создай ключ для личного использования.</li>
              <li>Скопируй строку «API Key» и вставь сюда.</li>
            </ol>
            {#if !settings.tmdbKey.trim()}
              <p class="muted">Без ключа отзывы не подтянутся. Его можно вставить и позже, в настройках.</p>
            {/if}
          </div>
        {/if}

        <label class="toggle">
          <input type="checkbox" bind:checked={settings.feeder} aria-describedby="d-feeder" disabled={busy} />
          <span>
            <b>Кормушка</b>
            <small id="d-feeder">Насыпал порций — кошка ест сама, когда проголодается.</small>
          </span>
        </label>

        <label class="toggle">
          <input type="checkbox" bind:checked={settings.hideFromCapture} aria-describedby="d-capture" disabled={busy} />
          <span>
            <b>Прятать от записи экрана</b>
            <small id="d-capture">Питомца не видно на скриншотах и стримах.</small>
          </span>
        </label>
      </div>

      <fieldset>
        <legend>Режим</legend>
        {#each MODES as m}
          <label class="option">
            <input type="radio" name="mode" value={m} bind:group={settings.mode} disabled={busy} />
            <span><b>{MODE_TEXT[m][0]}</b> <small>{MODE_TEXT[m][1]}</small></span>
          </label>
        {/each}
      </fieldset>

      <fieldset>
        <legend>Разговорчивость</legend>
        {#each CHATTER as c}
          <label class="option">
            <input type="radio" name="chatter" value={c} bind:group={settings.chatter} disabled={busy} />
            <span><b>{CHATTER_TEXT[c][0]}</b> <small>{CHATTER_TEXT[c][1]}</small></span>
          </label>
        {/each}
      </fieldset>
    {/if}

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </main>

  <footer>
    {#if step > 0}
      <button type="button" class="secondary" onclick={() => go(step - 1)} disabled={busy}>Назад</button>
    {/if}
    <span class="grow"></span>
    {#if step === 2}
      <button type="button" class="secondary" onclick={() => finish(true)} disabled={busy}>Пропустить</button>
    {/if}
    <button type="submit" class="primary" bind:this={submit} disabled={busy}>
      {#if busy}
        {step === 0 ? 'Проверяем папку…' : 'Выпускаем питомца…'}
      {:else}
        {step === 2 ? 'Готово' : 'Далее'}
      {/if}
    </button>
  </footer>
</form>

<style>
  /* app.css делает страницу прозрачной для окна питомца — здесь своё непрозрачное окно */
  .setup {
    --bg: #faf8f5;
    --card: #ffffff;
    --text: #2b2724;
    --muted: #6b645e;
    --line: #e2dbd3;
    --accent: #a85a26;
    --on-accent: #ffffff;
    --soft: #f6e9df;
    --danger: #b3261e;
    --danger-bg: #fdecea;

    color-scheme: light dark;
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.45 'Segoe UI', system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    .setup {
      --bg: #1f1d1b;
      --card: #2a2725;
      --text: #ece7e2;
      --muted: #a8a09a;
      --line: #3f3a36;
      --accent: #e39a63;
      --on-accent: #1f1d1b;
      --soft: #3a2d24;
      --danger: #ff8a80;
      --danger-bg: #3a2120;
    }
  }

  header {
    padding: 20px 28px 8px;
  }
  .brand {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  h1 {
    margin: 10px 0 0;
    font-size: 22px;
    font-weight: 600;
    outline: none;
  }

  .dots {
    display: flex;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .dots li {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
    transition: width 0.2s;
  }
  .dots li.done {
    background: var(--accent);
    opacity: 0.5;
  }
  .dots li.now {
    width: 24px;
    border-radius: 4px;
    background: var(--accent);
  }

  /* Содержимое выше окна прокручивается здесь, а шапка и кнопки стоят на месте */
  main {
    flex: 1;
    overflow-y: auto;
    padding: 4px 28px 16px;
  }
  main > p {
    margin: 8px 0 14px;
  }

  fieldset {
    margin: 0 0 16px;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    padding: 0;
    font-weight: 600;
  }

  .muted,
  small {
    color: var(--muted);
  }
  small {
    font-size: 12.5px;
  }
  .path {
    font-family: Consolas, 'Cascadia Mono', monospace;
    user-select: text;
  }

  .option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
  }
  .option:hover {
    background: var(--soft);
  }
  .option > span {
    display: flex;
    flex-direction: column;
  }
  fieldset .option > span:has(b) {
    display: block;
  }

  input[type='radio'],
  input[type='checkbox'] {
    flex: none;
    width: 17px;
    height: 17px;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }

  .field {
    margin: 4px 0 12px;
  }
  .field label {
    display: block;
    margin-bottom: 4px;
    font-weight: 600;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input[type='text'] {
    flex: 1;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--card);
    color: var(--text);
    font: inherit;
    user-select: text;
  }
  input[type='text']:focus {
    border-color: var(--accent);
    outline: none;
  }

  .note {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--soft);
  }

  .pets {
    display: flex;
    gap: 10px;
  }
  .card {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    padding: 14px 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    cursor: pointer;
  }
  .card:has(:checked) {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .card.off {
    opacity: 0.55;
    cursor: default;
  }
  .pet-name {
    font-weight: 600;
  }

  /* Сами галочки прячем, но не display:none — иначе до них не дойти с клавиатуры */
  .card input,
  .chip input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
  }
  .card:has(:focus-visible),
  .chip:has(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    position: relative;
    padding: 5px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    cursor: pointer;
  }
  .chip:has(:checked) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }

  .toggles {
    margin-bottom: 12px;
  }
  .toggle {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
  }
  .toggle > span {
    display: flex;
    flex-direction: column;
  }
  .sub {
    padding: 10px 0 6px 29px;
    border-bottom: 1px solid var(--line);
  }
  .guide {
    margin: 0;
    padding-left: 20px;
    color: var(--muted);
    user-select: text;
  }
  .sub .muted {
    margin: 6px 0 0;
  }

  .error {
    margin: 12px 0 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--danger-bg);
    color: var(--danger);
    user-select: text;
  }

  footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 28px;
    border-top: 1px solid var(--line);
  }
  .grow {
    flex: 1;
  }

  button {
    padding: 7px 16px;
    border: 1px solid transparent;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  button:focus-visible,
  .option input:focus-visible,
  .toggle input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .primary {
    min-width: 96px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .secondary {
    border-color: var(--line);
    background: var(--card);
    color: var(--text);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
