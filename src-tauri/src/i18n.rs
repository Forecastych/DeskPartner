//! Язык интерфейса: русский или английский. Выбирает человек в настройках (`lang` в
//! settings.json), "auto" — как язык Windows. Решается один раз при запуске: окна спрашивают его
//! командой `lang` до первой отрисовки, а смена языка перезапускает программу (`relaunch`),
//! так что ни трей, ни одно окно на старом языке не остаются.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::store;

static EN: AtomicBool = AtomicBool::new(false);

pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// "ru" или "en": так язык зовут ленты новостей, Википедия и окна.
pub fn code() -> &'static str {
    if en() {
        "en"
    } else {
        "ru"
    }
}

/// Строка на текущем языке. Для строк с подстановкой — `if en() { format!(…) } else { … }`.
pub fn tr(ru: &'static str, en: &'static str) -> &'static str {
    if self::en() {
        en
    } else {
        ru
    }
}

/// Английский ли: "ru"/"en" из настроек; "auto", пусто, битое — по языку Windows.
fn resolve(settings: Option<&str>, system_ru: bool) -> bool {
    let pref = settings
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v["lang"].as_str().map(str::to_owned));
    match pref.as_deref() {
        Some("en") => true,
        Some("ru") => false,
        _ => !system_ru,
    }
}

/// При запуске, до окон и трея. Первый запуск (папки ещё нет) — по языку Windows.
pub fn init() {
    let settings = store::load_state("settings".into()).ok().flatten();
    EN.store(resolve(settings.as_deref(), sys::system_ru()), Ordering::Relaxed);
}

#[tauri::command]
pub fn lang() -> &'static str {
    code()
}

#[cfg(windows)]
mod sys {
    use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;

    /// Язык меню Windows — русский, белорусский или казахский: там русский интерфейс привычнее.
    pub fn system_ru() -> bool {
        // младшие 10 бит LANGID — основной язык
        let primary = unsafe { GetUserDefaultUILanguage() } & 0x3ff;
        matches!(primary, 0x19 | 0x23 | 0x3f)
    }
}

#[cfg(not(windows))]
mod sys {
    pub fn system_ru() -> bool {
        std::env::var("LANG").is_ok_and(|l| l.starts_with("ru"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choice_wins_over_system() {
        assert!(resolve(Some(r#"{"lang":"en"}"#), true));
        assert!(!resolve(Some(r#"{"lang":"ru"}"#), false));
    }

    #[test]
    fn auto_and_garbage_follow_system() {
        for s in [None, Some(r#"{"lang":"auto"}"#), Some("{}"), Some("{oops"), Some(r#"{"lang":"de"}"#), Some("null")] {
            assert!(!resolve(s, true), "{s:?}");
            assert!(resolve(s, false), "{s:?}");
        }
    }
}
