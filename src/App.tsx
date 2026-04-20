import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface UsbDevice {
  name: string;
  vid: string;
  pid: string;
}

interface UpdateState {
  status: "idle" | "downloading" | "ready";
  progress: number;
  version: string;
}

export default function PrinterManager() {
  const [devices, setDevices] = useState<UsbDevice[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<UsbDevice | null>(
    null,
  );
  const [isOnline, setIsOnline] = useState<boolean>(false);

  // State Baru untuk Updater
  const [updateInfo, setUpdateInfo] = useState<UpdateState>({
    status: "idle",
    progress: 0,
    version: "",
  });

  // --- 1. MOUNT: Store, Scan, & Listen for Updates ---
  useEffect(() => {
    const init = async () => {
      // Load Store
      const store = await load("settings.json", {
        autoSave: true,
        defaults: {},
      });
      const saved = await store.get<UsbDevice>("printer_aktif");
      if (saved) setSelectedPrinter(saved);

      // Listen Update Events dari Rust
      const unlistenAvailable = await listen<string>(
        "update-available",
        (e) => {
          setUpdateInfo((prev) => ({
            ...prev,
            status: "downloading",
            version: e.payload,
          }));
        },
      );
      const unlistenProgress = await listen<number>("update-progress", (e) => {
        setUpdateInfo((prev) => ({ ...prev, progress: e.payload }));
      });
      const unlistenFinished = await listen("update-finished", () => {
        setUpdateInfo((prev) => ({ ...prev, status: "ready" }));
      });

      return () => {
        unlistenAvailable();
        unlistenProgress();
        unlistenFinished();
      };
    };

    init();
    scan();
  }, []);

  // --- 2. STATUS CHECKER (Polling) ---
  useEffect(() => {
    const checkStatus = async () => {
      if (!selectedPrinter) {
        setIsOnline(false);
        return;
      }
      try {
        const status = await invoke<boolean>("is_printer_ready", {
          vid: selectedPrinter.vid,
          pid: selectedPrinter.pid,
        });
        setIsOnline(status);
      } catch (e) {
        setIsOnline(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [selectedPrinter]);

  // --- HANDLERS ---
  const scan = async () => {
    try {
      const list: UsbDevice[] = await invoke("list_usb_devices");
      setDevices(list);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelect = async (dev: UsbDevice) => {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("printer_aktif", dev);
    setSelectedPrinter(dev);
  };

  const handleRemovePrinter = async () => {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.delete("printer_aktif");
    await store.save();
    setSelectedPrinter(null);
  };

  const handleInstallUpdate = async () => {
    try {
      await invoke("install_update");
    } catch (err) {
      alert("Gagal menginstal update: " + err);
    }
  };

  return (
    <div className="p-8 bg-black min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* 🟢 OVERLAY UPDATER (Hanya muncul jika ada update) */}
      {updateInfo.status !== "idle" && (
        <div className="fixed bottom-6 right-6 w-80 bg-zinc-900 border border-zinc-800 p-5 rounded-2xl shadow-2xl z-50 animate-in slide-in-from-bottom-10 duration-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <svg
                className="w-5 h-5 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">System Update</h4>
              <p className="text-[10px] text-zinc-500 uppercase tracking-tighter">
                Versi {updateInfo.version}
              </p>
            </div>
          </div>

          {updateInfo.status === "downloading" ? (
            <div>
              <div className="flex justify-between text-[10px] mb-2 font-mono text-zinc-400">
                <span>DOWNLOADING...</span>
                <span>{Math.round(updateInfo.progress)}%</span>
              </div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${updateInfo.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleInstallUpdate}
              className="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-green-900/20"
            >
              Restart & Update
            </button>
          )}
        </div>
      )}

      {/* 🔵 HEADER & ACTIVE PRINTER */}
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-white">
              BRIDGE.
            </h1>
            <p className="text-xs text-zinc-500 font-medium">
              ESC/POS USB Service Manager
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] bg-zinc-900 border border-zinc-800 px-2 py-1 rounded text-zinc-400 font-mono">
              v1.0.0
            </span>
          </div>
        </header>

        <section className="mb-12 relative">
          <div
            className={`p-6 rounded-3xl border transition-all duration-500 ${
              selectedPrinter
                ? "bg-zinc-900/50 border-zinc-800 shadow-2xl"
                : "bg-zinc-950 border-dashed border-zinc-800"
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.3em]">
                  Status Koneksi
                </span>
                <h2
                  className={`text-2xl font-bold mt-1 tracking-tight ${!selectedPrinter && "text-zinc-700"}`}
                >
                  {selectedPrinter ? selectedPrinter.name : "Belum Ada Printer"}
                </h2>
              </div>

              {selectedPrinter && (
                <div
                  className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
                    isOnline
                      ? "bg-green-500/5 border-green-500/20"
                      : "bg-red-500/5 border-red-500/20"
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500 animate-pulse"}`}
                  />
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest ${isOnline ? "text-green-500" : "text-red-500"}`}
                  >
                    {isOnline ? "Ready" : "Offline"}
                  </span>
                </div>
              )}
            </div>

            {selectedPrinter && (
              <div className="mt-8 flex gap-3">
                <button
                  disabled={!isOnline}
                  onClick={() =>
                    invoke("print_test", {
                      vid: selectedPrinter.vid,
                      pid: selectedPrinter.pid,
                    })
                  }
                  className="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-500 disabled:opacity-30 disabled:grayscale transition-all"
                >
                  Kirim Test Print
                </button>
                <button
                  onClick={handleRemovePrinter}
                  className="px-6 py-3 rounded-2xl bg-zinc-800 text-zinc-400 text-xs font-bold hover:bg-zinc-700 transition-all"
                >
                  Unpair
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 🟠 DEVICE LIST */}
        <section>
          <div className="flex justify-between items-end mb-6 px-2">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">
              Perangkat Tersedia
            </h3>
            <button
              onClick={scan}
              className="text-[10px] text-zinc-400 hover:text-blue-400 font-bold transition-colors"
            >
              REFRESH SCAN
            </button>
          </div>

          <div className="grid gap-2">
            {devices.map((dev, i) => {
              const active =
                selectedPrinter?.vid === dev.vid &&
                selectedPrinter?.pid === dev.pid;
              return (
                <div
                  key={i}
                  className={`group flex justify-between items-center p-4 rounded-2xl border transition-all ${
                    active
                      ? "bg-blue-600/5 border-blue-500/30"
                      : "bg-zinc-900/20 border-zinc-900 hover:border-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-3 rounded-xl ${active ? "bg-blue-500/10 text-blue-500" : "bg-zinc-900 text-zinc-600"}`}
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="font-bold text-sm text-zinc-200">
                        {dev.name}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-tighter">
                        {dev.vid} : {dev.pid}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSelect(dev)}
                    disabled={active}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${
                      active
                        ? "text-blue-500"
                        : "bg-white text-black hover:scale-105 active:scale-95"
                    }`}
                  >
                    {active ? "ACTIVE" : "PAIR"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
