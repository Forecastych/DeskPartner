//! Идёт ли у человека созвон. Кошка на созвоне прячется за край: у человека могут смотреть
//! экран, а питомец посреди демонстрации его «спалит».
//!
//! Признаки — те же, по которым Windows рисует значок микрофона в трее: CapabilityAccessManager
//! пишет в реестр, когда приложение взяло микрофон или камеру и когда отпустило. Занято сейчас —
//! начало есть, конца нет. Так видны Zoom, Teams, Discord, браузерный Meet — без списка программ.
//! Discord висит в фоне всегда, поэтому по процессам его не узнать — только по микрофону.
//! Демонстрация экрана Zoom с выключенным микрофоном видна отдельно: на время показа Zoom
//! запускает свой процесс CptHost.exe.
//!
//! Имена подключей в реестре — пути к exe. Это не заголовки окон, читать их можно, но они не
//! покидают этот модуль: ни на диск, ни в лог, ни на фронтенд — наружу идёт только да/нет.

// чистая часть нужна и тестам на любой системе, а зовут её только из Windows-части
#![cfg_attr(not(windows), allow(dead_code))]

use std::time::{SystemTime, UNIX_EPOCH};

/// FILETIME — сотни наносекунд с 1601 года, в таких реестр хранит LastUsedTime*.
const TICKS_PER_SEC: u64 = 10_000_000;
/// Секунд от 1601-01-01 до 1970-01-01.
const EPOCH_GAP_SECS: u64 = 11_644_473_600;
/// Приложение упало, не отпустив микрофон, — конец так и не запишется. Занятость старше этого
/// считаем такой сиротой: созвон на полсуток реже, чем кошка, навсегда спрятанная за край.
const STALE_SECS: u64 = 12 * 3600;

/// Держат микрофон всегда, пока запущены, хотя созвона нет: шумодав NVIDIA, виртуальный микшер,
/// OBS с источником микрофона. С ними кошка не вышла бы никогда. Стрим, где кошку видеть не
/// должны, закрывает галочка «Прятать от записи экрана». Сверяем со строчным именем подключа.
const ALWAYS_ON: [&str; 4] = ["nvidia broadcast", "voicemeeter", "obs64.exe", "obs32.exe"];

/// Процессы, которые живут ровно столько, сколько идёт показ экрана: CptHost — у Zoom.
const SHARE_EXES: [&str; 1] = ["cpthost.exe"];

/// Одна запись реестра: кто брал устройство и когда (FILETIME; None — значения нет).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub start: Option<u64>,
    pub stop: Option<u64>,
}

/// Сейчас в FILETIME — в той же шкале, что и записи реестра.
pub fn filetime(t: SystemTime) -> u64 {
    let since = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    (since.as_secs() + EPOCH_GAP_SECS) * TICKS_PER_SEC + u64::from(since.subsec_nanos()) / 100
}

/// Устройство занято прямо сейчас: начало записано, конца нет (Stop == 0) и начало не сирота.
/// Нет хотя бы одного значения — не знаем, значит не прячемся: лучше показаться на созвоне
/// по ошибке раз, чем не выходить вовсе.
pub fn in_use(start: Option<u64>, stop: Option<u64>, now: u64) -> bool {
    match (start, stop) {
        (Some(s), Some(0)) if s != 0 => now.saturating_sub(s) < STALE_SECS * TICKS_PER_SEC,
        _ => false,
    }
}

/// Программа из тех, что держат микрофон без всякого созвона.
pub fn always_on(name: &str) -> bool {
    let n = name.to_lowercase();
    ALWAYS_ON.iter().any(|a| n.contains(a))
}

/// Хоть кто-то, кроме вечных держателей, занял устройство сейчас.
pub fn busy(entries: &[Entry], now: u64) -> bool {
    entries.iter().any(|e| !always_on(&e.name) && in_use(e.start, e.stop, now))
}

/// Это процесс показа экрана (имя exe без пути, регистр любой).
pub fn sharing(exe: &str) -> bool {
    SHARE_EXES.iter().any(|s| exe.eq_ignore_ascii_case(s))
}

