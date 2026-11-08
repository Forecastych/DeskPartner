//! Органы чувств питомца: идёт ли ввод, давно ли человек отошёл, сколько сидит без перерыва
//! и в какой программе. Ядро взято из pc_wrapped.
//!
//! Сюда приходят события ввода (сотни в секунду) и тик раз в секунду. Обработчики ввода
//! только плюсуют числа и запоминают время, поэтому на отзывчивость ввода это не влияет.
//! Какие именно клавиши нажимались, не храним: питомцу хватает «печатает или нет».
//! Для достижений копятся только два итога с запуска: сколько нажатий и сколько мышь проехала.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Простой дольше этого — человек отошёл, время не идёт.
pub const IDLE_AFTER: Duration = Duration::from_secs(120);
/// Перерыв дольше этого обрывает «сессию за компьютером».
pub const SESSION_BREAK: Duration = Duration::from_secs(300);
/// Клавиша нажималась не раньше этого — человек сейчас печатает, отвлекать нельзя.
pub const TYPING_WITHIN: Duration = Duration::from_secs(3);

pub const RI_LEFT_DOWN: u16 = 0x0001;
pub const RI_RIGHT_DOWN: u16 = 0x0004;
pub const RI_MIDDLE_DOWN: u16 = 0x0010;
pub const RI_BUTTON4_DOWN: u16 = 0x0040;
pub const RI_BUTTON5_DOWN: u16 = 0x0100;
const ANY_CLICK: u16 = RI_LEFT_DOWN | RI_RIGHT_DOWN | RI_MIDDLE_DOWN | RI_BUTTON4_DOWN | RI_BUTTON5_DOWN;

/// Сырое движение мыши приходит в отсчётах датчика; настоящий DPI Windows не сообщает, берём
/// типичные 800 (как в pc_wrapped) — путь в километрах получается примерный, так и подписан.
pub const MOUSE_DPI: f64 = 800.0;
const MM_PER_INCH: f64 = 25.4;

/// Итоги ввода с запуска программы: окно копит разницу в статистику (stats.ts, absorb).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Totals {
    pub keys: u64,
    pub mouse_mm: u64,
}

/// Что тику нужно знать о текущем моменте.
pub struct Now {
    pub date: String,
    pub hm: String,
    pub instant: Instant,
}

impl Now {
    pub fn local() -> Self {
        let t = chrono::Local::now();
        Now {
            date: t.format("%Y-%m-%d").to_string(),
            hm: t.format("%H:%M").to_string(),
            instant: Instant::now(),
        }
    }
}

/// Итоги дня: чистое время за компом и по программам. Из этого растёт питомец
/// и собирается профиль интересов. Только имена программ, никаких заголовков окон.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Day {
    pub date: String,
    pub active_seconds: u64,
    pub apps: HashMap<String, u64>,
}

impl Day {
    pub fn new(date: &str) -> Self {
        Day { date: date.into(), ..Default::default() }
    }
}

/// Нажатия и клики за минуту: «кликов мало» и «пишет код» различаются именно так.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Pace {
    pub keys: u32,
    pub clicks: u32,
}

pub struct Tracker {
    pub day: Day,
    pressed: [bool; 256],
    hm: String,
    /// Набирается сейчас; при смене минуты уезжает в `last_minute`.
    minute: Pace,
    last_minute: Pace,
    last_input: Option<Instant>,
    last_key: Option<Instant>,
    session_start: Option<Instant>,
    last_active: Option<Instant>,
    keys_total: u64,
    mouse_mm: f64,
}

impl Tracker {
    pub fn new(day: Day, now: &Now) -> Self {
        Tracker {
            day,
            pressed: [false; 256],
            hm: now.hm.clone(),
            minute: Pace::default(),
            last_minute: Pace::default(),
            last_input: None,
            last_key: None,
            session_start: None,
            last_active: None,
            keys_total: 0,
            mouse_mm: 0.0,
        }
    }

    fn touch(&mut self) {
        self.last_input = Some(Instant::now());
    }

    /// Клавиша: считаем только нажатие отпущенной клавиши, автоповтор при удержании не в счёт.
    pub fn on_key(&mut self, vk: u16, down: bool) {
        if vk == 0 || vk >= 255 {
            return;
        }
        let i = vk as usize;
        if !down {
            self.pressed[i] = false;
            return;
        }
        if self.pressed[i] {
            return;
        }
        self.pressed[i] = true;
        self.minute.keys += 1;
        self.keys_total += 1;
        self.last_key = Some(Instant::now());
        self.touch();
    }

    /// Относительное движение мыши: человек здесь; путь копится для достижений.
    pub fn on_move(&mut self, dx: i32, dy: i32) {
        if dx != 0 || dy != 0 {
            self.mouse_mm += (dx as f64).hypot(dy as f64) * MM_PER_INCH / MOUSE_DPI;
            self.touch();
        }
    }

    /// Нажатия и путь мыши с запуска.
    pub fn totals(&self) -> Totals {
        Totals { keys: self.keys_total, mouse_mm: self.mouse_mm as u64 }
    }

    /// Флаги кнопок из RAWMOUSE.usButtonFlags.
    pub fn on_buttons(&mut self, flags: u16) {
        self.minute.clicks += (flags & ANY_CLICK).count_ones();
        if flags != 0 {
            self.touch();
        }
    }

    pub fn idle(&self, at: Instant) -> bool {
        match self.last_input {
            Some(t) => at.saturating_duration_since(t) >= IDLE_AFTER,
            None => true,
        }
    }

    pub fn typing(&self, at: Instant) -> bool {
        matches!(self.last_key, Some(t) if at.saturating_duration_since(t) < TYPING_WITHIN)
    }

