//! Клики сквозь окна-спрайты (питомец, миска) везде, кроме нарисованных пикселей.
//!
//! Прозрачный WebView ловит мышь всем прямоугольником, по пикселям Windows его не режет.
//! Поэтому окно по умолчанию пропускает мышь насквозь, а отдельный поток на окно часто смотрит,
//! над каким пикселем спрайта курсор, и принимает мышь, только пока тот над рисунком.
//! С зажатым Alt клик проходит насквозь всегда.
//! У питомца тот же опрос кормит детектор тряски (shake.rs): потрясли курсором — событие "shake".

use crate::shake::Shake;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, WebviewWindow};

/// Сторона спрайта в пикселях арта.
pub const SPRITE: u32 = 32;

/// Как часто проверять курсор: 30 раз в секунду хватает, чтобы клик не проскочил мимо.
const POLL: Duration = Duration::from_millis(33);

/// Формы текущих кадров по меткам окон: по строке на ряд спрайта, бит x — в клетке нарисован
/// пиксель. Пока окно маску не прислало, оно целиком пропускает мышь.
#[derive(Default)]
pub struct Masks(Mutex<HashMap<String, Vec<u32>>>);

impl Masks {
    pub fn set(&self, label: &str, rows: Vec<u32>) {
        self.0.lock().unwrap().insert(label.to_owned(), rows);
    }

    fn contains(&self, label: &str, x: i64, y: i64) -> bool {
        if x < 0 || y < 0 || x >= SPRITE as i64 {
            return false;
        }
        let masks = self.0.lock().unwrap();
        masks.get(label).and_then(|m| m.get(y as usize)).is_some_and(|row| row >> x & 1 == 1)
    }
}

pub fn spawn(window: WebviewWindow, masks: Arc<Masks>) {
    let _ = window.set_ignore_cursor_events(true);
    thread::spawn(move || {
        let label = window.label().to_owned();
        let mut ignoring = true;
        // будят тряской только кошку: миске событие ни к чему
        let mut shake = (label == "pet").then(Shake::default);
        loop {
            thread::sleep(POLL);
            // внутренняя область, а не внешняя: Windows добавляет невидимые поля даже окну без рамки.
            // Окно закрыли — следить больше не за чем.
            let (Ok(pos), Ok(size)) = (window.inner_position(), window.inner_size()) else { break };
            let Some((cx, cy)) = input::cursor() else { continue };
            let (alt, held) = (input::alt_down(), input::left_button_down());
            // Спрайт — квадрат по центру окна (см. app.css): окно бывает шире заказанного,
            // Windows не даёт ему быть уже SM_CXMINTRACK (136 px при масштабе 100%).
            let side = size.width.min(size.height) as f64;
            let cell = side / SPRITE as f64;
            let left = pos.x as f64 + (size.width as f64 - side) / 2.0;
            let top = pos.y as f64 + (size.height as f64 - side) / 2.0;
            let x = ((cx as f64 - left) / cell).floor() as i64;
            let y = ((cy as f64 - top) / cell).floor() as i64;
            // трясут над всем квадратом, а не по силуэту: промах мимо уха не должен сбивать счёт.
            // Alt — «пропусти меня», с зажатой кнопкой человек что-то тащит: это не тряска.
            if let Some(shake) = shake.as_mut() {
                let over = (0..SPRITE as i64).contains(&x) && (0..SPRITE as i64).contains(&y);
                if over && !alt && !held {
                    if shake.feed(cx, cy, Instant::now()) {
                        if let Err(err) = window.emit_to("pet", "shake", ()) {
                            eprintln!("shake: {err}");
                        }
                    }
                } else {
                    shake.reset();
                }
            }
            // пока кнопка зажата над рисунком, не отпускаем мышь, даже если курсор съехал с силуэта
            if !ignoring && held {
                continue;
            }
            let want = !masks.contains(&label, x, y) || alt;
            if want != ignoring && window.set_ignore_cursor_events(want).is_ok() {
                ignoring = want;
            }
        }
    });
}

#[cfg(windows)]
mod input {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MENU};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    /// Курсор в физических пикселях рабочего стола — в тех же, что и позиция окна.
    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = POINT { x: 0, y: 0 };
        (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
    }

    fn down(key: u16) -> bool {
        unsafe { GetAsyncKeyState(key as i32) as u16 & 0x8000 != 0 }
    }

    pub fn alt_down() -> bool {
        down(VK_MENU)
    }

    pub fn left_button_down() -> bool {
        down(VK_LBUTTON)
    }
}

#[cfg(not(windows))]
mod input {
    pub fn cursor() -> Option<(i32, i32)> {
        None
    }
    pub fn alt_down() -> bool {
        false
    }
    pub fn left_button_down() -> bool {
        false
    }
}
