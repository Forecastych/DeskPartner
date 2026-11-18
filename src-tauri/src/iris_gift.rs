//! Приглашение из буклета. Хранится в профиле Windows и переживает мастер установки
//! и перенос папки питомца. Подарок считается открытым только после клика по коробке.

use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path, sync::Mutex};
use tauri::{App, AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

const URL: &str = "deskpartner://gift/iris";
const FILE: &str = "iris-gift.json";
const INSTALLER_INVITE: &str = "iris-gift-invite";
const PORTRAIT_FILE: &str = "iris-portrait.jpg";
const HIDDEN_FILE: &str = "iris-frame-hidden";
const PORTRAIT: &str = "iris-portrait";
const STUDIO: &str = concat!(
    "https://irismacrostudio.ru/samara",
    "?utm_source=deskpartner&utm_medium=referral&utm_campaign=iris_samara&utm_content=portrait",
);
pub const FRAME: &str = "iris-frame";
const FRAME_SIZE: f64 = 120.0;
const MAX_PHOTO: u64 = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Gift {
    Pending,
    Opened,
}

#[derive(Default)]
pub struct Access(Mutex<()>);

impl Access {
    fn with_file<T>(&self, f: impl FnOnce(&Path) -> io::Result<T>) -> Result<T, String> {
        let _lock = self.0.lock().map_err(|err| err.to_string())?;
        f(&crate::store::profile_file(FILE)?).map_err(|err| err.to_string())
    }
}

fn read(path: &Path) -> io::Result<Option<Gift>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(io::Error::other),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

fn write(path: &Path, gift: Gift) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    crate::store::write_atomic(path, &serde_json::to_vec(&gift)?)
}

fn offer(path: &Path, url: &str) -> io::Result<bool> {
    if url != URL {
        return Ok(false);
    }
    match read(path)? {
        None => {
            write(path, Gift::Pending)?;
            Ok(true)
        }
        Some(Gift::Pending) => Ok(true),
        Some(Gift::Opened) => Ok(false),
    }
}

fn consume(path: &Path) -> io::Result<bool> {
    if read(path)? != Some(Gift::Pending) {
        return Ok(false);
    }
    write(path, Gift::Opened)?;
    Ok(true)
}

pub fn connect(app: &App) {
    receive_installer(app.handle());
    // Сначала слушаем следующие экземпляры, затем проверяем URL стартового вызова.
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            receive(&handle, url.as_str());
        }
    });
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                receive(app.handle(), url.as_str());
            }
        }
        Ok(None) => {}
        Err(err) => eprintln!("iris gift URL: {err}"),
    }
}

pub fn receive_installer(app: &AppHandle) {
    let result = (|| -> Result<bool, String> {
        let marker = crate::store::profile_file(INSTALLER_INVITE)?;
        app.state::<Access>().with_file(|path| {
            if !marker.try_exists()? {
                return Ok(false);
            }
            let pending = offer(path, URL)?;
            fs::remove_file(marker)?;
            Ok(pending)
        })
    })();
    notify(app, result);
}

fn receive(app: &AppHandle, url: &str) {
    if url != URL {
        return;
    }
    notify(app, app.state::<Access>().with_file(|path| offer(path, url)));
}

fn notify(app: &AppHandle, result: Result<bool, String>) {
    match result {
        Ok(true) => {
            if let Err(err) = app.emit_to("pet", "iris-gift-ready", ()) {
                eprintln!("iris gift notification: {err}");
            }
        }
        Ok(false) => {}
        Err(err) => eprintln!("iris gift: {err}"),
    }
}

#[tauri::command]
pub fn iris_gift_status(access: State<'_, Access>) -> Result<Option<Gift>, String> {
    access.with_file(read)
}

#[tauri::command]
pub fn open_iris_gift(access: State<'_, Access>) -> Result<bool, String> {
    access.with_file(consume)
}

fn require_gift(path: &Path) -> io::Result<()> {
    if read(path)? == Some(Gift::Opened) {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "IRIS gift has not been opened"))
    }
}

#[tauri::command]
pub async fn iris_portrait(
    window: WebviewWindow,
    access: State<'_, Access>,
) -> Result<tauri::ipc::Response, String> {
    if !matches!(window.label(), PORTRAIT | FRAME) {
        return Err("Portrait window required".into());
    }
    let file = crate::store::profile_file(PORTRAIT_FILE)?;
    access.with_file(|path| {
        require_gift(path)?;
        match fs::metadata(&file) {
            Ok(meta) if meta.len() <= MAX_PHOTO => fs::read(file).map(tauri::ipc::Response::new),
            Ok(_) => Err(io::Error::new(io::ErrorKind::InvalidData, "Portrait is too large")),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(tauri::ipc::Response::new(Vec::new())),
            Err(err) => Err(err),
        }
    })
}

#[tauri::command]
pub async fn save_iris_portrait(
    window: WebviewWindow,
    access: State<'_, Access>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    if window.label() != PORTRAIT {
        return Err("Portrait window required".into());
    }
    let tauri::ipc::InvokeBody::Raw(photo) = request.body() else {
        return Err("JPEG body required".into());
    };
    if photo.len() as u64 > MAX_PHOTO || !photo.starts_with(&[0xff, 0xd8, 0xff]) || !photo.ends_with(&[0xff, 0xd9]) {
        return Err("Invalid JPEG".into());
    }
    let file = crate::store::profile_file(PORTRAIT_FILE)?;
    access.with_file(|path| {
        require_gift(path)?;
        crate::store::write_atomic(&file, photo)
    })
}

