//! Окна приложения. "pet" и "bowl" — прозрачные спрайты поверх всего, клики сквозь них
//! проходят везде, кроме рисунка (hit.rs). "setup" — обычное окно первого запуска: пока
//! человек не выбрал папку данных и не сохранил настройки (store.rs), питомца нет, есть только оно.
//! "settings" — обычное окно настроек, открывается из трея и меню питомца.

mod hit;
mod laser;
mod menu;
mod shake;
mod store;
mod tracker;
#[cfg(windows)]
mod win;
mod world;

use hit::{Masks, SPRITE};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tracker::{Day, Now, Pace, Tracker};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Во сколько раз увеличиваем пиксель арта при масштабе Windows 100%.
/// 32 × 4 = 128: при любом шаге масштаба в 25% клетка остаётся целым числом экранных пикселей.
const ZOOM: f64 = 4.0;

/// Окна-спрайты на рабочем столе. Порядок — это порядок по глубине: построенное позже
/// ложится сверху, и кошка, что пришла есть, должна быть перед миской, а не под горкой корма.
const SPRITES: [&str; 2] = ["bowl", "pet"];

/// Кого прячет галочка «Прятать от записи экрана». Точку лазера и её эффекты laser.rs прячет всегда сам.
const CAPTURED: [&str; 3] = ["bowl", "pet", "menu"];

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

/// Маска текущего кадра того окна, которое её прислало.
#[tauri::command]
fn set_hit_mask(window: WebviewWindow, masks: State<'_, Arc<Masks>>, rows: Vec<u32>) {
    masks.set(window.label(), rows);
}

