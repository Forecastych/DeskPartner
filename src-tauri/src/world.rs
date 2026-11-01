//! Карта мира для питомца: мониторы и верхние кромки окон, на которых можно сидеть.
//!
//! Фронтенд сам решает, куда идти; отсюда он получает только геометрию — всё в физических
//! пикселях рабочего стола, как GetCursorPos и позиция окна. Кромка — верхний край видимой
//! рамки окна, кроме кусков, закрытых окнами выше по z-order. У развёрнутого окна рамки нет,
//! зато есть полоса заголовка левее кнопок. Вычитание кусков — чистые функции [`ledges`]
//! и [`strips`], WinAPI только перечисляет окна и мониторы.
//!
//! Заголовки окон не читаются: про чужое окно узнаём только рамку, стили и имя класса.

use serde::Serialize;
use tauri::{PhysicalPosition, WebviewWindow};

/// Прямоугольник в физических пикселях; `right` и `bottom` в него не входят.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    pub rect: Rect,
    /// Без панели задач и прочих пристыкованных панелей.
    pub work: Rect,
    /// DPI / 96: 1.0 при масштабе 100%, 1.5 при 150%.
    pub scale: f64,
    pub primary: bool,
}

/// Открытый кусок верхней кромки окна: строка `y`, столбцы `left..right`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledge {
    pub hwnd: i64,
    pub y: i32,
    pub left: i32,
    pub right: i32,
    /// Видимая рамка всего окна — одна и та же у всех кусков одного окна.
    pub frame: Rect,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    /// Основной монитор первым.
    pub monitors: Vec<Monitor>,
    /// По z-order окон сверху вниз.
    pub ledges: Vec<Ledge>,
    /// Корневое окно, в котором работает человек; нет, если это рабочий стол, панель задач
    /// или окно, которого нет среди помех (своё, свёрнутое, спрятанное).
    pub active: Option<i64>,
    /// Полосы заголовков развёрнутых окон левее кнопок «свернуть/развернуть/закрыть»,
    /// по z-order сверху вниз; у каждого окна не больше одной.
    pub strips: Vec<Ledge>,
}

/// Окно, которое закрывает то, что под ним. Список таких окон идёт сверху вниз по z-order.
#[derive(Clone, Copy, Debug)]
pub struct Win {
    pub hwnd: i64,
    /// Видимая рамка, без невидимых полей для ресайза.
    pub frame: Rect,
    /// На кромке можно сидеть; иначе окно только закрывает кромки тех, кто ниже.
    pub perch: bool,
    /// У развёрнутого обычного окна — левый край кнопок заголовка: до него тянется полоса.
    pub strip: Option<i32>,
}

/// Открытые куски кромок: у каждого насеста строка `frame.top` минус всё, что закрывают окна выше.
pub fn ledges(windows: &[Win]) -> Vec<Ledge> {
    let mut out = Vec::new();
    for (i, w) in windows.iter().enumerate() {
        let f = w.frame;
        if !w.perch || f.right - f.left < 1 {
            continue;
        }
        let y = f.top;
        let open = uncovered(&windows[..i], y, (f.left, f.right));
        out.extend(open.into_iter().map(|(left, right)| Ledge { hwnd: w.hwnd, y, left, right, frame: f }));
    }
    out
}

/// Полосы заголовков: у каждого окна со `strip` строка `frame.top` от левого края до кнопок
/// минус окна выше. От окна — только самый широкий кусок, при равных — левый.
pub fn strips(windows: &[Win]) -> Vec<Ledge> {
    let mut out = Vec::new();
    for (i, w) in windows.iter().enumerate() {
        let Some(buttons) = w.strip else { continue };
        let f = w.frame;
        let y = f.top;
        let open = uncovered(&windows[..i], y, (f.left, buttons.min(f.right)));
        if let Some((left, right)) = open.into_iter().rev().max_by_key(|&(l, r)| r - l) {
            out.push(Ledge { hwnd: w.hwnd, y, left, right, frame: f });
        }
    }
    out
}

