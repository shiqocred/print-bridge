// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Memanggil fungsi run yang ada di lib.rs
    pos_bridge_lib::run();
}