/// Прятать ли питомца и миску от записи экрана и скриншотов.
#[tauri::command]
fn set_capture_hidden(app: AppHandle, hidden: bool) -> Result<(), String> {
    for w in CAPTURED.iter().filter_map(|l| app.get_webview_window(l)) {
        w.set_content_protected(hidden).map_err(|e| e.to_string())?;
    }
    Ok(())
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

/// Окно размером со спрайт: прозрачное, поверх всех, без рамки, без значка на панели задач.
/// Фокус не берёт ни при показе, ни по клику — иначе клик по зверю свернул бы игру.
/// От записи экрана спрятано сразу: так стоит настройка по умолчанию, а выбранную
/// фронтенд применит сам через set_capture_hidden.
fn build_sprite_window(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let side = SPRITE as f64 * ZOOM;
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("DeskPartner")
        .inner_size(side, side)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .content_protected(true);
    // появляется в правом нижнем углу над панелью задач, дальше окно водит фронтенд (place_pet)
    if let Some(m) = app.primary_monitor()? {
        let sf = m.scale_factor();
        let wa = m.work_area();
        let x = (wa.position.x as f64 + wa.size.width as f64) / sf - side - 24.0;
        let y = (wa.position.y as f64 + wa.size.height as f64) / sf - side;
        b = b.position(x, y);
    }
    b.build()
}

/// Питомец и миска, у каждого свой поток прозрачности для кликов.
fn open_sprites(app: &AppHandle) -> tauri::Result<()> {
    let masks = app.state::<Arc<Masks>>().inner().clone();
    for label in SPRITES {
        hit::spawn(build_sprite_window(app, label)?, masks.clone());
    }
    // меню и лазер строятся заранее и прячутся: по клику окно только показывают, без задержки
    menu::build(app)?;
    laser::build(app)?;
    Ok(())
}

/// Первый запуск: обычное окно, где выбирают папку данных.
/// Закрыли, не закончив, — питомцу негде хранить свою жизнь, выходим.
fn build_setup_window(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
        .title("DeskPartner — первый запуск")
        // рамка своя, пиксельная (src/ui): +32 под её полосу заголовка; тень системная
        .inner_size(560.0, 712.0)
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .center()
        .focused(true)
        .build()?;
    let app = app.clone();
    w.on_window_event(move |e| {
        // finish_setup открывает питомца раньше, чем закрывает это окно, — тогда не выходим
        if matches!(e, WindowEvent::Destroyed) && app.get_webview_window("pet").is_none() {
            app.exit(0);
        }
    });
    Ok(())
}

/// Папка выбрана: открыть питомца и миску, закрыть окно первого запуска.
/// async нарочно: синхронная команда выполняется в главном потоке, а создание WebView-окна
/// оттуда на Windows виснет — построитель ждёт событийный цикл, который сам же и занимает
/// (wry#583). Асинхронная идёт в пуле async-рантайма и только ставит окно в очередь цикла.
#[tauri::command]
async fn finish_setup(app: AppHandle) -> Result<(), String> {
    if !store::has_dir() {
        return Err("папка данных не выбрана".into());
    }
    // повторный вызов (двойной клик по кнопке) не должен строить окна с занятыми метками
    if app.get_webview_window("pet").is_none() {
        open_sprites(&app).map_err(|e| e.to_string())?;
    }
    if let Some(w) = app.get_webview_window("setup") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Окно настроек: обычное, одно на всё приложение. Открыто — поднять его, а не строить второе.
/// Пока идёт первый запуск, настраивать нечего — поднимаем мастер.
/// Закрытие этого окна программу не закрывает: питомец и миска остаются.
fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("settings").or_else(|| app.get_webview_window("setup")) {
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title("DeskPartner — настройки")
        .inner_size(560.0, 752.0)
        .min_inner_size(460.0, 512.0)
        .decorations(false)
        .shadow(true)
        .center()
        .focused(true)
        .build()?;
    Ok(())
}

/// async по той же причине, что и finish_setup: окно из синхронной команды вешает Windows (wry#583).
#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

/// Сменить папку данных и перезапуститься: в новой папке могли лежать свои файлы питомца,
/// они побеждают, а перечитать всё с нуля проще и надёжнее, чем подменять на ходу.
/// Синхронная, как и команды store.rs: идёт в главном потоке по очереди с save_state.
#[tauri::command]
fn move_data_dir(app: AppHandle, dir: String) -> Result<(), String> {
    store::set_data_dir(dir)?;
    // не restart(): тот из главного потока выходит сразу, не ответив окну. request_restart
    // выходит обычным путём, и single-instance успевает отпустить мьютекс до нового запуска
    app.request_restart();
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // кошка умеет уходить за край экрана — отсюда её зовут обратно
    let call = MenuItem::with_id(app, "call", "Позвать питомца", true, None::<&str>)?;
    // некормленый кот уходит навсегда — без этого пункта вернуть питомца было бы нечем
    let adopt = MenuItem::with_id(app, "adopt", "Новый котик", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&call, &adopt, &settings, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("DeskPartner")
        .menu(&menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            id @ ("call" | "adopt") => {
                if let Err(err) = app.emit_to("pet", id, ()) {
                    eprintln!("{id}: {err}");
                }
            }
            // обработчик меню идёт в главном потоке — окно строим из пула, как в open_settings
            "settings" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = show_settings(&app) {
                        eprintln!("settings: {err}");
                    }
                });
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
    let now = Now::local();
    let feel = Arc::new(Senses {
        tracker: Arc::new(Mutex::new(Tracker::new(Day::new(&now.date), &now))),
        app: Mutex::new(None),
    });
    tauri::Builder::default()
        // второй экземпляр просто закрывается: два одинаковых питомца — уже не питомец
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        // выбор папки данных в окне первого запуска
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Masks::default()))
        .manage(feel.clone())
        .invoke_handler(tauri::generate_handler![
            set_hit_mask,
            set_capture_hidden,
            finish_setup,
            open_settings,
            move_data_dir,
            menu::open_menu,
            menu::menu_size,
            menu::menu_pick,
            menu::close_menu,
            laser::set_laser,
            laser::push_pixels,
            laser::push_show,
            laser::push_done,
            senses,
            world::world,
            world::place_pet,
            store::data_dir,
            store::suggest_dirs,
            store::set_data_dir,
            store::load_state,
            store::save_state,
        ])
        .setup(move |app| {
            #[cfg(windows)]
            start_senses(feel);
            if store::set_up() {
                open_sprites(app.handle())?;
            } else {
                build_setup_window(app.handle())?;
            }
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить DeskPartner");
}
