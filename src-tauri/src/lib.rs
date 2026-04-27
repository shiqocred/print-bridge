use axum::{
    body::Bytes, extract::State, http::StatusCode, response::IntoResponse, routing::post, Json,
    Router,
};
use escpos::driver::NativeUsbDriver;
use escpos::utils::Protocol;
use serde::Serialize;
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::UpdaterExt;
use tower_http::cors::CorsLayer;

use serde_json::json;

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

    if let Ok(devices) = nusb::list_devices().await {
        if devices
            .into_iter()
            .any(|d| d.vendor_id() == v && d.product_id() == p)
        {
            return true;
        }
    }
    NativeUsbDriver::open(v, p).is_ok()
}

// --- GET /printer-ready: cek printer aktif dari settings.json ---
use axum::extract::State as AxumState;
async fn handle_printer_ready_get(AxumState(state): AxumState<Arc<AppState>>) -> impl IntoResponse {
    let store = match state.handle.store("settings.json") {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"status": false, "message": format!("Store error: {}", e)})),
            );
        }
    };
    let val = store.get("printer_aktif");
    let vid = val
        .as_ref()
        .and_then(|v| v.get("vid"))
        .and_then(|v| v.as_str());
    let pid = val
        .as_ref()
        .and_then(|v| v.get("pid"))
        .and_then(|v| v.as_str());
    if let (Some(vid), Some(pid)) = (vid, pid) {
        let v = u16::from_str_radix(vid.trim_start_matches("0x"), 16).unwrap_or(0);
        let p = u16::from_str_radix(pid.trim_start_matches("0x"), 16).unwrap_or(0);
        if let Ok(devices) = nusb::list_devices().await {
            if devices
                .into_iter()
                .any(|d| d.vendor_id() == v && d.product_id() == p)
            {
                return (
                    StatusCode::OK,
                    Json(
                        json!({"status": true, "message": "Printer terdeteksi dan siap digunakan"}),
                    ),
                );
            }
        }
        return (
            StatusCode::OK,
            Json(json!({"status": false, "message": "Printer tidak ditemukan atau tidak siap"})),
        );
    } else {
        return (
            StatusCode::PRECONDITION_FAILED,
            Json(json!({"status": false, "message": "Belum ada printer aktif di settings"})),
        );
    }
}

async fn handle_print_raw(State(state): State<Arc<AppState>>, body: Bytes) -> impl IntoResponse {
    let store = match state.handle.store("settings.json") {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"status": false, "message": format!("Store error: {}", e)})),
            )
        }
    };

    // 2. Ambil VID/PID
    // 2. Ambil VID/PID (Tanpa default printer yang valid)
    let (vid_str, pid_str) = {
        let val = store.get("printer_aktif");

        // Jika "printer_aktif" tidak ada di settings.json, langsung return error
        if val.is_none() {
            return (
                StatusCode::PRECONDITION_FAILED, // 412: Belum setting
                Json(
                    json!({"status": false, "message": "Silahkan pilih dan tambahkan printer di pengaturan terlebih dahulu"}),
                ),
            );
        }

        let vid = val
            .as_ref()
            .and_then(|v| v.get("vid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let pid = val
            .as_ref()
            .and_then(|v| v.get("pid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Pastikan keduanya ada nilainya
        match (vid, pid) {
            (Some(v), Some(p)) => (v, p),
            _ => {
                return (
                    StatusCode::PRECONDITION_FAILED,
                    Json(json!({"status": false, "message": "Konfigurasi printer tidak lengkap"})),
                )
            }
        }
    };

    let v = match u16::from_str_radix(vid_str.trim_start_matches("0x"), 16) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"status": false, "message": "VID Invalid"})),
            )
        }
    };

    let p = match u16::from_str_radix(pid_str.trim_start_matches("0x"), 16) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"status": false, "message": "PID Invalid"})),
            )
        }
    };

    let mut devices = match nusb::list_devices().await {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"status": false, "message": format!("Gagal scan USB: {}", e)})),
            )
        }
    };

    // 2. Langsung gunakan iterator (tanpa .iter())
    let is_connected = devices.any(|d| d.vendor_id() == v && d.product_id() == p);

    if !is_connected {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"status": false, "message": "Printer tidak terhubung secara fisik"})),
        );
    }

    // 3. Open Driver & Print
    let driver = match NativeUsbDriver::open(v, p) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(
                    json!({"status": false, "message": format!("Printer tidak terdeteksi: {}", e)}),
                ),
            )
        }
    };

    let mut printer = escpos::printer::Printer::new(driver, Protocol::default(), None);

    // Konversi body ke string (sesuai logika awalmu)
    let raw_string = body.iter().map(|&b| b as char).collect::<String>();

    match printer.write(&raw_string) {
        Ok(p_write) => {
            if let Err(e) = p_write.print() {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"status": false, "message": format!("Gagal mencetak: {}", e)})),
                );
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    json!({"status": false, "message": format!("Gagal menulis ke printer: {}", e)}),
                ),
            )
        }
    }

    // 4. Sukses
    (
        StatusCode::OK,
        Json(json!({"status": true, "message": "Cetak Berhasil"})),
    )
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

