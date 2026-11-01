//! Лазерная указка: держишь Ctrl — курсор становится красной точкой, кошка за ней охотится.
//!
//! Включается двумя путями. Ctrl, зажатый в одиночку на [`HOLD`], светит, пока его держат;
//! любое другое нажатие при зажатом Ctrl (клавиша, кнопка мыши, колесо) гасит попытку до
//! отпускания — так Ctrl+C, Ctrl+клик и Ctrl+колесо указку не зовут. Alt не годится: он уже
//! значит «клик сквозь питомца» (hit.rs). Второй путь — `set_laser(true)` из меню: светит,
//! пока не нажмут Esc, не позовут `set_laser(false)` или не начнётся «не мешать» (win::quiet):
//! в играх Ctrl — это присесть, поэтому в полноэкранном указки нет вовсе.
//!
//! Окну питомца уходят "laser" {x, y} — горячая точка курсора в физических пикселях рабочего
//! стола, не чаще 60 раз в секунду и только когда курсор сдвинулся, первое сразу при включении, —
//! и один раз "laser-off" при выключении. Системный курсор не трогаем.
//!
//! Два своих окна, оба прозрачные, сквозь них кликают, фокус они не берут никогда и всегда
//! спрятаны от записи экрана: "laser" — сама точка, её водит за курсором этот поток;
//! "push" — эффект заноса. Когда точка круто разворачивается ([`Turns`]), кусок экрана вокруг
//! разворота снимается в память (BitBlt), окно "push" ложится ровно поверх и рисует этот
//! снимок с искажением: то, что было под точкой, отбросило по ходу заноса, и оно пружинит
//! обратно. На экране ничего не двигается по-настоящему. Снимок не пишется на диск и в лог,
//! уходит только окну "push" и выбрасывается сразу после эффекта (а невостребованный — через [`SHOT_TTL`]).

use crate::world::Rect;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Сколько держать Ctrl в одиночку, чтобы зажглась точка.
pub const HOLD: Duration = Duration::from_millis(400);
/// Опрос клавиш и курсора: 60 раз в секунду, столько же и событий "laser" самое большее.
const POLL: Duration = Duration::from_micros(16_667);
/// Как часто спрашивать win::quiet и поднимать точку наверх: 60 раз в секунду незачем.
const SLOW: Duration = Duration::from_millis(500);
/// Сторона окна точки, логические пиксели. Сама точка — около 10 px, остальное — свечение.
const DOT: f64 = 32.0;
/// Сторона снимаемого вокруг разворота квадрата, логические пиксели.
const AREA: f64 = 160.0;
/// Невостребованный снимок дольше не держим: окно "push" забирает его за миллисекунды.
const SHOT_TTL: Duration = Duration::from_secs(1);

/// Отрезок пути, по которому судят о направлении: несколько опросов, дрожь руки усредняется.
pub const LEG: Duration = Duration::from_millis(60);
/// Минимальная длина входящего и исходящего отрезков, логические пиксели: за [`LEG`] это
/// ~300 px/с. Медленный поворот — не занос, а неподвижный курсор и дрожь столько не набегают.
pub const MIN_LEG: f64 = 18.0;
/// Разворот от 120°: косинус угла между входящим и исходящим направлениями не больше −0.5.
const TURN_COS: f64 = -0.5;
/// Пауза после заноса: один разворот — один эффект.
pub const COOLDOWN: Duration = Duration::from_millis(300);

/// Ctrl в одиночку. Только логика: что зажато, решает поток опроса.
#[derive(Default)]
pub struct Trigger {
    /// С какого опроса держат Ctrl; `None` — отпущен.
    since: Option<Instant>,
    /// Пока Ctrl держат, было что-то ещё — до отпускания не зажигаемся.
    disarmed: bool,
}

impl Trigger {
    /// `ctrl` — зажат ли Ctrl, `other` — зажато или нажато ли с прошлого опроса что-то ещё.
    /// Возвращает, светить ли точке.
    pub fn feed(&mut self, ctrl: bool, other: bool, at: Instant) -> bool {
        if !ctrl {
            *self = Self::default();
            return false;
        }
        let since = *self.since.get_or_insert(at);
        self.disarmed |= other;
        !self.disarmed && at.duration_since(since) >= HOLD
    }

    /// Погасить и не зажигаться, пока Ctrl не отпустят.
    pub fn disarm(&mut self) {
        self.disarmed = self.since.is_some();
    }
}

