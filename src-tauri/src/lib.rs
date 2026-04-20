use escpos::driver::NativeUsbDriver;
use escpos::printer::Printer;
use escpos::utils::*;
use serde::Serialize;
use tauri::command;

#[derive(Serialize, Clone)]
struct UsbDevice {
    name: String,
    vid: String,
    pid: String,
}

#[tauri::command]
async fn list_usb_devices() -> Result<Vec<UsbDevice>, String> {
    let devices = nusb::list_devices().await.map_err(|e| e.to_string())?;

    let mut list = Vec::new();

    for dev in devices {
        // --- LOGIKA FILTERING ---
        // Kita hanya ambil jika:
        // 1. Namanya mengandung kata 'printer' atau 'CLA58'
        // 2. ATAU Interface Class-nya adalah 7 (Standar USB Printer)

        let name = dev.product_string().unwrap_or("Unknown Device");
        let is_printer_name = name.to_lowercase().contains("printer") || name.contains("CLA58");

        // Catatan: Beberapa printer murah Cina tidak melaporkan Class ID dengan benar,
        // Jadi kita filter berdasarkan nama atau VID/PID yang spesifik.
        if is_printer_name || dev.vendor_id() == 0x6868 {
            list.push(UsbDevice {
                name: name.to_string(),
                vid: format!("0x{:04x}", dev.vendor_id()),
                pid: format!("0x{:04x}", dev.product_id()),
            });
        }
    }

    Ok(list)
}

#[command]
async fn print_test(vid: String, pid: String) -> Result<String, String> {
    // 1. Konversi String "0x6868" -> integer 0x6868
    let v = u16::from_str_radix(vid.trim_start_matches("0x"), 16)
        .map_err(|_| "Format Vendor ID (VID) tidak valid")?;
    let p = u16::from_str_radix(pid.trim_start_matches("0x"), 16)
        .map_err(|_| "Format Product ID (PID) tidak valid")?;

    // 2. Buka koneksi USB
    let driver = NativeUsbDriver::open(v, p)
        .map_err(|e| format!("Printer tidak ditemukan atau sibuk: {}", e))?;

    // 3. Inisialisasi Printer
    let mut printer = Printer::new(driver, Protocol::default(), None);

    // 4. Proses Cetak
    printer
        .init()
        .map_err(|e| e.to_string())?
        .justify(JustifyMode::CENTER)
        .map_err(|e| e.to_string())?
        .bold(true)
        .map_err(|e| e.to_string())?
        .writeln("TEST PRINT SUKSES")
        .map_err(|e| e.to_string())?
        .bold(false)
        .map_err(|e| e.to_string())?
        .writeln("--------------------------------")
        .map_err(|e| e.to_string())?
        .writeln("Aplikasi Bridge Berhasil")
        .map_err(|e| e.to_string())?
        .writeln("Terkoneksi dengan Printer")
        .map_err(|e| e.to_string())?
        .writeln("--------------------------------")
        .map_err(|e| e.to_string())?
        .feed()
        .map_err(|e| e.to_string())?
        .print_cut()
        .map_err(|e| e.to_string())?;

    Ok("Cetak berhasil! Periksa printer Anda.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![list_usb_devices, print_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
