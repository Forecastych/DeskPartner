<script lang="ts">
  // Поля настроек — одни и те же в мастере первого запуска (по шагу на part) и в окне настроек.
  // Вид — из src/ui; здесь только раскладка.
  import { CHATTER, MODES, TOPICS, type Chatter, type Mode, type Settings, type Topic } from './lib/settings';
  import { Check, Group, Hint, Radio, TextInput } from './ui';

  interface Props {
    settings: Settings;
    /** 'pet' — питомец и темы, 'toggles' — галочки, режим и разговорчивость. */
    part: 'pet' | 'toggles';
    disabled?: boolean;
    /** Мастер: приписки «потом можно поменять в настройках» — в самих настройках они лишние. */
    wizard?: boolean;
  }

  let { settings = $bindable(), part, disabled = false, wizard = false }: Props = $props();

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

  /** Темы держим в порядке списка, как раньше делал bind:group. */
  function setTopic(t: Topic, on: boolean) {
    settings.topics = TOPICS.filter((x) => (x === t ? on : settings.topics.includes(x)));
  }
</script>

{#if part === 'pet'}
  <Group legend="Питомец">
    <div class="pets">
      {#each PETS as p}
        <Radio
          variant="card"
          name="pet"
          value={p.id as Settings['pet']}
          bind:group={settings.pet}
          disabled={!p.ready || disabled}
          hint={p.ready ? undefined : 'скоро'}
        >
          {p.name}
        </Radio>
      {/each}
    </div>
  </Group>

  <Group legend="О чём рассказывать факты">
    <Hint>Можно выбрать несколько{wizard ? '; список потом меняется в настройках' : ''}.</Hint>
    <div class="chips">
      {#each TOPICS as t}
        <Check variant="chip" value={t} bind:checked={() => settings.topics.includes(t), (on) => setTopic(t, on)} {disabled}>
          {t}
        </Check>
      {/each}
    </div>
  </Group>
{:else}
  <div class="toggles">
    <Check
      bind:checked={settings.gameWindow}
      hint="Играешь в Hearthstone или другие неспешные игры? Включи — питомец посидит с тобой."
      {disabled}
    >
      Заходить в окно игры
    </Check>

    <Check
      bind:checked={settings.sites}
      hint="Точнее угадывает интересы: заголовок окна сверяется со списком и не сохраняется."
      {disabled}
    >
      Узнавать сайты в браузере
    </Check>

    <Check bind:checked={settings.reviews} hint="Нужен твой бесплатный ключ TMDB — своего ключа в программе нет." {disabled}>
      Подтягивать отзывы о фильмах
    </Check>

    {#if settings.reviews}
      <div class="sub">
        <!-- id="tmdb" читают окна: настройки по нему узнают, что человек сейчас печатает ключ -->
        <TextInput
          id="tmdb"
          label="Ключ TMDB (API Key)"
          bind:value={settings.tmdbKey}
          mono
          spellcheck="false"
          autocomplete="off"
          aria-describedby="tmdb-how"
          {disabled}
        />
        <ol id="tmdb-how" class="guide">
          <li>Зарегистрируйся на <span class="ui-mono">themoviedb.org</span> — это бесплатно.</li>
          <li>В профиле открой Settings → API и создай ключ для личного использования.</li>
          <li>Скопируй строку «API Key» и вставь сюда.</li>
        </ol>
        {#if !settings.tmdbKey.trim()}
          <Hint>Без ключа отзывы не подтянутся.{wizard ? ' Его можно вставить и позже, в настройках.' : ''}</Hint>
        {/if}
      </div>
    {/if}

    <Check bind:checked={settings.feeder} hint="Насыпал порций — кошка ест сама, когда проголодается." {disabled}>
      Кормушка
    </Check>

    <Check bind:checked={settings.hideFromCapture} hint="Питомца не видно на скриншотах и стримах." {disabled}>
      Прятать от записи экрана
    </Check>
  </div>

  <Group legend="Режим">
    {#each MODES as m}
      <Radio name="mode" value={m} bind:group={settings.mode} hint={MODE_TEXT[m][1]} {disabled}>
        {MODE_TEXT[m][0]}
      </Radio>
    {/each}
  </Group>

  <Group legend="Разговорчивость">
    {#each CHATTER as c}
      <Radio name="chatter" value={c} bind:group={settings.chatter} hint={CHATTER_TEXT[c][1]} {disabled}>
        {CHATTER_TEXT[c][0]}
      </Radio>
    {/each}
  </Group>
{/if}

<style>
  .pets {
    display: flex;
    gap: 14px;
    padding: var(--ui-b) calc(var(--ui-b) * 2 + var(--ui-lift)) calc(var(--ui-b) * 2 + var(--ui-lift)) var(--ui-b);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: var(--ui-b);
  }

  .toggles {
    margin-bottom: var(--ui-s3);
  }
  /* строки галочек разделены чертой, как страницы блокнота */
  .toggles > :global(label),
  .sub {
    border-bottom: 2px solid var(--ui-line);
  }
  .sub {
    padding: 10px 0 10px 33px;
  }
  .guide {
    margin: 0;
    padding-left: 20px;
    color: var(--ui-muted);
    user-select: text;
  }
  .sub :global(.muted) {
    margin: 6px 0 0;
  }
</style>
