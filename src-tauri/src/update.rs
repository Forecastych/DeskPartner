//! Обновления: раз в несколько часов спрашиваем GitHub Releases, нет ли версии новее
//! (tauri-plugin-updater читает latest.json, выложенный рядом с установщиком). Нашлась — пункт
//! в трее и в меню кошки, ставит только человек, по клику. Галочка в настройках выключает.
//!
//! Наружу уходит один GET на github.com: как при скачивании любого файла, GitHub видит адрес и
//! версию программы в User-Agent. Подпись установщика сверяется с публичным ключом из
//! tauri.conf.json, чужой файл плагин не поставит.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Первая проверка — не на старте: программе и сети сначала есть чем заняться.
const FIRST: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const TICK: Duration = Duration::from_secs(60);

/// Галочка «проверять обновления»; до первого слова окна кошки — молчим.
static ON: AtomicBool = AtomicBool::new(false);
/// Найденное обновление: его и ставим, второй раз не спрашивая.
static FOUND: Mutex<Option<Update>> = Mutex::new(None);

fn found() -> std::sync::MutexGuard<'static, Option<Update>> {
    FOUND.lock().unwrap_or_else(|e| e.into_inner())
}

/// Версия, до которой можно обновиться, если такая нашлась.
pub fn version() -> Option<String> {
    found().as_ref().map(|u| u.version.clone())
}

/// Фоновый поток: раз в [`EVERY`] спрашивает, пока галочка стоит и ничего не найдено.
pub fn start(app: AppHandle) {
    let _ = std::thread::Builder::new().name("update".into()).spawn(move || {
        std::thread::sleep(FIRST);
        let mut last: Option<Instant> = None;
        loop {
            if ON.load(Ordering::Relaxed) && found().is_none() && last.map_or(true, |t| t.elapsed() >= EVERY) {
                last = Some(Instant::now());
                check(&app);
            }
            std::thread::sleep(TICK);
        }
    });
}

fn check(app: &AppHandle) {
    let res = tauri::async_runtime::block_on(async { app.updater()?.check().await });
    match res {
        Ok(Some(u)) => {
            let v = u.version.clone();
            *found() = Some(u);
            if let Err(err) = app.emit_to("pet", "update", v) {
                eprintln!("update: {err}");
            }
        }
        Ok(None) => {}
        // нет сети или релиза с latest.json — просто попробуем в следующий раз
        Err(err) => eprintln!("update check: {err}"),
    }
}

/// Окно кошки сообщило галочку из настроек. Ответ — уже найденная версия: окно могло
/// пропустить событие "update", пока грузилось.
#[tauri::command]
pub fn set_updates(on: bool) -> Option<String> {
    ON.store(on, Ordering::Relaxed);
    version()
}

/// Скачать и поставить. Окно кошки зовёт это, уже дописав всё на диск: на Windows плагин
/// запускает установщик и сразу завершает процесс, установщик потом открывает программу снова.
#[tauri::command]
pub async fn install_update() -> Result<(), String> {
    let Some(u) = found().clone() else {
        return Err("no update found".into());
    };
    u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())
}
