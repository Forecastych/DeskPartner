//! Папка данных, которую человек выбрал при первом запуске, и файлы состояния в ней.
//!
//! Где лежит папка, помнит только `%APPDATA%\DeskPartner\location.json` = `{"dir": "..."}` —
//! путь и больше ничего: всё остальное о питомце живёт там, куда указал человек.
//! Ядро — чистые функции с явными путями (их и тестируем), команды Tauri только подставляют
//! путь к location.json.
//!
//! Команды синхронные, то есть идут по одной в главном потоке: два `save_state` одного ключа
//! не столкнутся на общем `.tmp`. Файлы крошечные, интерфейс это не тормозит.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Ключи состояния фронтенда: их файлы переезжают при смене папки.
pub const KEYS: [&str; 7] = ["belly", "sleep", "stats", "spot", "settings", "bowl", "bed"];

/// Имя папки и в %APPDATA%, и в предложениях. Не identifier из tauri.conf.json:
/// app_config_dir() дал бы `%APPDATA%\io.github.deskpartner`, а человек ищет «DeskPartner».
const NAME: &str = "DeskPartner";

#[derive(Serialize, Deserialize)]
struct Location {
    dir: String,
}

/// `%APPDATA%\DeskPartner\location.json`; вне Windows — `~/.config/DeskPartner/location.json`.
fn location_file() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"));
    base.map(|b| b.join(NAME).join("location.json")).ok_or_else(|| "не найдена папка профиля".into())
}

/// Папка из location.json. Нет файла, он битый, путь относительный или папки уже нет —
/// значит, папки нет: фронтенд покажет первый запуск заново.
pub fn read_dir(location: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(location).ok()?;
    let loc: Location = serde_json::from_str(&text).ok()?;
    let dir = PathBuf::from(loc.dir);
    (dir.is_absolute() && dir.is_dir()).then_some(dir)
}

/// Запись через `.tmp` и переименование: оборвись она на середине — старый файл цел.
/// std::fs::rename на Windows заменяет существующий файл (MoveFileEx с REPLACE_EXISTING).
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let mut f = fs::File::create(&tmp)?;
    f.write_all(bytes)?;
    // без sync_all при отключении питания переименование может пережить данные
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, path)
}

/// Проверка записью, а не по атрибутам: права, OneDrive и антивирус узнаются только так.
fn probe(dir: &Path) -> Result<(), String> {
    const BODY: &[u8] = b"DeskPartner";
    let file = dir.join(".probe");
    let ok = fs::write(&file, BODY).is_ok() && fs::read(&file).is_ok_and(|b| b == BODY);
    let removed = fs::remove_file(&file).is_ok();
    if ok && removed {
        Ok(())
    } else {
        Err("в эту папку не получается писать".into())
    }
}

/// Одна и та же папка, даже если путь записан по-разному (регистр, `..`, слэши).
fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn state_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.json"))
}

/// Копирует файлы состояния из `from` в `to` и сверяет копии. Что в `to` уже есть, не трогаем:
/// там побеждает новая папка. Возвращает оригиналы, которые можно удалить.
/// При ошибке убирает уже сделанные копии, чтобы старая папка оставалась единственной правдой.
fn copy_states(from: &Path, to: &Path) -> Result<Vec<PathBuf>, String> {
    let mut copied: Vec<(PathBuf, PathBuf)> = Vec::new();
    for key in KEYS {
        let (src, dst) = (state_file(from, key), state_file(to, key));
        if dst.exists() || !src.is_file() {
            continue;
        }
        let done = fs::read(&src).and_then(|b| {
            write_atomic(&dst, &b)?;
            let same = fs::read(&dst)? == b;
            same.then_some(()).ok_or_else(|| io::Error::other("копия не совпала"))
        });
        if let Err(err) = done {
            let _ = fs::remove_file(&dst);
            for (_, d) in &copied {
                let _ = fs::remove_file(d);
            }
            return Err(format!("не получилось перенести {key}.json: {err}"));
        }
        copied.push((src, dst));
    }
    Ok(copied.into_iter().map(|(s, _)| s).collect())
}

