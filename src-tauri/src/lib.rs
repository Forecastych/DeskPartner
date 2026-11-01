mod hit;

use hit::{HitMask, SPRITE};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Во сколько раз увеличиваем пиксель арта при масштабе Windows 100%.
/// 32 × 4 = 128: при любом шаге масштаба в 25% клетка остаётся целым числом экранных пикселей.
const ZOOM: f64 = 4.0;

#[tauri::command]
fn set_hit_mask(mask: State<'_, Arc<HitMask>>, rows: Vec<u32>) {
    mask.set(rows);
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
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("DeskPartner")
        .menu(&menu)
        .on_menu_event(|app, e| {
            if e.id() == "quit" {
                app.exit(0);
            }
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
    tauri::Builder::default()
        // второй экземпляр просто закрывается: два одинаковых питомца — уже не питомец
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .manage(mask.clone())
        .invoke_handler(tauri::generate_handler![set_hit_mask])
        .setup(move |app| {
            let pet = build_pet_window(app.handle())?;
            hit::spawn(pet, mask);
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить DeskPartner");
}