// --- LOGIKA UPDATER BARU ---

async fn check_update_silent(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    println!("[Updater] Memulai pengecekan update secara silent...");

    // 1. Inisialisasi updater
    let updater = app.updater()?;

    // 2. Baca konfigurasi (untuk log saja)
    println!("[Updater] Mengecek ke endpoint yang terdaftar di tauri.conf.json...");

    // 3. Lakukan pengecekan ke server
    match updater.check().await {
        Ok(update_result) => {
            if let Some(update) = update_result {
                println!("[Updater] Update DITEMUKAN!");
                println!("[Updater] Versi Baru: {}", update.version);
                println!("[Updater] Tanggal Rilis: {:?}", update.date);

                // Log detail platform yang dibaca dari JSON
                // Catatan: update.url adalah URL download untuk platform saat ini
                println!("[Updater] URL Download: {}", update.download_url);
                println!("[Updater] Target Platform: {}", update.target);

                // Kirim ke Frontend
                app.emit("update-available", &update.version).unwrap();
                println!("[Updater] Event 'update-available' telah dikirim ke frontend.");
            } else {
                println!("[Updater] Tidak ada update tersedia. Versi aplikasi sudah paling baru.");
            }
        }
        Err(e) => {
            // Ini akan menangkap error seperti: status 404, koneksi ditolak, atau signature salah
            eprintln!("[Updater] ERROR saat mengecek update: {:?}", e);
        }
    }

    Ok(())
}

#[tauri::command]
async fn start_update_process(app: tauri::AppHandle) -> Result<(), String> {
    // 1. Cek ulang ketersediaan update
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        let mut downloaded = 0;

        // 2. Mulai download saat diperintah (klik tombol)
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
            .await
            .map_err(|e| e.to_string())?;

        // 3. Install
        update.install(bytes).map_err(|e| e.to_string())?;

        // 4. Tutup aplikasi agar installer MSI/TAR bisa bekerja tanpa lock file
        // Gunakan exit(0) atau restart() sesuai kebutuhan OS
        #[cfg(windows)]
        {
            // Di Windows, app.restart() kadang memicu reboot sistem jika file terkunci
            // app.exit(0) lebih aman agar MSI bisa mengganti file exe dengan tenang
            app.exit(0);
        }
        #[cfg(not(windows))]
        {
            app.restart();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                // 1. Beri jeda agar user bisa melihat animasi "Checking" di UI
                // Jika terlalu cepat, animasi di FE akan berkedip dan langsung hilang
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;

                println!("[Updater] Menjalankan pengecekan setelah jeda 4 detik...");

                // 2. Jalankan pengecekan update
                // Jika ada update, fungsi ini akan emit "update-available"
                // Jika tidak ada, FE akan otomatis balik ke 'idle' karena timer fallback 10 detik yang kita buat
                let _ = check_update_silent(handle.clone()).await;

                // 3. Inisialisasi Server Axum (Tetap seperti sebelumnya)

                let state = Arc::new(AppState {
                    handle: handle.clone(),
                });

                let app_router = Router::new()
                    .route("/print-raw", post(handle_print_raw))
                    .route(
                        "/printer-ready",
                        axum::routing::get(handle_printer_ready_get),
                    )
                    .layer(CorsLayer::permissive())
                    .with_state(state);

                let addr = "127.0.0.1:3001";
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
            start_update_process // Gunakan command baru ini di Frontend
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
