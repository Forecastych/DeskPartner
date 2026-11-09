<script lang="ts">
  // Окно ПКМ-меню питомца. Фокуса у окна нет (его не отнимают у игры), поэтому меню живёт
  // одной мышью: подсветка по наведению, выбор — отпустить кнопку на пункте. Esc и клик мимо
  // ловит Rust (menu.rs), сюда они не доходят.
  //
  // У пункта может быть ползунок (длина фокуса): его тянут мышью или колесом, текст пункта
  // меняется на лету, а клик по пункту отдаёт «id:число». Отдельного окна-диалога ради одного
  // числа не нужно, и трей получает его даром — его меню рисуется этим же окном.
  //
  // Rust прислал пункты ("menu-items") — рисуем, меряем и отдаём размер в физических пикселях
  // (menu_size); ставит и показывает окно уже Rust. Спрятанный WebView может не крутить кадры,
  // поэтому меряем сразу после tick(), без requestAnimationFrame и ResizeObserver.
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount, tick } from 'svelte';
  import { fill, isSeparator, pickId, type MenuEntry, type MenuItem, type MenuShow } from './lib/menu';
  import { Icon, Slider } from './ui';

  let items: MenuItem[] = $state([]);
  /** Числа ползунков по номеру пункта: тянут — текст пункта над ползунком меняется сразу. */
  let values: number[] = $state([]);
  let gen = 0;
  let box: HTMLDivElement;
  /** Пункт, на котором нажали кнопку: выбор — отпустить на нём же. */
  let downOn: string | null = null;

  // Колонка под галочку — если в меню есть хоть одна галочка, чтобы тексты стояли ровно
  const ticks = $derived(items.some((i) => !isSeparator(i) && i.checked !== undefined));

  function report() {
    const r = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    invoke('menu_size', { gen, width: Math.ceil(r.width * dpr), height: Math.ceil(r.height * dpr) }).catch(
      console.error,
    );
  }

  function down(e: PointerEvent, id: string) {
    downOn = e.button === 0 || e.button === 2 ? id : null;
  }

  function up(e: PointerEvent, item: MenuEntry, i: number) {
    const hit = downOn === item.id;
    downOn = null;
    if (!hit || item.disabled || (e.button !== 0 && e.button !== 2)) return;
    invoke('menu_pick', { gen, id: pickId(item, values[i]) }).catch(console.error);
  }

  /**
   * Невидимые варианты текста пункта с ползунком — самые длинные числа со всеми формами слова.
   * Ширину меню они держат с запасом: окно мерится один раз при показе, и «Фокус 180 минут» не
   * должен вылезти за край, если открыли на «Фокус 5 минут».
   */
  function widest(item: MenuEntry): string[] {
    const s = item.slider;
    if (!s) return [];
    const out = new Set<string>();
    for (let n = Math.max(s.min, s.max - 20); n <= s.max; n++) out.add(fill(item.text, n));
    return [...out];
  }

  /** Колесо над ползунком — по одному делению: мышью до минуты на узкой дорожке не попасть. */
  function wheel(e: WheelEvent, item: MenuEntry, i: number) {
    const s = item.slider;
    if (!s || item.disabled || e.deltaY === 0) return;
    values[i] = Math.min(s.max, Math.max(s.min, values[i] + (e.deltaY < 0 ? 1 : -1)));
  }

  onMount(() => {
    const win = getCurrentWebviewWindow();
    const off = win.listen<MenuShow>('menu-items', async (e) => {
      gen = e.payload.gen;
      items = e.payload.items;
      values = items.map((i) => (!isSeparator(i) && i.slider ? i.slider.value : 0));
      downOn = null;
      await tick();
      report();
    });

    // Меню открыли на мониторе с другим масштабом — пиксели пересчитались, размер тоже
    let dpr: MediaQueryList | undefined;
    const rescale = () => {
      watchScale();
      if (items.length) report();
    };
    function watchScale() {
      dpr?.removeEventListener('change', rescale);
      dpr = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dpr.addEventListener('change', rescale);
    }
    watchScale();

    return () => {
      off.then((f) => f());
      dpr?.removeEventListener('change', rescale);
    };
  });

  // Если окно всё же получило фокус (кликом), Esc закрывает и отсюда
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') invoke('close_menu').catch(console.error);
  }
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} onkeydown={key} />

