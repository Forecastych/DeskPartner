mod hit;
mod tracker;
#[cfg(windows)]
mod win;

use hit::{HitMask, SPRITE};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tracker::{Day, Now, Pace, Tracker};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Во сколько раз увеличиваем пиксель арта при масштабе Windows 100%.
/// 32 × 4 = 128: при любом шаге масштаба в 25% клетка остаётся целым числом экранных пикселей.
const ZOOM: f64 = 4.0;

/// Что питомец знает о человеке прямо сейчас.
struct Senses {
    tracker: Arc<Mutex<Tracker>>,
    /// Программа в активном окне на последнем тике.
    app: Mutex<Option<String>>,
}

#[derive(serde::Serialize)]
struct SensesNow {
    app: Option<String>,
    idle: bool,
    typing: bool,
    pace: Pace,
    session_secs: u64,
    active_today_secs: u64,
    #[cfg(windows)]
    quiet: win::Quiet,
}

#[tauri::command]
fn set_hit_mask(mask: State<'_, Arc<HitMask>>, rows: Vec<u32>) {
    mask.set(rows);
}

#[tauri::command]
fn senses(s: State<'_, Arc<Senses>>) -> SensesNow {
    let at = Instant::now();
    let t = s.tracker.lock().unwrap();
    SensesNow {
        app: s.app.lock().unwrap().clone(),
        idle: t.idle(at),
        typing: t.typing(at),
        pace: t.pace(),
        session_secs: t.session_secs(at),
        active_today_secs: t.day.active_seconds,
        #[cfg(windows)]
        quiet: win::quiet(),
    }
}

/// Сырой ввод и тик раз в секунду: чистое время, программы, сессии.
#[cfg(windows)]
fn start_senses(s: Arc<Senses>) {
    win::start_input(s.tracker.clone());
    std::thread::Builder::new()
        .name("senses-tick".into())
        .spawn(move || {
            let mut fg = win::Foreground::new();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let app = fg.current();
                // закончившийся день пока выбрасываем: хранилища ещё нет
                let _ = s.tracker.lock().unwrap().tick(&Now::local(), app.as_deref());
                *s.app.lock().unwrap() = app;
            }
        })
        .expect("senses tick thread");
}

/// Окно размером с питомца: прозрачное, поверх всех, без рамки, без значка на панели задач.
/// Фокус не берёт ни при показе, ни по клику — иначе клик по зверю свернул бы игру.
fn build_pet_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let side = SPRITE as f64 * ZOOM;
    let mut b = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html".into()))
        .title("DeskPartner")
        .inner_size(side, side)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false);
    // пока сидит в правом нижнем углу над панелью задач; ходить научится позже
    if let Some(m) = app.primary_monitor()? {
        let sf = m.scale_factor();
        let wa = m.work_area();
        let x = (wa.position.x as f64 + wa.size.width as f64) / sf - side - 24.0;
        let y = (wa.position.y as f64 + wa.size.height as f64) / sf - side;
        b = b.position(x, y);
    }
    b.build()
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // некормленый кот уходит навсегда — без этого пункта вернуть питомца было бы нечем
    let adopt = MenuItem::with_id(app, "adopt", "Новый котик", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&adopt, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("DeskPartner")
        .menu(&menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "adopt" => {
                if let Err(err) = app.emit_to("pet", "adopt", ()) {
                    eprintln!("adopt: {err}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mask = Arc::new(HitMask::default());
    let now = Now::local();
    let feel = Arc::new(Senses {
        tracker: Arc::new(Mutex::new(Tracker::new(Day::new(&now.date), &now))),
        app: Mutex::new(None),
    });
    tauri::Builder::default()
        // второй экземпляр просто закрывается: два одинаковых питомца — уже не питомец
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .manage(mask.clone())
        .manage(feel.clone())
        .invoke_handler(tauri::generate_handler![set_hit_mask, senses])
        .setup(move |app| {
            #[cfg(windows)]
            start_senses(feel);
            let pet = build_pet_window(app.handle())?;
            hit::spawn(pet, mask);
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить DeskPartner");
}
