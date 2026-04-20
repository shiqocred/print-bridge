use axum::{body::Bytes, extract::State, routing::post, Router};
use escpos::driver::NativeUsbDriver; // Perbaikan path import
use escpos::utils::Protocol; // Tambahkan import Protocol
use serde::Serialize;
use std::sync::Arc;
use tauri::{command, AppHandle};
use tauri_plugin_store::StoreExt; // Untuk akses method .store()
use tower_http::cors::CorsLayer;

#[derive(Serialize, Clone)]
struct UsbDevice {
    name: String,
    vid: String,
    pid: String,
}

struct AppState {
    handle: AppHandle,
}

// --- HTTP ROUTE HANDLER ---
async fn handle_print_raw(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<String, String> {
    // 1. Ambil data dari Store (Cara terbaru di Store v2)
    // Kita langsung buka storenya dan ambil nilainya
    let store = state
        .handle
        .store("settings.json")
        .map_err(|e| e.to_string())?;

    let (vid_str, pid_str) = {
        let val = store.get("printer_aktif");
        let vid = val
            .as_ref()
            .and_then(|v| v.get("vid"))
            .and_then(|v| v.as_str())
            .unwrap_or("0x6868")
            .to_string();
        let pid = val
            .as_ref()
            .and_then(|v| v.get("pid"))
            .and_then(|v| v.as_str())
            .unwrap_or("0x0200")
            .to_string();
        (vid, pid)
    };

    // 2. Parse Hex
    let v = u16::from_str_radix(vid_str.trim_start_matches("0x"), 16).map_err(|_| "VID Invalid")?;
    let p = u16::from_str_radix(pid_str.trim_start_matches("0x"), 16).map_err(|_| "PID Invalid")?;

    // 3. Kirim Bytes ke USB
    let driver = NativeUsbDriver::open(v, p).map_err(|e| format!("Printer error: {}", e))?;
    let mut printer = escpos::printer::Printer::new(driver, Protocol::default(), None);
    let raw_string = body.iter().map(|&b| b as char).collect::<String>();

    printer
        .write(&raw_string)
        .map_err(|e| e.to_string())?
        .print()
        .map_err(|e| e.to_string())?;

    Ok("Cetak Berhasil".to_string())
}

#[command]
async fn list_usb_devices() -> Result<Vec<UsbDevice>, String> {
    let devices = nusb::list_devices().await.map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for dev in devices {
        let name = dev.product_string().unwrap_or("Unknown Device");
        if name.to_lowercase().contains("printer")
            || name.contains("CLA58")
            || dev.vendor_id() == 0x6868
        {
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
    let v = u16::from_str_radix(vid.trim_start_matches("0x"), 16).map_err(|_| "VID Invalid")?;
    let p = u16::from_str_radix(pid.trim_start_matches("0x"), 16).map_err(|_| "PID Invalid")?;

    let driver = NativeUsbDriver::open(v, p).map_err(|e| e.to_string())?;
    let mut printer = escpos::printer::Printer::new(driver, Protocol::default(), None);

    printer
        .init()
        .map_err(|e| e.to_string())?
        .writeln("TEST PRINT OK")
        .map_err(|e| e.to_string())?
        .feed()
        .map_err(|e| e.to_string())?
        .print_cut()
        .map_err(|e| e.to_string())?;

    Ok("Berhasil".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            // Gunakan tauri::async_runtime agar tidak bentrok dengan main thread
            tauri::async_runtime::spawn(async move {
                let state = Arc::new(AppState { handle });

                let app_router = Router::new()
                    .route("/print-raw", post(handle_print_raw))
                    .layer(CorsLayer::permissive())
                    .with_state(state);

                let addr = "127.0.0.1:3001";
                // Pastikan listener juga menggunakan runtime yang benar
                if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
                    let _ = axum::serve(listener, app_router).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_usb_devices, print_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
