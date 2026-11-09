// Своё ПКМ-меню питомца: пункты, которые окно-владелец отдаёт в open_menu, и то, что окно меню
// получает от Rust. Сами окна и показ — в src-tauri/src/menu.rs.
//
//   invoke('open_menu', { owner: 'pet', items: [...] })
//   выбрали пункт      → владельцу событие 'menu-pick' { id }
//   закрыли без выбора → 'menu-close' (клик мимо, Esc, другое окно, новое меню, close_menu)
//
// Пункт с ползунком (slider) — для выбора числа прямо в меню, без отдельного окна: его text —
// шаблон (см. fill), число в нём меняется, пока тянут ползунок, а выбор приходит как «id:число».

import { plural } from './i18n';

/** Ползунок под пунктом: подпись слева и пределы; value — с чего начать. */
export interface MenuSlider {
  min: number;
  max: number;
  value: number;
  label: string;
}

export interface MenuEntry {
  id: string;
  text: string;
  /** Есть — пункт-галочка; нет — обычный пункт. */
  checked?: boolean;
  /** Мелкая приписка под текстом. */
  hint?: string;
  disabled?: boolean;
  /** Есть — под пунктом ползунок, а text — шаблон для fill. */
  slider?: MenuSlider;
}

export type MenuItem = MenuEntry | { separator: true };

/** Событие 'menu-items' для окна меню: номер показа и пункты. */
export interface MenuShow {
  gen: number;
  items: MenuItem[];
}

export function isSeparator(item: MenuItem): item is { separator: true } {
  return 'separator' in item;
}

/**
 * Текст пункта с ползунком: `{n}` → число, `{a|b|c}` → русская форма слова к нему (1 минута,
 * 2 минуты, 5 минут), `{a|b}` → английская (1 minute, 2 minutes). Шаблон собирает владелец меню
 * на своём языке — окну меню язык знать не нужно, и Rust-трей шлёт такой же.
 */
export function fill(template: string, n: number): string {
  return template.replace(/\{([^{}]*)\}/g, (all, body: string) => {
    if (body === 'n') return String(n);
    const forms = body.split('|');
    if (forms.length === 3) return plural(n, forms as [string, string, string]);
    if (forms.length === 2) return n === 1 ? forms[0] : forms[1];
    return all;
  });
}

/** Что уходит владельцу при выборе пункта: у пункта с ползунком — «id:число». */
export const pickId = (item: MenuEntry, value?: number): string =>
  item.slider && value !== undefined ? `${item.id}:${value}` : item.id;

/** Выбор обратно: «focus:40» → ['focus', 40]; без числа — [id, null]. */
export function picked(id: string): [string, number | null] {
  const m = /^(.*):(-?\d+)$/.exec(id);
  return m ? [m[1], Number(m[2])] : [id, null];
}