<!-- Внешний блок меряется целиком: его поля — место под контур и тень, которые рисуются снаружи -->
<div class="wrap" bind:this={box}>
  <div class="menu ui-px" role="menu">
    {#each items as item, i (i)}
      {#if isSeparator(item)}
        <div class="sep" role="separator"></div>
      {:else}
        <button
          type="button"
          tabindex="-1"
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          aria-disabled={item.disabled || undefined}
          class={['item', item.disabled && 'off']}
          onpointerdown={(e) => down(e, item.id)}
          onpointerup={(e) => up(e, item, i)}
        >
          {#if ticks}
            <span class="tick">
              {#if item.checked}<Icon name="tick" />{/if}
            </span>
          {/if}
          <span class="text">
            {#if item.slider}
              <span class="fit">
                <span>{fill(item.text, values[i])}</span>
                {#each widest(item) as ghost}<span class="ghost" aria-hidden="true">{ghost}</span>{/each}
              </span>
            {:else}
              {item.text}
            {/if}
            {#if item.hint}<small>{item.hint}</small>{/if}
          </span>
        </button>
        {#if item.slider}
          <!-- ползунок под своим пунктом: тянуть — выбрать число, клик по пункту — пуск -->
          <div class="range">
            {#if ticks}<span class="tick"></span>{/if}
            <span class="label">{item.slider.label}</span>
            <div class="track">
              <Slider
                min={item.slider.min}
                max={item.slider.max}
                bind:value={values[i]}
                disabled={item.disabled}
                tabindex={-1}
                onwheel={(e) => wheel(e, item, i)}
                aria-label={item.slider.label}
                aria-valuetext={fill(item.text, values[i])}
              />
            </div>
          </div>
        {/if}
      {/if}
    {/each}
  </div>
</div>

<style>
  .wrap {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    max-width: 320px;
    padding: var(--ui-b) calc(var(--ui-b) + var(--ui-lift)) calc(var(--ui-b) + var(--ui-lift)) var(--ui-b);
  }
  .menu {
    min-width: 168px;
    padding: var(--ui-s1) 0;
    background: var(--ui-card);
    color: var(--ui-text);
    font: var(--ui-font);
    cursor: default;
  }

  .item {
    display: flex;
    gap: var(--ui-s2);
    align-items: flex-start;
    width: 100%;
    margin: 0;
    padding: 5px var(--ui-s3);
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: default;
  }
  /* наведение работает и без фокуса: подсветка — по :hover, а не по :focus */
  .item:hover:not(.off) {
    background: var(--ui-accent);
    color: var(--ui-on-accent);
  }
  .item:hover:not(.off) small {
    color: inherit;
  }
  .off {
    color: var(--ui-muted);
  }

  .tick {
    display: flex;
    flex: none;
    align-items: center;
    width: 14px;
    height: 1.45em;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  small {
    color: var(--ui-muted);
    font-size: 12px;
    line-height: 1.3;
  }

  /* все варианты текста в одной клетке: видно один, а ширину держит самый длинный */
  .fit {
    display: grid;
  }
  .fit > span {
    grid-area: 1 / 1;
  }
  .ghost {
    visibility: hidden;
  }

  .range {
    display: flex;
    gap: var(--ui-s2);
    align-items: center;
    padding: 0 var(--ui-s3) var(--ui-s1);
  }
  .label {
    flex: none;
    color: var(--ui-muted);
    font-size: 12px;
  }
  .track {
    flex: 1;
    min-width: 96px;
  }

  .sep {
    height: 2px;
    margin: var(--ui-s1) var(--ui-s2);
    background: var(--ui-line);
  }
</style>