/// Выбрать папку данных: создать, проверить записью, перевезти состояние из прежней и
/// запомнить путь. Оригиналы удаляются только после записи location.json — до этого момента
/// прежняя папка остаётся рабочей, и сбой на любом шаге ничего не теряет.
pub fn set_dir(location: &Path, dir: &str) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    if !dir.is_absolute() {
        return Err("нужен полный путь к папке".into());
    }
    fs::create_dir_all(&dir).map_err(|e| format!("не получается создать папку: {e}"))?;
    probe(&dir)?;
    let prev = read_dir(location).filter(|p| !same_dir(p, &dir));
    let moved = match &prev {
        Some(p) => copy_states(p, &dir)?,
        None => Vec::new(),
    };
    let parent = location.parent().ok_or("не найдена папка профиля")?;
    let json = serde_json::to_string(&Location { dir: dir.to_string_lossy().into_owned() }).map_err(|e| e.to_string())?;
    fs::create_dir_all(parent)
        .and_then(|_| write_atomic(location, json.as_bytes()))
        .map_err(|e| format!("не получается запомнить папку: {e}"))?;
    for src in moved {
        // не удалился — останется лишняя копия в старой папке, но данные уже в новой
        let _ = fs::remove_file(src);
    }
    Ok(())
}

/// Ключ становится именем файла, поэтому только строчная латиница: ни `..`, ни слэшей.
fn check_key(key: &str) -> Result<(), String> {
    let ok = (1..=16).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_lowercase());
    ok.then_some(()).ok_or_else(|| format!("недопустимый ключ: {key:?}"))
}

pub fn load(dir: Option<&Path>, key: &str) -> Result<Option<String>, String> {
    check_key(key)?;
    let Some(dir) = dir else { return Ok(None) };
    match fs::read_to_string(state_file(dir, key)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("не получается прочитать {key}.json: {e}")),
    }
}

pub fn save(dir: Option<&Path>, key: &str, value: &str) -> Result<(), String> {
    check_key(key)?;
    let dir = dir.ok_or("папка данных не выбрана")?;
    write_atomic(&state_file(dir, key), value.as_bytes()).map_err(|e| format!("не получается сохранить {key}.json: {e}"))
}

/// Сначала несистемные локальные диски (`X:\DeskPartner`), последним — папка пользователя.
/// Корня системного диска, Windows и Program Files тут не бывает по построению.
pub fn suggestions(fixed: &[char], system: char, home: Option<&Path>) -> Vec<String> {
    let drives = fixed
        .iter()
        .filter(|d| !d.eq_ignore_ascii_case(&system))
        .map(|d| format!("{}:\\{NAME}", d.to_ascii_uppercase()));
    drives.chain(home.map(|h| h.join(NAME).to_string_lossy().into_owned())).collect()
}

fn current() -> Option<PathBuf> {
    read_dir(&location_file().ok()?)
}

/// Выбрана ли папка — без неё finish_setup питомца не откроет.
pub fn has_dir() -> bool {
    current().is_some()
}

/// Первый запуск пройден до конца: папка выбрана и настройки в ней лежат. Папку запоминаем
/// уже на первом экране, поэтому одной её мало — закрыл мастер на темах, и при следующем
/// запуске его бы больше не спросили.
pub fn set_up() -> bool {
    location_file().is_ok_and(|l| finished(&l))
}

fn finished(location: &Path) -> bool {
    read_dir(location).is_some_and(|d| state_file(&d, "settings").is_file())
}

