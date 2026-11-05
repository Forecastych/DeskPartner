<script lang="ts">
  // Окно облачка над питомцем. Что сказать, решает питомец (lib/chatter.ts), где встать — Rust
  // (bubble.rs): он прислал текст ("bubble-text") — рисуем, меряем и отдаём размер в физических
  // пикселях (bubble_size); поставив окно, Rust говорит, где под облачком голова ("bubble-tail").
  // Как и меню, меряем сразу после tick(): спрятанный WebView может не крутить кадры.
  // Клик по облачку — «отмахнулись»: питомец будет болтать реже. Под новостью — кнопки
  // «больше такого / меньше такого» ("bubble-vote" питомцу): голос, а не «отмахнулись».
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount, tick } from 'svelte';
  import { Icon } from './ui';
  import './ui/tokens.css';

  let text = $state('');
  let vote = $state(false);
  /** Кончик хвостика, CSS px от левого края окна; null — Rust ещё не поставил окно. */
  let tail: number | null = $state(null);
  let gen = 0;
  let box: HTMLDivElement;

  /** Хвостик не вылезает за скругление: клетка контура с каждой стороны и полхвостика. */
  const CELL = 3;
  const TAIL_W = 5 * CELL;
  const tailLeft = $derived.by(() => {
    if (tail === null || !box) return null;
    const lo = 2 * CELL;
    const hi = box.offsetWidth - 3 * CELL - TAIL_W;
    return Math.round(Math.min(Math.max(tail - TAIL_W / 2, lo), hi) / CELL) * CELL;
  });

  function report() {
    const r = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    invoke('bubble_size', { gen, width: Math.ceil(r.width * dpr), height: Math.ceil(r.height * dpr) }).catch(
      console.error,
    );
  }

  function shoo() {
    if (!text) return;
    text = '';
    invoke('hush').catch(console.error);
    emitTo('pet', 'bubble-shoo').catch(console.error);
  }

  function voted(e: PointerEvent, up: boolean) {
    // не дать нажатию всплыть до облачка: там оно значит «отмахнулись»
    e.stopPropagation();
    if (!text) return;
    text = '';
    invoke('hush').catch(console.error);
    emitTo('pet', 'bubble-vote', { up }).catch(console.error);
  }

  onMount(() => {
    const win = getCurrentWebviewWindow();
    const offText = win.listen<{ gen: number; text: string; vote: boolean }>('bubble-text', async (e) => {
      gen = e.payload.gen;
      text = e.payload.text;
      vote = e.payload.vote;
      tail = null;
      await tick();
      report();
    });
    const offTail = win.listen<{ gen: number; x: number }>('bubble-tail', (e) => {
      if (e.payload.gen === gen) tail = e.payload.x / (window.devicePixelRatio || 1);
    });

    // Облачко показали на мониторе с другим масштабом — пиксели пересчитались, размер тоже
    let dpr: MediaQueryList | undefined;
    const rescale = () => {
      watchScale();
      if (text) report();
    };
    function watchScale() {
      dpr?.removeEventListener('change', rescale);
      dpr = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dpr.addEventListener('change', rescale);
    }
    watchScale();

    return () => {
      offText.then((f) => f());
      offTail.then((f) => f());
      dpr?.removeEventListener('change', rescale);
    };
  });
</script>

<svelte:window oncontextmenu={(e) => e.preventDefault()} />

<!-- Внешний блок меряется целиком: его поля — место под контур, тень и хвостик -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="wrap" bind:this={box} onpointerdown={shoo}>
  <div class="bubble ui-px" role="status">
    {text}
    {#if vote}
      <div class="votes">
        <button class="vote ui-px" type="button" title="Интересно — давай больше такого" onpointerdown={(e) => voted(e, true)}>
          <span class="up"><Icon name="heart" /></span>Ещё
        </button>
        <button class="vote ui-px" type="button" title="Неинтересно — меньше такого" onpointerdown={(e) => voted(e, false)}>
          <span class="down"><Icon name="broken" /></span>Не то
        </button>
      </div>
    {/if}
  </div>
  {#if tailLeft !== null}
    <svg class="tail" style:left="{tailLeft}px" viewBox="0 0 5 3" width={TAIL_W} height={3 * CELL} aria-hidden="true">
      <!-- верхний ряд закрывает контур облачка — хвостик растёт из него, а не прилеплен снизу -->
      <rect class="ink" x="0" y="0" width="1" height="1" />
      <rect class="card" x="1" y="0" width="3" height="1" />
      <rect class="ink" x="4" y="0" width="1" height="1" />
      <rect class="ink" x="1" y="1" width="1" height="1" />
      <rect class="card" x="2" y="1" width="1" height="1" />
      <rect class="ink" x="3" y="1" width="1" height="1" />
      <rect class="ink" x="2" y="2" width="1" height="1" />
    </svg>
  {/if}
</div>

<style>
  .wrap {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    max-width: 260px;
    /* сверху и слева — контур, справа — контур и тень, снизу — контур и хвостик в три клетки */
    padding: var(--ui-b) calc(var(--ui-b) + var(--ui-lift)) calc(var(--ui-b) * 3) var(--ui-b);
    cursor: default;
  }
  .bubble {
    /* Windows не даёт окну быть уже SM_CXMINTRACK (~136 px): облачко не уже окна, иначе
       справа осталась бы прозрачная полоса, которая ловит клики */
    min-width: 136px;
    box-sizing: border-box;
    padding: 6px var(--ui-s3);
    background: var(--ui-card);
    color: var(--ui-text);
    font: var(--ui-font);
    text-align: center;
    overflow-wrap: anywhere;
  }
  .votes {
    display: flex;
    justify-content: center;
    /* зазор не меньше контура: пиксельные рамки рисуются снаружи кнопок */
    gap: calc(var(--ui-b) * 4);
    margin: var(--ui-s2) 0 var(--ui-b);
  }
  .vote {
    display: flex;
    align-items: center;
    gap: var(--ui-s1);
    padding: 2px var(--ui-s2);
    border: 0;
    border-radius: 0;
    background: linear-gradient(to top, var(--ui-line) 0 var(--ui-b), var(--ui-card) var(--ui-b));
    color: var(--ui-text);
    font: 700 12px/1.4 var(--ui-font-pixel);
    cursor: pointer;
  }
  .vote:hover {
    background: linear-gradient(to top, var(--ui-line) 0 var(--ui-b), var(--ui-soft) var(--ui-b));
  }
  .vote:active {
    --lift: 0px;
    transform: translate(var(--ui-lift), var(--ui-lift));
  }
  .up {
    color: var(--ui-accent);
  }
  .down {
    color: var(--ui-muted);
  }
  .tail {
    position: absolute;
    /* верх хвостика — по нижнему краю облачка, на его контуре */
    bottom: 0;
    shape-rendering: crispEdges;
  }
  .ink {
    fill: var(--ui-ink);
  }
  .card {
    fill: var(--ui-card);
  }
</style>
