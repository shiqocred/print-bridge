use axum::{body::Bytes, extract::State, routing::post, Router};
use escpos::driver::NativeUsbDriver; // Perbaikan path import
use escpos::utils::Protocol; // Tambahkan import Protocol
use serde::Serialize;
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt; // Untuk akses method .store()
use tauri_plugin_updater::UpdaterExt;
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

#[command]
async fn is_printer_ready(vid: String, pid: String) -> bool {
    let v = u16::from_str_radix(vid.trim_start_matches("0x"), 16).unwrap_or(0);
    let p = u16::from_str_radix(pid.trim_start_matches("0x"), 16).unwrap_or(0);

    // Cek fisik via nusb (paling cepat dan tidak mengunci driver)
    if let Ok(devices) = nusb::list_devices().await {
        if devices
            .into_iter()
            .any(|d| d.vendor_id() == v && d.product_id() == p)
        {
            return true;
        }
    }

    // Cadangan: Cek via open (untuk memastikan driver WinUSB aktif)
    NativeUsbDriver::open(v, p).is_ok()
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

// Tambahkan State untuk menyimpan bytes update sementara
struct UpdateBuffer(std::sync::Mutex<Option<Vec<u8>>>);

async fn check_update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        let mut downloaded = 0;

        app.emit("update-available", &update.version).unwrap();

        // Download bytes dan simpan ke dalam State Tauri
        let bytes = update
            .download(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    if let Some(total) = content_length {
                        let progress = (downloaded as f64 / total as f64) * 100.0;
                        let _ = app.emit("update-progress", progress);
                    }
                },
                || {
                    let _ = app.emit("update-finished", ());
                },
            )
            .await?;

        // Simpan bytes ke state agar bisa dipanggil nanti oleh command install_update
        let state = app.state::<UpdateBuffer>();
        let mut buffer = state.0.lock().unwrap();
        *buffer = Some(bytes);
    }
    Ok(())
}

#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateBuffer>,
) -> Result<(), String> {
    // Ambil bytes dari state
    let bytes = {
        let mut buffer = state.0.lock().unwrap();
        buffer.take() // Mengambil isi dan mengosongkan state
    };

    if let Some(b) = bytes {
        if let Some(update) = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
        {
            // SEKARANG BERHASIL: Masukkan bytes ke dalam .install()
            update.install(b).map_err(|e| e.to_string())?;
            app.restart();
        }
    } else {
        return Err("No update bytes found. Please download again.".into());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(UpdateBuffer(std::sync::Mutex::new(None))) // Daftarkan di sini
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            // Gunakan tauri::async_runtime agar tidak bentrok dengan main thread
            tauri::async_runtime::spawn(async move {
                let _ = check_update(handle.clone()).await;

                let state = Arc::new(AppState {
                    handle: handle.clone(),
                });

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
        .invoke_handler(tauri::generate_handler![
            list_usb_devices,
            print_test,
            is_printer_ready,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
