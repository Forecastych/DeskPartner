//! Глотать Esc, пока он что-то значит для питомца: закрыть его меню или погасить указку.
//!
//! Меню и указка фокус не берут, поэтому Esc достаётся активной программе: закрыли меню —
//! а заодно вышли из диалога в игре или сбросили выделение в редакторе. Пока жив хоть один
//! [`Trap`], стоит низкоуровневый хук клавиатуры (WH_KEYBOARD_LL): он видит Esc раньше программы
//! и съедает его вместе с отпусканием. Остальные клавиши хук пропускает сразу, а без нужды
//! его нет вовсе — постоянно ввод читаем через Raw Input, почему — см. win.rs.
//!
//! Съеденный Esc до GetAsyncKeyState уже не доходит, ждущие смотрят на [`Trap::pressed`].
//! Хук поставить не вышло — Esc проходит к программе, как раньше, и виден по GetAsyncKeyState.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

/// Сколько живых [`Trap`]: больше нуля — хук нужен.
static USERS: AtomicU32 = AtomicU32::new(0);
/// Сколько нажатий Esc съедено за всё время.
static EATEN: AtomicU32 = AtomicU32::new(0);
/// Съеденный Esc ещё не отпустили: его отпускание и автоповтор тоже наши.
static HELD: AtomicBool = AtomicBool::new(false);

/// Пока жив — Esc не доходит до активной программы.
pub struct Trap {
    seen: u32,
}

impl Trap {
    pub fn new() -> Self {
        USERS.fetch_add(1, Ordering::Relaxed);
        #[cfg(windows)]
        sys::wake();
        Trap { seen: EATEN.load(Ordering::Relaxed) }
    }

    /// Съели ли Esc с прошлого вопроса (или с создания).
    pub fn pressed(&mut self) -> bool {
        let now = EATEN.load(Ordering::Relaxed);
        let fresh = now != self.seen;
        self.seen = now;
        fresh
    }
}

impl Drop for Trap {
    fn drop(&mut self) {
        USERS.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Решение хука по одному событию Esc: съесть ли его. Только логика, без WinAPI.
fn eat(down: bool) -> bool {
    let wanted = USERS.load(Ordering::Relaxed) > 0;
    if down && wanted {
        EATEN.fetch_add(1, Ordering::Relaxed);
        HELD.store(true, Ordering::Relaxed);
        return true;
    }
    // меню уже закрылось, а Esc ещё держат: автоповтор и отпускание тоже не отдаём
    if down {
        return HELD.load(Ordering::Relaxed);
    }
    HELD.swap(false, Ordering::Relaxed)
}

fn needed() -> bool {
    USERS.load(Ordering::Relaxed) > 0 || HELD.load(Ordering::Relaxed)
}

#[cfg(windows)]
mod sys {
    use std::ptr::null_mut;
    use std::sync::OnceLock;
    use std::thread::{self, Thread};
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, MsgWaitForMultipleObjects, PeekMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
        HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, MSG, PM_REMOVE, QS_ALLINPUT, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    /// Как часто поток с хуком проверяет, нужен ли тот ещё. Само событие клавиши будит его сразу.
    const CHECK_MS: u32 = 50;
    /// Без хука поток спит; новый Trap будит его раньше.
    const IDLE: Duration = Duration::from_secs(1);

    static THREAD: OnceLock<Option<Thread>> = OnceLock::new();

    /// Разбудить поток хука, а при первом вызове — запустить.
    pub fn wake() {
        let t = THREAD.get_or_init(|| match thread::Builder::new().name("esc-trap".into()).spawn(run) {
            Ok(h) => Some(h.thread().clone()),
            Err(err) => {
                eprintln!("esc-trap: {err}");
                None
            }
        });
        if let Some(t) = t {
            t.unpark();
        }
    }

    unsafe extern "system" fn hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            // SAFETY: для WH_KEYBOARD_LL с HC_ACTION lParam указывает на KBDLLHOOKSTRUCT.
            let k = unsafe { &*(lp as *const KBDLLHOOKSTRUCT) };
            if k.vkCode == VK_ESCAPE as u32 && super::eat(matches!(wp as u32, WM_KEYDOWN | WM_SYSKEYDOWN)) {
                return 1;
            }
        }
        // SAFETY: передаём событие дальше по цепочке как есть.
        unsafe { CallNextHookEx(null_mut(), code, wp, lp) }
    }

    /// Хук низкого уровня зовётся в потоке, который его поставил, и только пока тот разбирает
    /// сообщения: поток не должен спать без MsgWait, иначе ввод всей системы ждал бы его.
    fn run() {
        let mut hooked: HHOOK = null_mut();
        let mut warned = false;
        loop {
            let need = super::needed();
            if need && hooked.is_null() {
                // SAFETY: процедура хука живёт всё время работы программы, модуль — наш exe.
                hooked = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), GetModuleHandleW(null_mut()), 0) };
                if hooked.is_null() && !warned {
                    eprintln!("esc-trap: хук клавиатуры не поставился, Esc дойдёт и до программы");
                    warned = true;
                }
            } else if !need && !hooked.is_null() {
                // SAFETY: снимаем свой же хук в том же потоке.
                unsafe { UnhookWindowsHookEx(hooked) };
                hooked = null_mut();
            }
            if hooked.is_null() {
                thread::park_timeout(IDLE);
                continue;
            }
            // SAFETY: ждём сообщений без объектов и разбираем свою очередь.
            unsafe {
                MsgWaitForMultipleObjects(0, null_mut(), 0, CHECK_MS, QS_ALLINPUT);
                let mut msg: MSG = std::mem::zeroed();
                while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                    DispatchMessageW(&msg);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Счётчики общие на процесс, поэтому всё в одном тесте: параллельные тесты мешали бы друг другу.
    #[test]
    fn eats_only_while_trapped_and_finishes_the_press() {
        HELD.store(false, Ordering::Relaxed);
        // никто не ждёт — Esc программе
        assert!(!eat(true));
        assert!(!eat(false));

        let mut t = Trap::new();
        assert!(!t.pressed());
        assert!(eat(true));
        assert!(t.pressed());
        assert!(!t.pressed(), "одно нажатие считается один раз");

        // меню закрылось по этому Esc, а клавишу ещё держат: автоповтор и отпускание не отдаём
        drop(t);
        assert!(needed(), "хук ждёт отпускания");
        assert!(eat(true));
        assert!(eat(false));
        assert!(!needed());

        // следующее нажатие уже не наше
        assert!(!eat(true));
        assert!(!eat(false));
    }
}
