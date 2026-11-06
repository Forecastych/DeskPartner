// Прятки на созвоне. Rust (call.rs) раз в пару секунд отвечает да/нет: занят микрофон или камера,
// или Zoom показывает экран. Здесь решается, прятаться ли кошке: сразу, как созвон начался, —
// и обратно только через RETURN_MS тишины, чтобы короткое «выключил микрофон — включил» не гоняло
// её туда-сюда через весь экран. Пока прячется — никакой мести, игр, облачков (App.svelte: onCall).
// Приложение зовёт `step` на каждом ответе `senses` с Date.now().

/** Столько созвона не видно — тогда можно выходить. */
export const RETURN_MS = 25_000;

export interface Hide {
  /** Кошка прячется от созвона. */
  hiding: boolean;
  /** Когда созвон видели в последний раз, мс; 0 — не видели. */
  seen: number;
}

export function fresh(): Hide {
  return { hiding: false, seen: 0 };
}

/**
 * Новый ответ: `call` — идёт ли созвон сейчас. Часы ушли назад (перевели, проснулся ноутбук
 * с другим временем) — отсчёт тишины начинается заново, а не держит кошку за краем часами.
 */
export function step(h: Hide, call: boolean, now: number): Hide {
  if (call) return { hiding: true, seen: now };
  if (!h.hiding) return h;
  if (now < h.seen) return { ...h, seen: now };
  return now - h.seen >= RETURN_MS ? { hiding: false, seen: h.seen } : h;
}

/** На созвоне: прятаться и не мешать. Отсюда же «месть» узнаёт, что сейчас нельзя. */
export function onCall(h: Hide): boolean {
  return h.hiding;
}
