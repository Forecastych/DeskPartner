// В релизе не открываем консольное окно рядом с программой.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deskpartner_lib::run()
}
