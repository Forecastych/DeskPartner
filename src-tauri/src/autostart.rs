//! Автозапуск установленного приложения при входе текущего пользователя.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const NAME: &str = "DeskPartner";

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain([0]).collect()
}

fn error(code: u32) -> String {
    std::io::Error::from_raw_os_error(code as i32).to_string()
}

#[tauri::command]
pub fn is_autostart() -> Result<bool, String> {
    let key = wide(OsStr::new(RUN));
    let name = wide(OsStr::new(NAME));
    let mut size = 0;
    // SAFETY: передаём завершённые нулём строки и только запрашиваем размер значения.
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, null_mut(), null_mut(), &mut size)
    };
    match status {
        ERROR_SUCCESS => Ok(true),
        ERROR_FILE_NOT_FOUND => Ok(false),
        other => Err(error(other)),
    }
}

#[tauri::command]
pub fn set_autostart(on: bool) -> Result<(), String> {
    let key = wide(OsStr::new(RUN));
    let name = wide(OsStr::new(NAME));
    let status = if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut command = std::ffi::OsString::from("\"");
        command.push(exe);
        command.push("\"");
        let value = wide(&command);
        // SAFETY: буфер жив до возврата, размер включает завершающий ноль.
        unsafe {
            RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32)
        }
    } else {
        // SAFETY: удаляем только собственное значение, строки завершены нулём.
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) }
    };
    match status {
        ERROR_SUCCESS => Ok(()),
        ERROR_FILE_NOT_FOUND if !on => Ok(()),
        other => Err(error(other)),
    }
}