/// Куски отрезка `span` строки `y`, не закрытые окнами `above`.
fn uncovered(above: &[Win], y: i32, span: (i32, i32)) -> Vec<(i32, i32)> {
    let mut open: Vec<_> = [span].into_iter().filter(|&(l, r)| r - l >= 1).collect();
    for a in above.iter().map(|a| a.frame) {
        // окно выше режет кромку, только если накрывает саму строку y
        if a.top <= y && y < a.bottom {
            open = open.into_iter().flat_map(|s| cut(s, (a.left, a.right))).collect();
        }
    }
    open
}

/// Отрезок `l..r` минус `cl..cr`: ноль, один или два непустых куска.
fn cut((l, r): (i32, i32), (cl, cr): (i32, i32)) -> impl Iterator<Item = (i32, i32)> {
    [(l, r.min(cl)), (l.max(cr), r)].into_iter().filter(|&(a, b)| b - a >= 1)
}

/// Мониторы, кромки и активное окно прямо сейчас. Фронтенд сам обрезает кромки экранами
/// и проверяет, хватает ли над ними места.
#[tauri::command]
pub fn world() -> World {
    let windows = sys::windows();
    // активное считаем, только если оно среди помех: так отсеиваются свои, свёрнутые и спрятанные
    let active = sys::active().filter(|&h| windows.iter().any(|w| w.hwnd == h));
    World { monitors: sys::monitors(), ledges: ledges(&windows), active, strips: strips(&windows) }
}

/// Ставит окно питомца так, чтобы середина его внутренней области была на `x`,
/// а нижний край — на `bottom` (физ. пиксели). За край экрана уводить можно: так кошка уходит.
/// Зовут до ~25 раз в секунду, поэтому на удачном пути молчим.
#[tauri::command]
pub fn place_pet(window: WebviewWindow, x: i32, bottom: i32) -> Result<(), String> {
    let e = |err: tauri::Error| err.to_string();
    // set_position ставит внешний угол, а Windows добавляет невидимые поля даже окну без рамки
    let (outer, inner) = (window.outer_position().map_err(e)?, window.inner_position().map_err(e)?);
    // окно бывает шире заказанного (SM_CXMINTRACK, см. hit.rs), поэтому берём настоящий размер
    let size = window.inner_size().map_err(e)?;
    let left = x - size.width as i32 / 2;
    let top = bottom - size.height as i32;
    window
        .set_position(PhysicalPosition::new(left - (inner.x - outer.x), top - (inner.y - outer.y)))
        .map_err(e)
}

#[cfg(windows)]
mod sys {
    use super::{Monitor, Rect, Win};
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows_sys::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CAPTION_BUTTON_BOUNDS, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER,
        MONITORINFOF_PRIMARY, WS_CHILD, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    /// Классы рабочего стола и панелей задач: на них не сидят, хотя закрывать они закрывают.
    const SHELL: [&str; 4] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

    impl From<RECT> for Rect {
        fn from(r: RECT) -> Self {
            Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        }
    }