/// Крутой разворот точки.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turn {
    /// Где развернулась: самая дальняя по ходу точка пути, туда её и занесло. Физ. пиксели.
    pub x: f64,
    pub y: f64,
    /// Куда шла до разворота, единичный вектор: туда и отбрасывает то, что было под ней.
    pub dx: f64,
    pub dy: f64,
}

/// Ищет крутые развороты на пути курсора. Только логика, без WinAPI.
///
/// Каждый опрос кладёт точку в след. Опора — последняя точка, которой уже [`LEG`]; входящее
/// направление — от точки на [`LEG`] раньше опоры до неё, исходящее — от опоры до сейчас.
/// Оба отрезка не короче `min_leg`, угол между ними от 120° — разворот. Сообщаем его с
/// задержкой около [`LEG`], зато без ложных срабатываний на дрожи.
pub struct Turns {
    trail: VecDeque<(f64, f64, Instant)>,
    /// [`MIN_LEG`] в физических пикселях монитора, где сейчас точка.
    min_leg: f64,
    last: Option<Instant>,
}

impl Turns {
    pub fn new(min_leg: f64) -> Self {
        Turns { trail: VecDeque::new(), min_leg, last: None }
    }

    pub fn set_min_leg(&mut self, min_leg: f64) {
        self.min_leg = min_leg;
    }

    /// Забыть путь: точку погасили или зажгли заново.
    pub fn reset(&mut self) {
        self.trail.clear();
        self.last = None;
    }

    pub fn feed(&mut self, x: f64, y: f64, at: Instant) -> Option<Turn> {
        self.trail.push_back((x, y, at));
        while self.trail.front().is_some_and(|s| at.duration_since(s.2) > LEG * 4) {
            self.trail.pop_front();
        }
        if self.last.is_some_and(|t| at.duration_since(t) < COOLDOWN) {
            return None;
        }
        let k = self.trail.iter().rposition(|s| at.duration_since(s.2) >= LEG)?;
        let pivot = self.trail[k];
        let s = self.trail.iter().take(k).rposition(|s| pivot.2.duration_since(s.2) >= LEG)?;
        let start = self.trail[s];
        let (ix, iy) = (pivot.0 - start.0, pivot.1 - start.1);
        let (ox, oy) = (x - pivot.0, y - pivot.1);
        let (il, ol) = (ix.hypot(iy), ox.hypot(oy));
        if il < self.min_leg || ol < self.min_leg || (ix * ox + iy * oy) / (il * ol) > TURN_COS {
            return None;
        }
        let (dx, dy) = (ix / il, iy / il);
        let ahead = |p: &&(f64, f64, Instant)| (p.0 - pivot.0) * dx + (p.1 - pivot.1) * dy;
        let tip = self.trail.range(k..).max_by(|a, b| ahead(a).total_cmp(&ahead(b)))?;
        self.last = Some(at);
        Some(Turn { x: tip.0, y: tip.1, dx, dy })
    }
}

/// Квадрат `side` вокруг точки, обрезанный монитором.
pub fn area(x: i32, y: i32, side: i32, monitor: Rect) -> Rect {
    let (left, top) = (x - side / 2, y - side / 2);
    Rect {
        left: left.max(monitor.left),
        top: top.max(monitor.top),
        right: (left + side).min(monitor.right),
        bottom: (top + side).min(monitor.bottom),
    }
}

/// Что окно "push" узнаёт о снимке до того, как забрать пиксели.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShotMeta {
    id: u32,
    /// Размер снимка, физ. пиксели; пикселей придёт `width * height * 4` байт RGBA.
    width: u32,
    height: u32,
    /// Точка разворота внутри снимка, физ. пиксели.
    x: f64,
    y: f64,
    /// Куда заносило, единичный вектор.
    dx: f64,
    dy: f64,
    /// DPI / 96 монитора, где разворот.
    scale: f64,
    /// Стороны (левая, верхняя, правая, нижняя), за которыми нет экрана: у них смещение
    /// не обязано гаснуть, шва там не видно. У остальных оно сходит к нулю ровно на краю.
    open: [bool; 4],
}

/// Последний снимок. Новый вытесняет старый вместе с пикселями.
struct Shot {
    id: u32,
    rect: Rect,
    pixels: Option<Vec<u8>>,
    at: Option<Instant>,
}