/// Созвон прямо сейчас: занят микрофон или камера, или Zoom показывает экран.
/// Дёргает реестр и снимок процессов — звать не чаще раза в пару секунд (lib.rs, senses-tick).
#[cfg(windows)]
pub fn now() -> bool {
    let at = filetime(SystemTime::now());
    // SAFETY: функции sys только читают реестр и снимок процессов и сами закрывают свои хэндлы.
    unsafe { busy(&sys::entries("microphone"), at) || busy(&sys::entries("webcam"), at) || sys::sharing_screen() }
}

#[cfg(windows)]
mod sys {
    use super::Entry;
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_QWORD,
    };

    const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";
    /// Обычные программы (не из Магазина) лежат не рядом с приложениями Магазина, а уровнем ниже.
    const NON_PACKAGED: &str = "NonPackaged";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Все записи устройства `kind` ("microphone", "webcam"): приложения Магазина и NonPackaged\*.
    /// Ключа нет (старая Windows, устройство ни разу не брали) — пусто.
    pub unsafe fn entries(kind: &str) -> Vec<Entry> {
        let mut out = Vec::new();
        let Some(root) = open(HKEY_CURRENT_USER, &format!(r"{CONSENT}\{kind}")) else { return out };
        for name in subkeys(root) {
            if name == NON_PACKAGED {
                if let Some(np) = open(root, NON_PACKAGED) {
                    out.extend(subkeys(np).into_iter().map(|n| entry(np, n)));
                    RegCloseKey(np);
                }
            } else {
                out.push(entry(root, name));
            }
        }
        RegCloseKey(root);
        out
    }

    unsafe fn open(parent: HKEY, path: &str) -> Option<HKEY> {
        let mut key: HKEY = std::ptr::null_mut();
        (RegOpenKeyExW(parent, wide(path).as_ptr(), 0, KEY_READ, &mut key) == ERROR_SUCCESS).then_some(key)
    }

    /// Имена подключей. Имя длиннее буфера (ключи реестра — до 255 знаков, так что не бывает)
    /// просто пропускаем, а не обрываем перечисление.
    unsafe fn subkeys(key: HKEY) -> Vec<String> {
        let mut names = Vec::new();
        let mut buf = [0u16; 512];
        for i in 0.. {
            let mut len = buf.len() as u32;
            let r = RegEnumKeyExW(
                key,
                i,
                buf.as_mut_ptr(),
                &mut len,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if r == ERROR_NO_MORE_ITEMS {
                break;
            }
            if r == ERROR_SUCCESS {
                names.push(String::from_utf16_lossy(&buf[..len as usize]));
            }
        }
        names
    }

    unsafe fn entry(parent: HKEY, name: String) -> Entry {
        let sub = wide(&name);
        Entry { start: qword(parent, &sub, "LastUsedTimeStart"), stop: qword(parent, &sub, "LastUsedTimeStop"), name }
    }

    /// QWORD-значение `value` подключа `sub`; другого типа или нет — None.
    unsafe fn qword(parent: HKEY, sub: &[u16], value: &str) -> Option<u64> {
        let mut v = 0u64;
        let mut size = std::mem::size_of::<u64>() as u32;
        let r = RegGetValueW(
            parent,
            sub.as_ptr(),
            wide(value).as_ptr(),
            RRF_RT_REG_QWORD,
            std::ptr::null_mut(),
            (&mut v as *mut u64).cast(),
            &mut size,
        );
        (r == ERROR_SUCCESS).then_some(v)
    }

    /// Запущен процесс показа экрана. Смотрим только имена exe из снимка, окна не трогаем.
    pub unsafe fn sharing_screen() -> bool {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut more = Process32FirstW(snap, &mut e) != 0;
        while more && !found {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            found = super::sharing(&String::from_utf16_lossy(&e.szExeFile[..len]));
            more = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const NOW: u64 = 134_000_000_000_000_000;
    const MIN: u64 = 60 * TICKS_PER_SEC;

    fn e(name: &str, start: Option<u64>, stop: Option<u64>) -> Entry {
        Entry { name: name.into(), start, stop }
    }

    #[test]
    fn filetime_counts_from_1601() {
        assert_eq!(filetime(UNIX_EPOCH), EPOCH_GAP_SECS * TICKS_PER_SEC);
        // 2024-01-01T00:00:00Z: (1 704 067 200 + 11 644 473 600) с × 10⁷
        let t = UNIX_EPOCH + Duration::from_secs(1_704_067_200);
        assert_eq!(filetime(t), 133_485_408_000_000_000);
        assert_eq!(filetime(t + Duration::from_nanos(250)), 133_485_408_000_000_002);
    }

    #[test]
    fn in_use_needs_start_without_stop() {
        assert!(in_use(Some(NOW - MIN), Some(0), NOW));
        // отпустил — конец записан
        assert!(!in_use(Some(NOW - 2 * MIN), Some(NOW - MIN), NOW));
        // ни разу не брал
        assert!(!in_use(Some(0), Some(0), NOW));
        // чего-то нет — не знаем, не прячемся
        assert!(!in_use(Some(NOW - MIN), None, NOW));
        assert!(!in_use(None, Some(0), NOW));
        assert!(!in_use(None, None, NOW));
    }

    #[test]
    fn in_use_ignores_orphans() {
        let long = STALE_SECS * TICKS_PER_SEC;
        assert!(in_use(Some(NOW - long + MIN), Some(0), NOW));
        assert!(!in_use(Some(NOW - long), Some(0), NOW));
        // часы ушли назад — начало «в будущем», это свежий созвон, а не сирота
        assert!(in_use(Some(NOW + MIN), Some(0), NOW));
    }

    #[test]
    fn always_on_by_exe_in_key_name() {
        assert!(always_on(r"C:#Program Files#NVIDIA Corporation#NVIDIA Broadcast#NVIDIA Broadcast UI.exe"));
        assert!(always_on(r"C:#Program Files#obs-studio#bin#64bit#obs64.exe"));
        assert!(always_on(r"C:#Program Files (x86)#VB#Voicemeeter#voicemeeter8x64.exe"));
        assert!(!always_on(r"C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe"));
        assert!(!always_on(r"C:#Users#me#AppData#Local#Discord#app-1.0.9#Discord.exe"));
        assert!(!always_on("MSTeams_8wekyb3d8bbwe"));
    }

    #[test]
    fn busy_when_anyone_holds_device() {
        let idle = e("C:#Zoom.exe", Some(NOW - 9 * MIN), Some(NOW - 8 * MIN));
        let talking = e("C:#Discord.exe", Some(NOW - MIN), Some(0));
        let shumodav = e("C:#NVIDIA Broadcast#NVIDIA Broadcast UI.exe", Some(NOW - MIN), Some(0));
        assert!(!busy(&[], NOW));
        assert!(!busy(&[idle.clone()], NOW));
        assert!(busy(&[idle.clone(), talking.clone()], NOW));
        // шумодав держит микрофон весь день — это не созвон
        assert!(!busy(&[idle, shumodav.clone()], NOW));
        assert!(busy(&[shumodav, talking], NOW));
    }

    /// Живая проверка на своей машине: `cargo test print_real_call -- --ignored --nocapture`.
    /// Печатает только числа и да/нет — имена программ не выводим и здесь.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn print_real_call() {
        let at = filetime(SystemTime::now());
        for kind in ["microphone", "webcam"] {
            let all = unsafe { sys::entries(kind) };
            let held = all.iter().filter(|e| in_use(e.start, e.stop, at)).count();
            println!("{kind}: записей {}, занято {held}, созвон {}", all.len(), busy(&all, at));
        }
        println!("показ экрана Zoom: {}", unsafe { sys::sharing_screen() });
        println!("итог: {}", now());
    }

    #[test]
    fn sharing_is_zoom_share_host() {
        assert!(sharing("CptHost.exe"));
        assert!(sharing("cpthost.exe"));
        assert!(!sharing("Zoom.exe"));
        assert!(!sharing("Discord.exe"));
        assert!(!sharing("CptHost.exe.bak"));
    }
}