    pub fn monitors() -> Vec<Monitor> {
        unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            let list = &mut *(data as *mut Vec<Monitor>);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(m, &mut mi) != 0 {
                let (mut dx, mut dy) = (0u32, 0u32);
                let ok = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) >= 0 && dx > 0;
                list.push(Monitor {
                    rect: mi.rcMonitor.into(),
                    work: mi.rcWork.into(),
                    scale: if ok { dx as f64 / 96.0 } else { 1.0 },
                    primary: mi.dwFlags & MONITORINFOF_PRIMARY != 0,
                });
            }
            1
        }
        let mut list: Vec<Monitor> = Vec::new();
        // SAFETY: колбэк зовётся синхронно, пока `list` жив.
        unsafe { EnumDisplayMonitors(null_mut(), null(), Some(each), &mut list as *mut _ as LPARAM) };
        // порядок перечисления произвольный; сортировка устойчивая
        list.sort_by_key(|m| !m.primary);
        list
    }

    /// Окна-помехи сверху вниз по z-order, у каждого отмечено, годится ли оно в насест.
    pub fn windows() -> Vec<Win> {
        unsafe extern "system" fn each(h: HWND, data: LPARAM) -> BOOL {
            (*(data as *mut Vec<HWND>)).push(h);
            1
        }
        let mut all: Vec<HWND> = Vec::new();
        // SAFETY: колбэк зовётся синхронно, пока `all` жив.
        unsafe { EnumWindows(Some(each), &mut all as *mut _ as LPARAM) };
        let me = std::process::id();
        // окно могли закрыть после перечисления — тогда вызовы просто не удадутся
        all.into_iter().filter_map(|h| unsafe { classify(h, me) }).collect()
    }

    unsafe fn classify(h: HWND, me: u32) -> Option<Win> {
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, &mut pid);
        // свои окна — ни насест, ни помеха: сам питомец не должен закрывать себе дорогу
        if pid == me || IsWindowVisible(h) == 0 || IsIconic(h) != 0 || cloaked(h) {
            return None;
        }
        let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        // прозрачные для кликов оверлеи (NVIDIA, Steam) растянуты на весь экран и закрыли бы всё
        if ex & WS_EX_TRANSPARENT != 0 {
            return None;
        }
        let frame = frame(h)?;
        if frame.right <= frame.left || frame.bottom <= frame.top {
            return None;
        }
        let style = GetWindowLongW(h, GWL_STYLE) as u32;
        // тул-окна и окна с владельцем (меню, подсказки, попапы) — не насест
        let normal = ex & WS_EX_TOOLWINDOW == 0 && style & WS_CHILD == 0 && GetWindow(h, GW_OWNER).is_null() && !shell(h);
        // у развёрнутого рамки нет, зато есть полоса заголовка
        let zoomed = IsZoomed(h) != 0;
        let strip = if normal && zoomed { Some(buttons(h, frame)) } else { None };
        Some(Win { hwnd: h as isize as i64, frame, perch: normal && !zoomed, strip })
    }

    /// Корень окна на переднем плане. Рабочий стол и панели задач — не «окно, где работают».
    pub fn active() -> Option<i64> {
        // SAFETY: только чтение по дескриптору; окно могло исчезнуть — тогда вызовы не удадутся
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return None;
            }
            // фокус бывает у дочернего окна; кромки и заголовок — у корня
            let root = GetAncestor(fg, GA_ROOT);
            let h = if root.is_null() { fg } else { root };
            if shell(h) {
                return None;
            }
            Some(h as isize as i64)
        }
    }

    /// Левый край кнопок заголовка в абсолютных физ. пикселях; `frame` — видимая рамка окна.
    unsafe fn buttons(h: HWND, frame: Rect) -> i32 {
        let mut b: RECT = std::mem::zeroed();
        let mut w: RECT = std::mem::zeroed();
        let hr = DwmGetWindowAttribute(
            h,
            DWMWA_CAPTION_BUTTON_BOUNDS as u32,
            &mut b as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        );
        // DWM отдаёт кнопки относительно GetWindowRect, вместе с невидимыми полями
        if hr >= 0 && b.right > b.left && b.bottom > b.top && GetWindowRect(h, &mut w) != 0 {
            return w.left + b.left;
        }
        // свой заголовок или DWM молчит: три кнопки по 46 px при 100%
        let dpi = match GetDpiForWindow(h) {
            0 => 96,
            d => d as i32,
        };
        frame.right - 138 * dpi / 96
    }

    /// Окна других виртуальных рабочих столов и призраки UWP видимы, но спрятаны DWM.
    unsafe fn cloaked(h: HWND) -> bool {
        let mut c = 0u32;
        let hr = DwmGetWindowAttribute(h, DWMWA_CLOAKED as u32, &mut c as *mut u32 as *mut c_void, size_of::<u32>() as u32);
        hr >= 0 && c != 0
    }

    /// Видимая рамка: на Win10 GetWindowRect включает невидимые поля ресайза, DWM их не считает.
    unsafe fn frame(h: HWND) -> Option<Rect> {
        let mut r: RECT = std::mem::zeroed();
        let hr = DwmGetWindowAttribute(
            h,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut r as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        );
        if hr >= 0 || GetWindowRect(h, &mut r) != 0 {
            Some(r.into())
        } else {
            None
        }
    }

    /// Имя класса — не заголовок: по нему узнаём рабочий стол и панели задач.
    unsafe fn shell(h: HWND) -> bool {
        let mut buf = [0u16; 64];
        let n = GetClassNameW(h, buf.as_mut_ptr(), buf.len() as i32);
        let name = &buf[..n.max(0) as usize];
        SHELL.iter().any(|s| s.encode_utf16().eq(name.iter().copied()))
    }
}