static SHOT: Mutex<Shot> = Mutex::new(Shot { id: 0, rect: Rect { left: 0, top: 0, right: 0, bottom: 0 }, pixels: None, at: None });

/// Включили из меню: светит до Esc, `set_laser(false)` или «не мешать».
static STICKY: AtomicBool = AtomicBool::new(false);
/// Попросили погасить: поток гасит и ждёт, пока отпустят Ctrl.
static OFF: AtomicBool = AtomicBool::new(false);

/// Окно размером `side` логических пикселей: прозрачное, поверх всех, спрятанное, мышь насквозь.
/// Фокус не берёт: показывает и двигает его этот модуль через WinAPI без активации.
fn build_window(app: &AppHandle, label: &str, side: f64) -> tauri::Result<WebviewWindow> {
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("DeskPartner")
        .inner_size(side, side)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .focusable(false)
        .content_protected(true)
        .build()?;
    w.set_ignore_cursor_events(true)?;
    Ok(w)
}

/// Строит окна точки и эффекта и запускает поток опроса. Зовётся один раз при старте:
/// окно из синхронной команды на Windows строить нельзя (wry#583), поэтому заранее.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let dot = build_window(app, "laser", DOT)?;
    let push = build_window(app, "push", AREA)?;
    #[cfg(windows)]
    sys::start(app.clone(), &dot, &push)?;
    #[cfg(not(windows))]
    let _ = (dot, push);
    Ok(())
}

/// Включить указку до Esc (`true`) или погасить её, как бы её ни включили (`false`).
#[tauri::command]
pub fn set_laser(on: bool) {
    STICKY.store(on, Ordering::Relaxed);
    if !on {
        OFF.store(true, Ordering::Relaxed);
    }
}

/// Пиксели снимка `id`, RGBA построчно сверху вниз. Отдаются один раз: в памяти Rust
/// после этого их нет. Устаревший или чужой `id` — ошибка, окно просто ждёт следующего.
#[tauri::command]
pub fn push_pixels(id: u32) -> Result<tauri::ipc::Response, String> {
    let mut shot = SHOT.lock().unwrap();
    if shot.id != id {
        return Err("снимок уже заменён".into());
    }
    shot.pixels.take().map(tauri::ipc::Response::new).ok_or_else(|| "снимок уже отдан".into())
}

/// Окно "push" готово рисовать снимок `id`: положить его ровно поверх снятого места и показать.
#[tauri::command]
pub fn push_show(id: u32) -> Result<(), String> {
    let shot = SHOT.lock().unwrap();
    if shot.id != id {
        return Err("снимок уже заменён".into());
    }
    #[cfg(windows)]
    sys::show_push(shot.rect);
    Ok(())
}

/// Эффект `id` доиграл: спрятать окно, если за это время не начался новый.
#[tauri::command]
pub fn push_done(id: u32) {
    let mut shot = SHOT.lock().unwrap();
    if shot.id == id {
        shot.pixels = None;
        #[cfg(windows)]
        sys::hide_push();
    }
}

