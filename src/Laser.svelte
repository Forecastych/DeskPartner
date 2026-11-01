<!-- Лазерная точка. Окно ходит за курсором (двигает Rust, laser.rs), здесь только рисунок:
     почти белое ядро, красное свечение и лёгкое мерцание. Без скриптов — один CSS, чтобы
     точка ничего не стоила, пока стоит на месте. -->

<script lang="ts">
  // скрипта нет: блок нужен, чтобы у компонента был тип для main.ts
</script>

<div class="dot">
  <div class="glow"></div>
  <div class="core"></div>
</div>

<style>
  /* Окно может оказаться шире заказанного (Windows не даёт окну быть уже минимума),
     поэтому точка — по центру окна, а не в углу. */
  .dot {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 32px;
    height: 32px;
    pointer-events: none;
  }

  .dot > div {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }

  /* Свечение: красный ореол, к краю окна сходит в ноль. */
  .glow {
    background: radial-gradient(
      circle closest-side,
      rgba(255, 40, 40, 0.85) 0%,
      rgba(255, 30, 30, 0.45) 35%,
      rgba(255, 20, 20, 0.15) 65%,
      rgba(255, 0, 0, 0) 100%
    );
    will-change: opacity, transform;
    animation: flicker 1.3s infinite steps(1, end);
  }

  /* Ядро ~10 px: белое пятно, розовая кайма, красный край. */
  .core {
    background: radial-gradient(
      circle at center,
      #fff 0,
      #fff 2px,
      #ffd0d0 3px,
      #ff2a2a 5px,
      rgba(255, 42, 42, 0) 6px
    );
  }

  /* Мерцание неровное, как у настоящей указки: короткие провалы яркости в разные моменты. */
  @keyframes flicker {
    0% { opacity: 1; transform: scale(1); }
    11% { opacity: 0.86; transform: scale(0.96); }
    17% { opacity: 1; transform: scale(1); }
    38% { opacity: 0.93; transform: scale(0.98); }
    44% { opacity: 1; transform: scale(1.02); }
    63% { opacity: 0.82; transform: scale(0.95); }
    68% { opacity: 0.97; transform: scale(1); }
    86% { opacity: 0.9; transform: scale(0.98); }
    91% { opacity: 1; transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .glow {
      animation: none;
    }
  }
</style>
