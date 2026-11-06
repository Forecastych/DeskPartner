//! Месть злой кошки (src/lib/revenge.ts): лужа поверх «важного» окна. Здесь только две вещи.
//!
//! Окно "puddle" — сама лужа. Прозрачное, поверх всех, клики проходят сквозь него всегда
//! (`set_ignore_cursor_events`, в hit.rs не регистрируется: маски у лужи нет и не будет), фокус
//! не берёт никогда и всегда спрятано от записи экрана — независимо от настройки «прятать
//! питомца»: лужа на чужом окне в скриншоте или на демонстрации экрана выглядела бы как настоящая
//! порча, а объяснить её некому. Окно ничего не читает с экрана и не трогает окно, над которым
//! висит: это картинка, которую двигает и гасит окно кошки.
//!
//! [`top_app`] — программа, где человек сегодня провёл больше всего времени: только имя из
//! трекера (секунды по программам за день), заголовков и содержимого окон мы не знаем.

use crate::Senses;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Строит окно лужи. Зовётся один раз при старте раньше окна кошки: окна поверх всех ложатся в
/// порядке создания, лужа должна быть под кошкой, которая над ней сидит. Окно то же, что у
/// спрайтов (размер, без фокуса, спрятано от записи), только мышь не ловит вовсе. В CAPTURED
/// его нет — set_capture_hidden не снимет защиту. Холст пустой, пока лужи нет: видимое
/// прозрачное окно не мешает, а прятать и показывать его по каждой луже — лишний раз дёргать z-order.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    crate::build_sprite_window(app, "puddle")?.set_ignore_cursor_events(true)
}

/// Дольше всех сегодня; при равенстве — первая по имени, чтобы ответ не скакал между тиками.
fn top(apps: &HashMap<String, u64>) -> Option<String> {
    apps.iter()
        .filter(|(_, &secs)| secs > 0)
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(name, _)| name.clone())
}

/// Самая «важная» программа дня по трекеру; `None` — сегодня ещё ничего не было.
#[tauri::command]
pub fn top_app(s: State<'_, Arc<Senses>>) -> Option<String> {
    top(&s.tracker.lock().unwrap().day.apps)
}

#[cfg(test)]
mod tests {
    use super::top;
    use std::collections::HashMap;

    fn apps(list: &[(&str, u64)]) -> HashMap<String, u64> {
        list.iter().map(|(n, s)| (n.to_string(), *s)).collect()
    }

    #[test]
    fn longest_wins() {
        assert_eq!(top(&apps(&[("Code", 3600), ("Chrome", 1200), ("Telegram", 4000)])), Some("Telegram".into()));
        assert_eq!(top(&apps(&[("Code", 3600), ("Chrome", 1200)])), Some("Code".into()));
    }

    #[test]
    fn empty_day_has_none() {
        assert_eq!(top(&HashMap::new()), None);
        assert_eq!(top(&apps(&[("Code", 0)])), None);
    }

    #[test]
    fn tie_is_stable() {
        for _ in 0..20 {
            assert_eq!(top(&apps(&[("Word", 60), ("Code", 60), ("Excel", 60)])), Some("Code".into()));
        }
    }
}
