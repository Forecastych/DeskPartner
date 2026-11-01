// Своё ПКМ-меню питомца: пункты, которые окно-владелец отдаёт в open_menu, и то, что окно меню
// получает от Rust. Сами окна и показ — в src-tauri/src/menu.rs.
//
//   invoke('open_menu', { owner: 'pet', items: [...] })
//   выбрали пункт      → владельцу событие 'menu-pick' { id }
//   закрыли без выбора → 'menu-close' (клик мимо, Esc, другое окно, новое меню, close_menu)

export interface MenuEntry {
  id: string;
  text: string;
  /** Есть — пункт-галочка; нет — обычный пункт. */
  checked?: boolean;
  /** Мелкая приписка под текстом. */
  hint?: string;
  disabled?: boolean;
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
