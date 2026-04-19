use axum::{body::Bytes, http::StatusCode, routing::post, Router};
use rusb::{Context, UsbContext};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::Emitter;
use tower_http::cors::{Any, CorsLayer};

const PRINTER_NAME: &str = "THERMAL_PRINT";
const TARGET_VID: u16 = 0x1A86;
const TARGET_PID: u16 = 0x8095;

// Fungsi cek fisik USB (Berjalan di Windows & macOS)
fn is_usb_plugged_in() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Kita tanya Windows: "Ada nggak perangkat yang namanya mengandung TECH CLA58?"
        let output = Command::new("powershell")
            .args([
                "-Command",
                "Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match 'TECH CLA58' }",
            ])
            .output();

        if let Ok(out) = output {
            // Jika output tidak kosong, berarti ketemu
            return !out.stdout.is_empty();
        }
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        // Kode rusb lama kamu untuk Mac tetap di sini
        let context = Context::new().ok();
        if let Some(ctx) = context {
            return ctx
                .open_device_with_vid_pid(TARGET_VID, TARGET_PID)
                .is_some();
        }
        false
    }
}

async fn handle_print(body: Bytes) -> StatusCode {
    if !is_usb_plugged_in() {
        println!("❌ Gagal: Kabel USB tidak terdeteksi.");
        return StatusCode::SERVICE_UNAVAILABLE;
    }

    // --- LOGIKA UNTUK MACOS ---
    #[cfg(target_os = "macos")]
    {
        println!("🖨️ [macOS] Mengirim data ke: {}", PRINTER_NAME);
        let process = Command::new("lp")
            .args(["-d", PRINTER_NAME, "-o", "raw"])
            .stdin(Stdio::piped())
            .spawn();

        return match process {
            Ok(mut child) => {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(&body);
                }
                match child.wait() {
                    Ok(s) if s.success() => StatusCode::OK,
                    _ => StatusCode::INTERNAL_SERVER_ERROR,
                }
            }
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
    }

    // --- LOGIKA UNTUK WINDOWS ---
    #[cfg(target_os = "windows")]
    {
        println!("🖨️ [Windows] Mengirim raw data via UNC Path...");

        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("print_job.bin");

        // Tulis data biner ke file sementara
        if std::fs::write(&temp_file, &body).is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR;
        }

        // Gunakan perintah COPY /B untuk mengirim file biner langsung ke printer yang di-share
        // Jalur: \\127.0.0.1\NamaSharePrinter
        let cmd = format!(
            "copy /b \"{}\" \"\\\\127.0.0.1\\THERMAL_PRINT\"",
            temp_file.to_str().unwrap_or_default()
        );

        let process = Command::new("cmd").args(["/C", &cmd]).spawn();

        return match process {
            Ok(mut child) => match child.wait() {
                Ok(s) if s.success() => {
                    let _ = std::fs::remove_file(temp_file);
                    StatusCode::OK
                }
                _ => {
                    println!("❌ Gagal mengirim file ke printer. Pastikan Printer Sharing aktif.");
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            },
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();

            // Thread Monitoring USB
            std::thread::spawn(move || loop {
                let plugged = is_usb_plugged_in();

                // TAMBAHKAN BARIS INI UNTUK DEBUG:
                if plugged {
                    println!("✅ DEBUG: Printer TERDETEKSI di Rust!");
                } else {
                    // Ini akan muncul setiap detik jika tidak terdeteksi
                    println!("❌ DEBUG: Printer TIDAK terdeteksi...");
                }

                let _ = handle.emit("printer-status", plugged);
                std::thread::sleep(Duration::from_secs(1));
            });

            // Server Axum (API Bridge)
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let app = Router::new().route("/print-raw", post(handle_print)).layer(
                        CorsLayer::new()
                            .allow_origin(Any)
                            .allow_methods(Any)
                            .allow_headers(Any),
                    );

                    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 3001));
                    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
                    axum::serve(listener, app).await.unwrap();
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