#[cfg(windows)]
mod sys {
    use super::*;
    use crate::win::{self, Quiet};
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;
    use std::sync::OnceLock;
    use tauri::Emitter;
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, GetMonitorInfoW,
        MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL, SRCCOPY,
    };
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LCONTROL, VK_RCONTROL};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetCursorPos, GetWindowRect, SetWindowDisplayAffinity, SetWindowPos, ShowWindowAsync, HWND_TOPMOST,
        SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, WDA_EXCLUDEFROMCAPTURE,
    };

    /// Окна как числа: HWND — сырой указатель, между потоками его так не передать.
    struct Hwnds {
        dot: isize,
        push: isize,
        /// Под кем лежит "push": под миской, а она под кошкой. Кошка спрятана от записи и в
        /// снимок не попадает — лёг бы снимок сверху, кошка пропала бы на полсекунды.
        under: isize,
        /// Спрятать "push" от захвата не вышло (Windows старше 10 2004): снимок увидел бы
        /// сам себя, поэтому эффекта нет совсем. Точку это не трогает.
        push_ok: bool,
    }

    static HWNDS: OnceLock<Hwnds> = OnceLock::new();

    fn hwnd(w: &WebviewWindow) -> tauri::Result<isize> {
        Ok(w.hwnd()?.0 as isize)
    }

    /// Спрятать от записи экрана и скриншотов: снимок под эффект не должен видеть ни точку, ни сам эффект.
    fn exclude(h: isize) -> bool {
        // SAFETY: только меняет атрибут окна.
        unsafe { SetWindowDisplayAffinity(h as HWND, WDA_EXCLUDEFROMCAPTURE) != 0 }
    }

    pub fn start(app: AppHandle, dot: &WebviewWindow, push: &WebviewWindow) -> tauri::Result<()> {
        let (d, p) = (hwnd(dot)?, hwnd(push)?);
        let under = ["bowl", "pet"]
            .iter()
            .find_map(|l| tauri::Manager::get_webview_window(&app, l))
            .and_then(|w| hwnd(&w).ok())
            .unwrap_or(HWND_TOPMOST as isize);
        if !exclude(d) {
            eprintln!("laser: точку не удалось спрятать от записи экрана");
        }
        let push_ok = exclude(p);
        if !push_ok {
            eprintln!("laser: окно эффекта не прячется от захвата — эффект заноса выключен");
        }
        let _ = HWNDS.set(Hwnds { dot: d, push: p, under, push_ok });
        std::thread::Builder::new().name("laser".into()).spawn(move || run(app)).map_err(tauri::Error::Io)?;
        Ok(())
    }

    fn down(vk: u16) -> bool {
        // SAFETY: только читает состояние клавиши.
        unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
    }

    /// Зажато ли сейчас что-то кроме Ctrl: клавиши и кнопки мыши (у них тоже есть коды).
    fn other_down() -> bool {
        (1u16..=254).filter(|vk| ![VK_CONTROL, VK_LCONTROL, VK_RCONTROL].contains(vk)).any(down)
    }

    /// Нажат ли Esc: зажат или успел нажаться и отпуститься с прошлого опроса.
    fn esc() -> bool {
        // SAFETY: только читает состояние клавиши.
        unsafe { GetAsyncKeyState(VK_ESCAPE as i32) != 0 }
    }

    fn cursor() -> Option<(i32, i32)> {
        let mut p = POINT { x: 0, y: 0 };
        // SAFETY: функция только пишет в переданную точку.
        (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
    }

    /// Монитор под точкой: его прямоугольник и DPI / 96.
    fn monitor(x: i32, y: i32) -> (Rect, f64) {
        // SAFETY: MonitorFromPoint с DEFAULTTONEAREST всегда что-то возвращает, остальное пишет в свои структуры.
        unsafe {
            let m = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = zeroed();
            mi.cbSize = size_of::<MONITORINFO>() as u32;
            GetMonitorInfoW(m, &mut mi);
            let (mut dx, mut dy) = (0u32, 0u32);
            let ok = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) >= 0 && dx > 0;
            let r = mi.rcMonitor;
            (Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, if ok { dx as f64 / 96.0 } else { 1.0 })
        }
    }

    fn on_screen(x: i32, y: i32) -> bool {
        // SAFETY: только спрашивает, есть ли монитор в точке.
        !unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL) }.is_null()
    }

    /// Где поставить внешний угол окна и какого размера оно должно быть, чтобы его внутренняя
    /// область встала ровно на `left, top` размером `w × h`: Windows добавляет невидимые поля
    /// даже окну без рамки (см. world::place_pet).
    fn frame(h: isize, left: i32, top: i32, w: i32, hgt: i32) -> (i32, i32, i32, i32) {
        // SAFETY: читают геометрию нашего окна в свои структуры.
        unsafe {
            let (mut wr, mut cr): (RECT, RECT) = (zeroed(), zeroed());
            let mut origin = POINT { x: 0, y: 0 };
            if GetWindowRect(h as HWND, &mut wr) == 0
                || GetClientRect(h as HWND, &mut cr) == 0
                || ClientToScreen(h as HWND, &mut origin) == 0
            {
                return (left, top, w, hgt);
            }
            let (ox, oy) = (origin.x - wr.left, origin.y - wr.top);
            let extra_w = (wr.right - wr.left) - (cr.right - cr.left);
            let extra_h = (wr.bottom - wr.top) - (cr.bottom - cr.top);
            (left - ox, top - oy, w + extra_w, hgt + extra_h)
        }
    }

    /// Поставить точку центром внутренней области на курсор. `raise` — заодно поднять её
    /// над всеми окнами поверх всех и показать; без него z-order не трогаем.
    fn move_dot(h: isize, x: i32, y: i32, raise: bool) {
        // SAFETY: читают размер нашего окна; SetWindowPos асинхронный и без активации.
        unsafe {
            let mut cr: RECT = zeroed();
            if GetClientRect(h as HWND, &mut cr) == 0 {
                return;
            }
            // окно бывает шире заказанного (SM_CXMINTRACK, см. hit.rs): точка нарисована по центру настоящего
            let (left, top, _, _) = frame(h, x - cr.right / 2, y - cr.bottom / 2, cr.right, cr.bottom);
            let mut flags = SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS;
            flags |= if raise { SWP_SHOWWINDOW } else { SWP_NOZORDER };
            SetWindowPos(h as HWND, HWND_TOPMOST, left, top, 0, 0, flags);
        }
    }

    fn hide(h: isize) {
        // SAFETY: асинхронно прячет наше окно, не дожидаясь его потока.
        unsafe { ShowWindowAsync(h as HWND, SW_HIDE) };
    }

    /// Зовётся из команды push_show (главный поток, хозяин окна), поэтому синхронно.
    pub fn show_push(r: Rect) {
        let Some(h) = HWNDS.get() else { return };
        let (w, hgt) = (r.right - r.left, r.bottom - r.top);
        // два раза: переезд на монитор с другим DPI заставит окно поменять размер (WM_DPICHANGED),
        // второй вызов уже без переезда возвращает нужный
        for flags in [SWP_NOACTIVATE, SWP_NOACTIVATE | SWP_SHOWWINDOW] {
            let (left, top, fw, fh) = frame(h.push, r.left, r.top, w, hgt);
            // SAFETY: двигает и показывает наше окно без активации.
            unsafe { SetWindowPos(h.push as HWND, h.under as HWND, left, top, fw, fh, flags) };
        }
    }

    pub fn hide_push() {
        if let Some(h) = HWNDS.get() {
            hide(h.push);
        }
    }

    /// Снять экран в прямоугольнике `r` в память: RGBA, построчно сверху вниз. Окна точки и
    /// эффекта спрятаны от захвата, поэтому в снимок не попадают.
    fn grab(r: Rect) -> Option<Vec<u8>> {
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        // SAFETY: всё созданное здесь же и освобождается; биты DIB читаются после GdiFlush,
        // пока секция жива, и ровно в её размере w × h × 4.
        unsafe {
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return None;
            }
            let mem = CreateCompatibleDC(screen);
            let mut bmi: BITMAPINFO = zeroed();
            bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                // отрицательная высота — строки сверху вниз, как в ImageData
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..zeroed()
            };
            let mut bits: *mut c_void = null_mut();
            let dib = CreateDIBSection(mem, &bmi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            let mut out = None;
            if !mem.is_null() && !dib.is_null() && !bits.is_null() {
                let old = SelectObject(mem, dib);
                // CAPTUREBLT — вместе со слоистыми окнами, иначе прозрачные окна пропали бы со снимка
                if BitBlt(mem, 0, 0, w, h, screen, r.left, r.top, SRCCOPY | CAPTUREBLT) != 0 {
                    GdiFlush();
                    let src = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
                    let mut px = Vec::with_capacity(src.len());
                    // BGRx → RGBA, непрозрачный: эффект закрывает экран целиком
                    for c in src.chunks_exact(4) {
                        px.extend_from_slice(&[c[2], c[1], c[0], 255]);
                    }
                    out = Some(px);
                }
                SelectObject(mem, old);
            }
            if !dib.is_null() {
                DeleteObject(dib);
            }
            if !mem.is_null() {
                DeleteDC(mem);
            }
            ReleaseDC(null_mut(), screen);
            out
        }
    }

    /// Снять место разворота и позвать окно "push". Идёт в своём потоке: BitBlt с экрана
    /// занимает до десятков миллисекунд, точка за курсором за это время не должна замирать.
    fn skid(app: AppHandle, turn: Turn) {
        let (tx, ty) = (turn.x.round() as i32, turn.y.round() as i32);
        let (mon, scale) = monitor(tx, ty);
        let r = area(tx, ty, (AREA * scale).round() as i32, mon);
        let Some(pixels) = grab(r) else { return };
        let open = [
            r.left == mon.left && !on_screen(r.left - 1, ty),
            r.top == mon.top && !on_screen(tx, r.top - 1),
            r.right == mon.right && !on_screen(r.right, ty),
            r.bottom == mon.bottom && !on_screen(tx, r.bottom),
        ];
        let meta = {
            let mut shot = SHOT.lock().unwrap();
            shot.id = shot.id.wrapping_add(1);
            shot.rect = r;
            shot.pixels = Some(pixels);
            shot.at = Some(Instant::now());
            ShotMeta {
                id: shot.id,
                width: (r.right - r.left) as u32,
                height: (r.bottom - r.top) as u32,
                x: turn.x - r.left as f64,
                y: turn.y - r.top as f64,
                dx: turn.dx,
                dy: turn.dy,
                scale,
                open,
            }
        };
        if let Err(err) = app.emit_to("push", "push", meta) {
            eprintln!("push: {err}");
        }
    }

    #[derive(Clone, serde::Serialize)]
    struct Dot {
        x: i32,
        y: i32,
    }

    fn run(app: AppHandle) {
        let Some(h) = HWNDS.get() else { return };
        let mut trigger = Trigger::default();
        let mut turns = Turns::new(MIN_LEG);
        let mut on = false;
        let mut quiet = false;
        let mut was_sticky = false;
        // счётчик нажатий raw input на прошлом опросе: сдвинулся при зажатом Ctrl — было что-то ещё
        let mut presses = win::presses();
        let mut last: Option<(i32, i32)> = None;
        let mut slow = Instant::now() - SLOW;
        let mut next = Instant::now();
        loop {
            next += POLL;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                // проспали (сон, перегрузка) — не догоняем пачкой опросов
                next = now;
            }
            let at = Instant::now();
            {
                let mut shot = SHOT.lock().unwrap();
                if shot.at.is_some_and(|t| at.duration_since(t) > SHOT_TTL) {
                    shot.pixels = None;
                    shot.at = None;
                }
            }
            let slow_tick = at.duration_since(slow) >= SLOW;
            if slow_tick {
                slow = at;
                quiet = win::quiet() != Quiet::No;
            }

            let ctrl = down(VK_CONTROL);
            let count = win::presses();
            let other = ctrl && (count != presses || other_down());
            presses = count;
            let mut held = trigger.feed(ctrl, other, at);
            if OFF.swap(false, Ordering::Relaxed) {
                trigger.disarm();
                held = false;
            }
            let sticky = STICKY.load(Ordering::Relaxed);
            if sticky && !was_sticky {
                // только что включили из меню: сбросить у Esc «нажат с прошлого раза»,
                // иначе давнее нажатие погасило бы указку сразу
                let _ = esc();
            } else if sticky && esc() {
                STICKY.store(false, Ordering::Relaxed);
            }
            let mut want = held || STICKY.load(Ordering::Relaxed);
            // зажечься можно и между медленными тиками — тогда «не мешать» спросим прямо сейчас
            if want && !on && !slow_tick {
                quiet = win::quiet() != Quiet::No;
            }
            if quiet {
                STICKY.store(false, Ordering::Relaxed);
                trigger.disarm();
                want = false;
            }
            was_sticky = STICKY.load(Ordering::Relaxed);

            if want != on {
                on = want;
                turns.reset();
                last = None;
                if !on {
                    hide(h.dot);
                    if let Err(err) = app.emit_to("pet", "laser-off", ()) {
                        eprintln!("laser-off: {err}");
                    }
                }
            }
            if !on {
                continue;
            }
            let Some((x, y)) = cursor() else { continue };
            if slow_tick || last.is_none() {
                turns.set_min_leg(MIN_LEG * monitor(x, y).1);
            }
            if last != Some((x, y)) || slow_tick {
                // при включении и раз в SLOW — показать и поднять над окнами, что встали поверх
                move_dot(h.dot, x, y, last.is_none() || slow_tick);
            }
            if last != Some((x, y)) {
                last = Some((x, y));
                if let Err(err) = app.emit_to("pet", "laser", Dot { x, y }) {
                    eprintln!("laser: {err}");
                }
            }
            if let Some(turn) = turns.feed(x as f64, y as f64, at) {
                if h.push_ok {
                    let app = app.clone();
                    let _ = std::thread::Builder::new().name("laser-skid".into()).spawn(move || skid(app, turn));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(t0: Instant, n: u64) -> Instant {
        t0 + Duration::from_millis(n)
    }

    #[test]
    fn ctrl_alone_lights_after_hold() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        assert!(!t.feed(true, false, t0));
        assert!(!t.feed(true, false, ms(t0, 399)));
        assert!(t.feed(true, false, ms(t0, 400)));
        assert!(t.feed(true, false, ms(t0, 2000)));
        assert!(!t.feed(false, false, ms(t0, 2017)));
    }

    #[test]
    fn other_key_disarms_until_release() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        t.feed(true, false, t0);
        // Ctrl+C: C нажата до порога — до отпускания Ctrl точки нет
        assert!(!t.feed(true, true, ms(t0, 100)));
        assert!(!t.feed(true, false, ms(t0, 600)));
        // и после порога тоже гасит
        t.feed(false, false, ms(t0, 700));
        t.feed(true, false, ms(t0, 800));
        assert!(t.feed(true, false, ms(t0, 1200)));
        assert!(!t.feed(true, true, ms(t0, 1300)));
        assert!(!t.feed(true, false, ms(t0, 1400)));
        // отпустили и зажали заново — снова можно
        t.feed(false, false, ms(t0, 1500));
        t.feed(true, false, ms(t0, 1600));
        assert!(t.feed(true, false, ms(t0, 2000)));
    }

    #[test]
    fn key_held_before_ctrl_disarms() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        // Shift зажат раньше Ctrl: уже на первом опросе «что-то ещё»
        assert!(!t.feed(true, true, t0));
        assert!(!t.feed(true, false, ms(t0, 1000)));
    }

    #[test]
    fn disarm_waits_for_release() {
        let t0 = Instant::now();
        let mut t = Trigger::default();
        t.feed(true, false, t0);
        assert!(t.feed(true, false, ms(t0, 500)));
        t.disarm();
        assert!(!t.feed(true, false, ms(t0, 600)));
        // отпущенный Ctrl погасить нечем: следующее нажатие работает как обычно
        t.feed(false, false, ms(t0, 700));
        t.disarm();
        t.feed(true, false, ms(t0, 800));
        assert!(t.feed(true, false, ms(t0, 1200)));
    }

    /// Ведёт курсор по точкам `path` (x, y) с шагом опроса ~16.7 мс, возвращает развороты.
    fn drive(turns: &mut Turns, t0: Instant, path: &[(f64, f64)]) -> Vec<(u64, Turn)> {
        let mut out = Vec::new();
        for (i, &(x, y)) in path.iter().enumerate() {
            let at = t0 + POLL * i as u32;
            if let Some(t) = turns.feed(x, y, at) {
                out.push((i as u64, t));
            }
        }
        out
    }

    /// Прямо со скоростью `v` px за опрос `n` шагов от `from` в направлении `dir`.
    fn line(from: (f64, f64), dir: (f64, f64), v: f64, n: usize) -> Vec<(f64, f64)> {
        let l = dir.0.hypot(dir.1);
        (1..=n).map(|i| (from.0 + dir.0 / l * v * i as f64, from.1 + dir.1 / l * v * i as f64)).collect()
    }

    fn path(legs: &[((f64, f64), usize)], v: f64) -> Vec<(f64, f64)> {
        let mut p = vec![(500.0, 500.0)];
        for &(dir, n) in legs {
            let from = *p.last().unwrap();
            p.extend(line(from, dir, v, n));
        }
        p
    }

    #[test]
    fn straight_line_is_not_a_turn() {
        let mut t = Turns::new(MIN_LEG);
        assert!(drive(&mut t, Instant::now(), &path(&[((1.0, 0.3), 40)], 20.0)).is_empty());
    }

    #[test]
    fn still_cursor_is_not_a_turn() {
        let mut t = Turns::new(MIN_LEG);
        assert!(drive(&mut t, Instant::now(), &vec![(300.0, 300.0); 60]).is_empty());
    }

    #[test]
    fn jitter_is_not_a_turn() {
        let mut t = Turns::new(MIN_LEG);
        // дрожь руки: туда-сюда на 3 px каждый опрос
        let p: Vec<_> = (0..120).map(|i| (300.0 + [0.0, 3.0, -2.0, 2.5][i % 4], 300.0 + [1.0, -3.0, 2.0, 0.0][i % 4])).collect();
        assert!(drive(&mut t, Instant::now(), &p).is_empty());
    }

    #[test]
    fn sharp_reversal_is_a_turn_at_the_tip() {
        let mut t = Turns::new(MIN_LEG);
        // вправо 10 опросов по 25 px (1500 px/с), потом обратно
        let p = path(&[((1.0, 0.0), 10), ((-1.0, 0.0), 10)], 25.0);
        let found = drive(&mut t, Instant::now(), &p);
        assert_eq!(found.len(), 1);
        let (i, turn) = found[0];
        assert!((turn.x - 750.0).abs() < 1e-9 && (turn.y - 500.0).abs() < 1e-9, "{turn:?}");
        assert!((turn.dx - 1.0).abs() < 1e-9 && turn.dy.abs() < 1e-9);
        // и заметили быстро: не позже ~100 мс после разворота
        assert!(i <= 10 + 6, "опрос {i}");
    }

    #[test]
    fn turn_angle_threshold() {
        let a = |deg: f64| {
            let r = deg.to_radians();
            let mut t = Turns::new(MIN_LEG);
            // поворот на deg от направления «вправо»
            let p = path(&[((1.0, 0.0), 10), ((r.cos(), r.sin()), 10)], 25.0);
            drive(&mut t, Instant::now(), &p)
        };
        assert!(a(90.0).is_empty());
        assert!(a(110.0).is_empty());
        let found = a(135.0);
        assert_eq!(found.len(), 1);
        // точка — у угла, а не там, где разворот заметили
        assert!((found[0].1.x - 750.0).abs() <= 25.0, "{:?}", found[0].1);
        assert_eq!(a(170.0).len(), 1);
    }

    #[test]
    fn slow_reversal_is_not_a_skid() {
        let mut t = Turns::new(MIN_LEG);
        // 4 px за опрос — 240 px/с: за LEG не набирается MIN_LEG
        let p = path(&[((1.0, 0.0), 30), ((-1.0, 0.0), 30)], 4.0);
        assert!(drive(&mut t, Instant::now(), &p).is_empty());
    }

    #[test]
    fn min_leg_scales_with_monitor() {
        let p = path(&[((1.0, 0.0), 10), ((-1.0, 0.0), 10)], 7.0);
        assert_eq!(drive(&mut Turns::new(MIN_LEG), Instant::now(), &p).len(), 1);
        // на мониторе 200% та же скорость в физических пикселях — вдвое медленнее для глаза
        assert!(drive(&mut Turns::new(MIN_LEG * 2.0), Instant::now(), &p).is_empty());
    }

    #[test]
    fn cooldown_merges_quick_turns() {
        let t0 = Instant::now();
        // три разворота подряд через ~100 мс: тряска вправо-влево
        let p = path(&[((1.0, 0.0), 8), ((-1.0, 0.0), 6), ((1.0, 0.0), 6), ((-1.0, 0.0), 6)], 25.0);
        let found = drive(&mut Turns::new(MIN_LEG), t0, &p);
        assert_eq!(found.len(), 1, "{found:?}");
        // а через паузу больше COOLDOWN — второй
        let p = path(&[((1.0, 0.0), 8), ((-1.0, 0.0), 24), ((1.0, 0.0), 10)], 25.0);
        assert_eq!(drive(&mut Turns::new(MIN_LEG), t0, &p).len(), 2);
    }

    #[test]
    fn reset_forgets_the_path() {
        let t0 = Instant::now();
        let mut t = Turns::new(MIN_LEG);
        let p = path(&[((1.0, 0.0), 10)], 25.0);
        drive(&mut t, t0, &p);
        t.reset();
        // после сброса тот же путь обратно — без входящего отрезка разворота нет
        let back: Vec<_> = line((750.0, 500.0), (-1.0, 0.0), 25.0, 10);
        let found: Vec<_> =
            back.iter().enumerate().filter_map(|(i, &(x, y))| t.feed(x, y, t0 + POLL * (11 + i as u32))).collect();
        assert!(found.is_empty());
    }

    #[test]
    fn area_is_clipped_by_monitor() {
        let m = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };
        assert_eq!(area(500, 500, 160, m), Rect { left: 420, top: 420, right: 580, bottom: 580 });
        assert_eq!(area(10, 1075, 160, m), Rect { left: 0, top: 995, right: 90, bottom: 1080 });
        let left = Rect { left: -1280, top: -200, right: 0, bottom: 824 };
        assert_eq!(area(-5, -190, 240, left), Rect { left: -125, top: -200, right: 0, bottom: -70 });
    }
}