/// Текущая папка данных; `None` — первый запуск (или папку с тех пор удалили).
#[tauri::command]
pub fn data_dir() -> Option<String> {
    current().map(|d| d.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn suggest_dirs() -> Vec<String> {
    let home = std::env::var_os(sys::HOME).map(PathBuf::from);
    suggestions(&sys::fixed_drives(), sys::system_drive(), home.as_deref())
}

#[tauri::command]
pub fn set_data_dir(dir: String) -> Result<(), String> {
    set_dir(&location_file()?, &dir)
}

#[tauri::command]
pub fn load_state(key: String) -> Result<Option<String>, String> {
    load(current().as_deref(), &key)
}

#[tauri::command]
pub fn save_state(key: String, value: String) -> Result<(), String> {
    save(current().as_deref(), &key, &value)
}

#[cfg(windows)]
mod sys {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::WindowsProgramming::DRIVE_FIXED;

    pub const HOME: &str = "USERPROFILE";

    /// Буквы локальных несъёмных дисков: флешка или сетевой диск пропадут — пропадёт и питомец.
    pub fn fixed_drives() -> Vec<char> {
        // SAFETY: без аргументов, только читает маску букв
        let mask = unsafe { GetLogicalDrives() };
        (0..26u8)
            .filter(|i| mask >> i & 1 == 1)
            .map(|i| (b'A' + i) as char)
            .filter(|&d| {
                let root: Vec<u16> = format!("{d}:\\").encode_utf16().chain([0]).collect();
                // SAFETY: root — строка с нулём на конце, живёт до конца вызова
                unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_FIXED }
            })
            .collect()
    }

    /// Диск Windows: %SystemDrive%, иначе первая буква %SystemRoot%, иначе C.
    pub fn system_drive() -> char {
        ["SystemDrive", "SystemRoot"]
            .iter()
            .filter_map(|v| std::env::var(v).ok())
            .find_map(|s| s.chars().next().filter(char::is_ascii_alphabetic))
            .unwrap_or('C')
    }
}

/// Вне Windows дисков с буквами нет — остаётся только домашняя папка.
#[cfg(not(windows))]
mod sys {
    pub const HOME: &str = "HOME";

    pub fn fixed_drives() -> Vec<char> {
        Vec::new()
    }
    pub fn system_drive() -> char {
        '/'
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Своя пустая папка на тест; с кириллицей и пробелом — такие пути у людей и бывают.
    struct Tmp(PathBuf);

    impl Tmp {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let n = N.fetch_add(1, Ordering::Relaxed);
            let p = std::env::temp_dir().join(format!("deskpartner тест папка {}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }

    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn put(dir: &Path, key: &str, body: &str) {
        fs::write(state_file(dir, key), body).unwrap();
    }

    fn get(dir: &Path, key: &str) -> Option<String> {
        fs::read_to_string(state_file(dir, key)).ok()
    }

    #[test]
    fn first_launch_has_no_dir() {
        let t = Tmp::new();
        let loc = t.0.join("cfg").join("location.json");
        assert_eq!(read_dir(&loc), None);
        // битый файл и относительный путь — тоже первый запуск
        fs::create_dir_all(loc.parent().unwrap()).unwrap();
        fs::write(&loc, "{не json").unwrap();
        assert_eq!(read_dir(&loc), None);
        fs::write(&loc, r#"{"dir":"data"}"#).unwrap();
        assert_eq!(read_dir(&loc), None);
    }

    #[test]
    fn wizard_closed_after_folder_is_not_finished() {
        let t = Tmp::new();
        let loc = t.0.join("cfg").join("location.json");
        let data = t.0.join("данные");
        set_dir(&loc, data.to_str().unwrap()).unwrap();
        put(&data, "belly", "{}");
        assert!(!finished(&loc));
        put(&data, "settings", "{}");
        assert!(finished(&loc));
    }

    #[test]
    fn set_dir_with_cyrillic_and_spaces() {
        let t = Tmp::new();
        let loc = t.0.join("профиль").join("location.json");
        let dir = t.0.join("мои данные").join("Кот Барсик");
        set_dir(&loc, dir.to_str().unwrap()).unwrap();
        assert_eq!(read_dir(&loc), Some(dir.clone()));
        // в location.json только путь, и он читается обратно как есть
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&loc).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({ "dir": dir.to_str().unwrap() }));
        // проба за собой убрала, временных файлов не осталось
        assert!(!dir.join(".probe").exists());
        assert!(!loc.with_extension("json.tmp").exists());
        save(Some(&dir), "belly", r#"{"full":0.5}"#).unwrap();
        assert_eq!(load(Some(&dir), "belly").unwrap().as_deref(), Some(r#"{"full":0.5}"#));
    }

    #[test]
    fn set_dir_rejects_relative_path() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        assert!(set_dir(&loc, "DeskPartner").is_err());
        assert!(!loc.exists());
    }

    #[test]
    fn folder_vanished_means_first_launch() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let dir = t.0.join("данные");
        set_dir(&loc, dir.to_str().unwrap()).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(read_dir(&loc), None);
    }

    #[test]
    fn moving_carries_known_states_and_destination_wins() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let (old, new) = (t.0.join("старая папка"), t.0.join("новая папка"));
        set_dir(&loc, old.to_str().unwrap()).unwrap();
        put(&old, "belly", "old belly");
        put(&old, "sleep", "old sleep");
        put(&old, "notes", "чужой файл");
        fs::create_dir_all(&new).unwrap();
        put(&new, "sleep", "new sleep");
        set_dir(&loc, new.to_str().unwrap()).unwrap();
        assert_eq!(read_dir(&loc), Some(new.clone()));
        // перевезли и удалили оригинал
        assert_eq!(get(&new, "belly").as_deref(), Some("old belly"));
        assert_eq!(get(&old, "belly"), None);
        // в новой уже был — новый остаётся, старый не трогаем
        assert_eq!(get(&new, "sleep").as_deref(), Some("new sleep"));
        assert_eq!(get(&old, "sleep").as_deref(), Some("old sleep"));
        // незнакомые файлы не наши
        assert_eq!(get(&old, "notes").as_deref(), Some("чужой файл"));
        assert_eq!(get(&new, "notes"), None);
    }

    #[test]
    fn failed_move_keeps_old_dir_whole() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let (old, new) = (t.0.join("старая"), t.0.join("новая"));
        set_dir(&loc, old.to_str().unwrap()).unwrap();
        put(&old, "belly", "b");
        put(&old, "sleep", "s");
        // на месте временного файла для sleep — папка: belly скопируется, sleep — нет
        fs::create_dir_all(new.join("sleep.json.tmp")).unwrap();
        assert!(set_dir(&loc, new.to_str().unwrap()).is_err());
        // остались в старой папке со всем, что было; полкопии в новой не висит
        assert_eq!(read_dir(&loc), Some(old.clone()));
        assert_eq!((get(&old, "belly").as_deref(), get(&old, "sleep").as_deref()), (Some("b"), Some("s")));
        assert_eq!(get(&new, "belly"), None);
    }

    #[test]
    fn same_dir_again_keeps_files() {
        let t = Tmp::new();
        let loc = t.0.join("location.json");
        let dir = t.0.join("данные");
        set_dir(&loc, dir.to_str().unwrap()).unwrap();
        put(&dir, "stats", "s");
        // тот же путь другой записью — переезжать некуда, ничего не удаляется
        let again = format!("{}{}..{}данные", dir.display(), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR);
        set_dir(&loc, &again).unwrap();
        assert_eq!(get(&dir, "stats").as_deref(), Some("s"));
    }

    #[test]
    fn keys_are_checked() {
        let t = Tmp::new();
        for bad in ["", "Belly", "be-lly", "../x", "a/b", "белка", "abcdefghijklmnopq"] {
            assert!(load(Some(&t.0), bad).is_err(), "{bad:?}");
            assert!(save(Some(&t.0), bad, "x").is_err(), "{bad:?}");
        }
        assert!(load(Some(&t.0), "abcdefghijklmnop").is_ok());
        // ключ проверяется и без папки
        assert!(load(None, "../x").is_err());
    }

    #[test]
    fn load_and_save_without_dir() {
        assert_eq!(load(None, "belly"), Ok(None));
        assert_eq!(save(None, "belly", "x"), Err("папка данных не выбрана".into()));
    }

    #[test]
    fn save_replaces_atomically() {
        let t = Tmp::new();
        assert_eq!(load(Some(&t.0), "spot"), Ok(None));
        save(Some(&t.0), "spot", "один").unwrap();
        save(Some(&t.0), "spot", "два").unwrap();
        assert_eq!(load(Some(&t.0), "spot"), Ok(Some("два".into())));
        assert!(!t.0.join("spot.json.tmp").exists());
    }

    #[test]
    fn suggestions_skip_system_drive_and_end_with_home() {
        let home = Path::new(r"C:\Users\Влад");
        let got = suggestions(&['C', 'D', 'e'], 'c', Some(home));
        let want_home = home.join("DeskPartner").to_string_lossy().into_owned();
        assert_eq!(got, vec![r"D:\DeskPartner".to_string(), r"E:\DeskPartner".into(), want_home]);
        // только системный диск — остаётся папка пользователя
        assert_eq!(suggestions(&['C'], 'C', Some(home)).len(), 1);
        assert!(suggestions(&['C'], 'C', None).is_empty());
    }
}