    /// Темп последней полной минуты.
    pub fn pace(&self) -> Pace {
        self.last_minute
    }

    /// Раз в секунду: чистое время, программы, сессии, смена минуты и суток.
    /// Возвращает завершившийся день, если наступили новые сутки.
    pub fn tick(&mut self, now: &Now, app: Option<&str>) -> Option<Day> {
        let mut finished = None;
        // сессия через полночь не рвётся: 90 минут без перерыва остаются 90 минутами
        if now.date != self.day.date {
            finished = Some(std::mem::replace(&mut self.day, Day::new(&now.date)));
        }
        if now.hm != self.hm {
            self.last_minute = std::mem::take(&mut self.minute);
            self.hm = now.hm.clone();
        }

        if !self.idle(now.instant) {
            self.day.active_seconds += 1;
            if let Some(app) = app {
                *self.day.apps.entry(app.to_string()).or_insert(0) += 1;
            }
            let continues = matches!(self.last_active, Some(t) if now.instant.saturating_duration_since(t) <= SESSION_BREAK);
            if !continues || self.session_start.is_none() {
                self.session_start = Some(now.instant);
            }
            self.last_active = Some(now.instant);
        }
        finished
    }

    /// Сколько секунд длится текущая сессия; 0, если человек отошёл дольше чем на `SESSION_BREAK`.
    /// По ней питомец через 90 минут намекает размяться.
    pub fn session_secs(&self, at: Instant) -> u64 {
        match (self.session_start, self.last_active) {
            (Some(start), Some(last)) if at.saturating_duration_since(last) <= SESSION_BREAK => at.saturating_duration_since(start).as_secs(),
            _ => 0,
        }
    }

    #[cfg(test)]
    fn set_last_input(&mut self, t: Instant) {
        self.last_input = Some(t);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now(date: &str, hm: &str, at: Instant) -> Now {
        Now { date: date.into(), hm: hm.into(), instant: at }
    }

    #[test]
    fn pace_ignores_autorepeat_and_rolls_by_minute() {
        let t0 = Instant::now();
        let mut t = Tracker::new(Day::new("2026-11-01"), &now("2026-11-01", "10:00", t0));
        t.on_key(0x41, true);
        t.on_key(0x41, true); // автоповтор
        t.on_key(0x41, false);
        t.on_key(0x41, true);
        t.on_key(0x08, true);
        t.on_buttons(RI_LEFT_DOWN | RI_RIGHT_DOWN);
        t.on_buttons(0x0002); // отпускание левой — не клик
        t.on_buttons(0x0400); // колесо — не клик, но человек здесь
        assert!(t.typing(Instant::now()));
        assert!(!t.typing(Instant::now() + TYPING_WITHIN));
        // минута ещё идёт — снаружи виден прошлый темп
        t.tick(&now("2026-11-01", "10:00", t0), None);
        assert_eq!(t.pace(), Pace::default());
        t.tick(&now("2026-11-01", "10:01", t0), None);
        assert_eq!(t.pace(), Pace { keys: 3, clicks: 2 });
        t.tick(&now("2026-11-01", "10:02", t0), None);
        assert_eq!(t.pace(), Pace::default());
    }

    #[test]
    fn tick_counts_active_time_sessions_and_rollover() {
        let t0 = Instant::now();
        let mut t = Tracker::new(Day::new("2026-11-01"), &now("2026-11-01", "09:00", t0));
        // без ввода — простой
        assert!(t.tick(&now("2026-11-01", "09:00", t0), Some("Chrome")).is_none());
        assert_eq!(t.day.active_seconds, 0);

        t.set_last_input(t0);
        for s in 0..10 {
            t.tick(&now("2026-11-01", "09:00", t0 + Duration::from_secs(s)), Some("Chrome"));
        }
        assert_eq!(t.day.active_seconds, 10);
        assert_eq!(t.day.apps["Chrome"], 10);
        assert_eq!(t.session_secs(t0 + Duration::from_secs(9)), 9);
        // отошёл больше чем на пять минут — сессия кончилась
        assert_eq!(t.session_secs(t0 + Duration::from_secs(400)), 0);

        // перерыв 10 минут: новая сессия
        let later = t0 + Duration::from_secs(700);
        t.set_last_input(later);
        t.tick(&now("2026-11-01", "09:11", later), Some("Code"));
        assert_eq!(t.session_secs(later), 0);
        assert_eq!(t.day.apps["Code"], 1);

        // полночь: день закрылся, а сессия продолжается
        let midnight = later + Duration::from_secs(1);
        let old = t.tick(&now("2026-11-02", "00:00", midnight), None).unwrap();
        assert_eq!(old.date, "2026-11-01");
        assert_eq!(old.active_seconds, 11);
        assert_eq!(t.day.date, "2026-11-02");
        assert_eq!(t.day.active_seconds, 1);
        assert_eq!(t.session_secs(midnight), 1);
    }

    #[test]
    fn totals_count_presses_and_mouse_path() {
        let t0 = Instant::now();
        let mut t = Tracker::new(Day::new("2026-11-01"), &now("2026-11-01", "10:00", t0));
        assert_eq!(t.totals(), Totals::default());
        t.on_key(0x41, true);
        t.on_key(0x41, true); // автоповтор
        t.on_key(0x41, false);
        t.on_key(0x42, true);
        // 800 отсчётов — дюйм, 25,4 мм; 3-4-5 по диагонали
        t.on_move(800, 0);
        t.on_move(0, 0);
        t.on_move(-480, 640);
        t.tick(&now("2026-11-01", "10:01", t0), None);
        assert_eq!(t.totals(), Totals { keys: 2, mouse_mm: 50 });
    }
}