#[cfg(not(windows))]
mod sys {
    use super::{Monitor, Win};

    pub fn monitors() -> Vec<Monitor> {
        Vec::new()
    }
    pub fn windows() -> Vec<Win> {
        Vec::new()
    }
    pub fn active() -> Option<i64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect { left, top, right, bottom }
    }

    fn perch(hwnd: i64, frame: Rect) -> Win {
        Win { hwnd, frame, perch: true, strip: None }
    }

    fn cover(hwnd: i64, frame: Rect) -> Win {
        Win { hwnd, frame, perch: false, strip: None }
    }

    /// Развёрнутое окно с кнопками заголовка от `buttons`.
    fn maxed(hwnd: i64, frame: Rect, buttons: i32) -> Win {
        Win { hwnd, frame, perch: false, strip: Some(buttons) }
    }

    /// Полосы как (hwnd, left, right).
    fn strip_spans(ws: &[Win]) -> Vec<(i64, i32, i32)> {
        strips(ws).into_iter().map(|l| (l.hwnd, l.left, l.right)).collect()
    }

    /// Куски кромок как (hwnd, left, right) — y и frame проверяются отдельно.
    fn spans(ws: &[Win]) -> Vec<(i64, i32, i32)> {
        ledges(ws).into_iter().map(|l| (l.hwnd, l.left, l.right)).collect()
    }

    #[test]
    fn lone_window_gives_whole_edge() {
        let f = rect(100, 200, 500, 600);
        assert_eq!(ledges(&[perch(1, f)]), vec![Ledge { hwnd: 1, y: 200, left: 100, right: 500, frame: f }]);
    }

    #[test]
    fn fully_covered_edge_vanishes() {
        let ws = [perch(1, rect(0, 0, 1000, 800)), perch(2, rect(100, 200, 500, 600))];
        assert_eq!(spans(&ws), vec![(1, 0, 1000)]);
    }

    #[test]
    fn middle_cover_splits_in_two() {
        let ws = [perch(1, rect(200, 100, 300, 400)), perch(2, rect(100, 200, 500, 600))];
        let got = ledges(&ws);
        assert_eq!(spans(&ws), vec![(1, 200, 300), (2, 100, 200), (2, 300, 500)]);
        // у обоих кусков одного окна та же строка и та же рамка
        assert!(got[1..].iter().all(|l| l.y == 200 && l.frame == rect(100, 200, 500, 600)));
    }

    #[test]
    fn edge_cover_trims_one_side() {
        let ws = [cover(1, rect(0, 150, 250, 300)), perch(2, rect(100, 200, 500, 600))];
        assert_eq!(spans(&ws), vec![(2, 250, 500)]);
        let ws = [cover(1, rect(450, 150, 900, 300)), perch(2, rect(100, 200, 500, 600))];
        assert_eq!(spans(&ws), vec![(2, 100, 450)]);
        // впритык справа (right исключительно) — ни пикселя не закрыто
        let ws = [cover(1, rect(0, 150, 100, 300)), perch(2, rect(100, 200, 500, 600))];
        assert_eq!(spans(&ws), vec![(2, 100, 500)]);
    }

    #[test]
    fn cover_off_the_edge_row_does_not_cut() {
        let f = rect(100, 200, 500, 600);
        // целиком над кромкой: bottom исключительно, строку 200 не накрывает
        assert_eq!(spans(&[cover(1, rect(0, 50, 1000, 200)), perch(2, f)]), vec![(2, 100, 500)]);
        // ниже кромки: закрывает окно, но не верхнюю строку
        assert_eq!(spans(&[cover(1, rect(0, 201, 1000, 900)), perch(2, f)]), vec![(2, 100, 500)]);
        // ровно одна строка, и это строка кромки — режет
        assert_eq!(spans(&[cover(1, rect(0, 200, 1000, 201)), perch(2, f)]), vec![]);
    }

    #[test]
    fn lower_window_does_not_cut() {
        let ws = [perch(1, rect(100, 200, 500, 600)), cover(2, rect(0, 0, 1000, 800))];
        assert_eq!(spans(&ws), vec![(1, 100, 500)]);
    }

    #[test]
    fn non_perch_cuts_but_gives_nothing() {
        let ws = [cover(1, rect(200, 100, 300, 400)), perch(2, rect(100, 200, 500, 600))];
        assert_eq!(spans(&ws), vec![(2, 100, 200), (2, 300, 500)]);
        assert!(ledges(&[cover(1, rect(0, 0, 100, 100))]).is_empty());
    }

    #[test]
    fn several_covers_in_a_row_and_overlapping() {
        let f = rect(0, 100, 1000, 500);
        // три помехи подряд, между ними щели
        let ws = [
            cover(1, rect(100, 0, 200, 300)),
            cover(2, rect(300, 50, 400, 150)),
            cover(3, rect(600, 100, 700, 101)),
            perch(4, f),
        ];
        assert_eq!(spans(&ws), vec![(4, 0, 100), (4, 200, 300), (4, 400, 600), (4, 700, 1000)]);
        // внахлёст: 100..400 и 300..800 вместе закрывают 100..800
        let ws = [cover(1, rect(100, 0, 400, 300)), cover(2, rect(300, 0, 800, 300)), perch(3, f)];
        assert_eq!(spans(&ws), vec![(3, 0, 100), (3, 800, 1000)]);
        // впритык друг к другу и к краям — щелей нет совсем
        let ws = [cover(1, rect(-50, 0, 500, 300)), cover(2, rect(500, 0, 1200, 300)), perch(3, f)];
        assert_eq!(spans(&ws), vec![]);
    }

    #[test]
    fn slivers_under_one_pixel_dropped() {
        // от кромки остаётся ровно 1 px слева — отдаём; пустые куски — нет
        let ws = [cover(1, rect(101, 0, 600, 300)), perch(2, rect(100, 200, 500, 600))];
        assert_eq!(spans(&ws), vec![(2, 100, 101)]);
        // рамка нулевой ширины не насест
        assert!(ledges(&[perch(1, rect(100, 200, 100, 600))]).is_empty());
    }

    /// Развёрнутое окно на весь экран 1920x1040.
    const MAX: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1040 };

    #[test]
    fn strip_of_uncovered_window_runs_to_buttons() {
        assert_eq!(strips(&[maxed(7, MAX, 1782)]), vec![Ledge { hwnd: 7, y: 0, left: 0, right: 1782, frame: MAX }]);
    }

    #[test]
    fn strip_cut_by_window_above_keeps_widest_piece() {
        // поверх заголовка висит окно 300..500: слева 300 px, справа 1282 — берём правый
        let ws = [cover(1, rect(300, -10, 500, 200)), maxed(7, MAX, 1782)];
        assert_eq!(strip_spans(&ws), vec![(7, 500, 1782)]);
        // теперь шире левый кусок
        let ws = [cover(1, rect(1200, 0, 1700, 200)), maxed(7, MAX, 1782)];
        assert_eq!(strip_spans(&ws), vec![(7, 0, 1200)]);
        // окно выше, но не на строке заголовка — не режет
        let ws = [cover(1, rect(300, 1, 500, 200)), maxed(7, MAX, 1782)];
        assert_eq!(strip_spans(&ws), vec![(7, 0, 1782)]);
    }

    #[test]
    fn strip_right_clamped_to_frame() {
        assert_eq!(strip_spans(&[maxed(7, MAX, 5000)]), vec![(7, 0, 1920)]);
    }

    #[test]
    fn strip_empty_gives_nothing() {
        let f = rect(100, 0, 1920, 1040);
        assert!(strips(&[maxed(7, f, 100)]).is_empty());
        assert!(strips(&[maxed(7, f, 50)]).is_empty());
        // заголовок закрыт целиком
        assert!(strips(&[cover(1, rect(0, 0, 1920, 30)), maxed(7, MAX, 1782)]).is_empty());
    }

    #[test]
    fn strip_ignores_windows_below() {
        let ws = [maxed(7, MAX, 1782), cover(2, rect(0, 0, 1000, 500)), perch(3, rect(200, 0, 900, 400))];
        assert_eq!(strip_spans(&ws), vec![(7, 0, 1782)]);
    }

    #[test]
    fn strips_only_for_windows_with_buttons() {
        // обычные окна и помехи полос не дают; развёрнутые на двух мониторах — по одной, сверху вниз
        let second = rect(1920, 0, 3840, 1040);
        let ws = [perch(1, rect(100, 200, 500, 600)), maxed(2, second, 3702), cover(3, MAX), maxed(4, MAX, 1782)];
        assert_eq!(strip_spans(&ws), vec![(2, 1920, 3702)]);
        let ws = [perch(1, rect(100, 200, 500, 600)), maxed(2, second, 3702), maxed(4, MAX, 1782)];
        assert_eq!(strip_spans(&ws), vec![(2, 1920, 3702), (4, 0, 1782)]);
    }

    #[test]
    fn json_shape() {
        let w = World {
            monitors: vec![Monitor { rect: rect(0, 0, 1920, 1080), work: rect(0, 0, 1920, 1040), scale: 1.25, primary: true }],
            ledges: vec![Ledge { hwnd: 42, y: 200, left: 100, right: 300, frame: rect(100, 200, 500, 600) }],
            active: Some(7),
            strips: vec![Ledge { hwnd: 7, y: 0, left: 0, right: 1782, frame: MAX }],
        };
        let json = serde_json::to_string(&w).unwrap();
        assert_eq!(
            json,
            r#"{"monitors":[{"rect":{"left":0,"top":0,"right":1920,"bottom":1080},"work":{"left":0,"top":0,"right":1920,"bottom":1040},"scale":1.25,"primary":true}],"ledges":[{"hwnd":42,"y":200,"left":100,"right":300,"frame":{"left":100,"top":200,"right":500,"bottom":600}}],"active":7,"strips":[{"hwnd":7,"y":0,"left":0,"right":1782,"frame":{"left":0,"top":0,"right":1920,"bottom":1040}}]}"#
        );
        // без активного окна — null, а не пропуск ключа
        let json = serde_json::to_string(&World::default()).unwrap();
        assert_eq!(json, r#"{"monitors":[],"ledges":[],"active":null,"strips":[]}"#);
    }

    /// Карта этой машины: `cargo test -- --ignored --nocapture`. Без заголовков — только геометрия.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn print_real_world() {
        use windows_sys::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
        // приложению это включает Tauri; без него Windows отдаёт координаты в виртуальных пикселях
        unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        let wins = sys::windows();
        let w = world();
        println!("мониторов: {}", w.monitors.len());
        for m in &w.monitors {
            println!("  {:?} work {:?} scale {} primary {}", m.rect, m.work, m.scale, m.primary);
        }
        println!("помех: {}, из них насестов: {}", wins.len(), wins.iter().filter(|w| w.perch).count());
        println!("кусков кромок: {}", w.ledges.len());
        for l in &w.ledges {
            println!("  hwnd {:#x} y {} x {}..{} ({} px)", l.hwnd, l.y, l.left, l.right, l.right - l.left);
        }
        match w.active.and_then(|h| wins.iter().find(|w| w.hwnd == h)) {
            Some(a) => println!("активное: hwnd {:#x} frame {:?} кнопки {:?}", a.hwnd, a.frame, a.strip),
            None => println!("активное: нет (сырой sys::active {:?})", sys::active().map(|h| format!("{h:#x}"))),
        }
        println!("полос заголовков: {}", w.strips.len());
        for s in &w.strips {
            println!("  hwnd {:#x} y {} x {}..{} ({} px) frame {:?}", s.hwnd, s.y, s.left, s.right, s.right - s.left, s.frame);
        }
        assert!(!w.monitors.is_empty());
        assert!(w.monitors[0].primary);
    }
}