#[tauri::command]
pub async fn remove_iris_portrait(window: WebviewWindow, access: State<'_, Access>) -> Result<(), String> {
    if window.label() != PORTRAIT {
        return Err("Portrait window required".into());
    }
    let file = crate::store::profile_file(PORTRAIT_FILE)?;
    access.with_file(|path| {
        require_gift(path)?;
        match fs::remove_file(file) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
            _ => Ok(()),
        }
    })?;
    if let Some(frame) = window.get_webview_window(FRAME) {
        frame.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn iris_frame_enabled(access: State<'_, Access>) -> Result<bool, String> {
    let hidden = crate::store::profile_file(HIDDEN_FILE)?;
    access.with_file(|path| {
        require_gift(path)?;
        Ok(!hidden.try_exists()?)
    })
}

#[tauri::command]
pub async fn set_iris_frame_enabled(
    window: WebviewWindow,
    access: State<'_, Access>,
    enabled: bool,
) -> Result<(), String> {
    if window.label() != PORTRAIT {
        return Err("Portrait window required".into());
    }
    let hidden = crate::store::profile_file(HIDDEN_FILE)?;
    access.with_file(|path| {
        require_gift(path)?;
        if !enabled {
            return crate::store::write_atomic(&hidden, b"");
        }
        match fs::remove_file(hidden) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
            _ => Ok(()),
        }
    })?;
    if enabled {
        window.emit_to("pet", "iris-frame-enabled", ()).map_err(|err| err.to_string())?;
    } else if let Some(frame) = window.get_webview_window(FRAME) {
        frame.destroy().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn show_iris_portrait(app: AppHandle, access: State<'_, Access>) -> Result<(), String> {
    access.with_file(require_gift)?;
    if let Some(window) = app.get_webview_window(PORTRAIT) {
        return window.set_focus().map_err(|err| err.to_string());
    }
    WebviewWindowBuilder::new(&app, PORTRAIT, WebviewUrl::App("index.html".into()))
        .title(crate::i18n::tr("Портрет от IRIS", "Portrait from IRIS"))
        .inner_size(570.0, 600.0)
        .min_inner_size(320.0, 350.0)
        .center()
        .decorations(false)
        .content_protected(true)
        .build()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn open_iris_studio(window: WebviewWindow) -> Result<(), String> {
    if window.label() != PORTRAIT {
        return Err("Portrait window required".into());
    }
    #[cfg(windows)]
    if crate::win::open_url(STUDIO) {
        return Ok(());
    }
    Err("Could not open the studio website".into())
}

#[tauri::command]
pub async fn show_iris_frame(
    app: AppHandle,
    access: State<'_, Access>,
    hidden: bool,
) -> Result<Option<i32>, String> {
    let file = crate::store::profile_file(PORTRAIT_FILE)?;
    let hidden_file = crate::store::profile_file(HIDDEN_FILE)?;
    if !access.with_file(|path| {
        require_gift(path)?;
        Ok(file.try_exists()? && !hidden_file.try_exists()?)
    })? {
        return Ok(None);
    }
    if let Some(frame) = app.get_webview_window(FRAME) {
        frame.emit("iris-photo-changed", ()).map_err(|err| err.to_string())?;
        return frame.outer_position().map(|pos| Some(pos.x)).map_err(|err| err.to_string());
    }
    let monitor = app.get_webview_window("pet").and_then(|pet| pet.current_monitor().ok().flatten());
    #[cfg(windows)]
    let visible = !crate::game_hidden() && !crate::win::bossed();
    #[cfg(not(windows))]
    let visible = true;
    let frame = WebviewWindowBuilder::new(&app, FRAME, WebviewUrl::App("index.html".into()))
        .title(crate::i18n::tr("Рамка IRIS", "IRIS picture frame"))
        .inner_size(FRAME_SIZE, FRAME_SIZE)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .content_protected(hidden)
        .visible(false)
        .build()
        .map_err(|err| err.to_string())?;
    if let Some(monitor) = monitor {
        let work = monitor.work_area();
        let side = (FRAME_SIZE * monitor.scale_factor()).round() as i32;
        let gap = (20.0 * monitor.scale_factor()).round() as i32;
        frame.set_position(PhysicalPosition::new(
            work.position.x + (work.size.width as i32 - side - gap).max(0),
            work.position.y + (work.size.height as i32 - side - gap).max(0),
        )).map_err(|err| err.to_string())?;
    }
    if visible {
        // The toggle might have changed while the new window was being built.
        if hidden_file.try_exists().map_err(|err| err.to_string())? || !file.try_exists().map_err(|err| err.to_string())? {
            frame.destroy().map_err(|err| err.to_string())?;
            return Ok(None);
        }
        frame.show().map_err(|err| err.to_string())?;
    }
    frame.outer_position().map(|pos| Some(pos.x)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn iris_has_photo(access: State<'_, Access>) -> Result<bool, String> {
    let file = crate::store::profile_file(PORTRAIT_FILE)?;
    access.with_file(|path| {
        require_gift(path)?;
        file.try_exists()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_gift_link_can_offer_the_box_and_it_can_be_opened_once() {
        let path = std::env::temp_dir().join(format!("deskpartner-iris-gift-{}.json", std::process::id()));
        assert_eq!(read(&path).unwrap(), None);
        for url in ["https://example.org/gift/iris", "deskpartner://gift/iris?preview=1", "deskpartner://gift/other"] {
            assert!(!offer(&path, url).unwrap());
        }
        assert!(!consume(&path).unwrap());
        assert!(offer(&path, URL).unwrap());
        assert_eq!(read(&path).unwrap(), Some(Gift::Pending));
        assert!(offer(&path, URL).unwrap());
        assert!(consume(&path).unwrap());
        assert_eq!(read(&path).unwrap(), Some(Gift::Opened));
        assert!(!offer(&path, URL).unwrap());
        assert!(!consume(&path).unwrap());
        fs::remove_file(&path).unwrap();
    }
}
