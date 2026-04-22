import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import pkg from "../package.json";
import {
  Check,
  Download,
  ListX,
  Printer,
  PrinterX,
  RefreshCw,
  X,
} from "lucide-react"; // Gunakan lucide-react jika typo
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { cn } from "./lib/utils";

interface UsbDevice {
  name: string;
  vid: string;
  pid: string;
}

interface UpdateState {
  // Tambahkan status 'checking'
  status: "idle" | "checking" | "notified" | "downloading" | "ready";
  progress: number;
  version: string;
}

export default function PrinterManager() {
  const [devices, setDevices] = useState<UsbDevice[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<UsbDevice | null>(
    null,
  );
  const [isOnline, setIsOnline] = useState<boolean>(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateState>({
    status: "checking", // Mulai dengan status checking saat aplikasi load
    progress: 0,
    version: "",
  });

  useEffect(() => {
    let unlistenAvailable: UnlistenFn;
    let unlistenProgress: UnlistenFn;
    let unlistenFinished: UnlistenFn;

    const init = async () => {
      const store = await load("settings.json", {
        autoSave: true,
        defaults: {},
      });
      const saved = await store.get<UsbDevice>("printer_aktif");
      if (saved) setSelectedPrinter(saved);

      // 1. Listen jika ada update tersedia
      unlistenAvailable = await listen<string>("update-available", (e) => {
        setUpdateInfo({
          status: "notified",
          progress: 0,
          version: e.payload,
        });
      });

      // 2. Listen progress download
      unlistenProgress = await listen<number>("update-progress", (e) => {
        setUpdateInfo((prev) => ({
          ...prev,
          status: "downloading",
          progress: e.payload,
        }));
      });

      // 3. Listen selesai download
      unlistenFinished = await listen("update-finished", () => {
        setUpdateInfo((prev) => ({ ...prev, status: "ready" }));
      });

      // 4. Timer Fallback: Jika setelah 10 detik tidak ada update, kembalikan ke idle
      const timeout = setTimeout(() => {
        setUpdateInfo((prev) =>
          prev.status === "checking" ? { ...prev, status: "idle" } : prev,
        );
      }, 10000);

      return () => clearTimeout(timeout);
    };

    init();
    scan();

    return () => {
      if (unlistenAvailable) unlistenAvailable();
      if (unlistenProgress) unlistenProgress();
      if (unlistenFinished) unlistenFinished();
    };
  }, []);

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

  const handleStartUpdate = async () => {
    try {
      await invoke("start_update_process");
    } catch (err) {
      alert("Gagal memperbarui: " + err);
      setUpdateInfo((prev) => ({ ...prev, status: "idle" }));
    }
  };

  return (
    <div className="p-8 bg-black min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* 🟢 OVERLAY UPDATER (Pop-up dinamis) */}
      {updateInfo.status !== "idle" && (
        <div
          className={cn(
            "fixed bottom-6 right-6 w-80 bg-zinc-900 border border-zinc-800 p-4 rounded-2xl shadow-2xl z-[9999] flex flex-col gap-4 animate-in slide-in-from-right-10 duration-500",
            updateInfo.status === "ready" && "border-green-500/50",
          )}
        >
          {/* Tampilan 1: SEDANG CEK UPDATE (Selama delay 5 detik di Rust) */}
          {updateInfo.status === "checking" && (
            <div className="flex items-center gap-4 py-2">
              <div className="relative flex items-center justify-center">
                <RefreshCw className="size-5 text-blue-500 animate-spin" />
                <div className="absolute size-8 bg-blue-500/20 rounded-full animate-ping" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white leading-none">
                  Menyelaraskan Sistem
                </h4>
                <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-widest animate-pulse">
                  Mengecek pembaruan...
                </p>
              </div>
            </div>
          )}

          {/* Tampilan 2: UPDATE TERSEDIA */}
          {updateInfo.status === "notified" && (
            <>
              <div className="flex items-start justify-between">
                <div className="flex gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg text-blue-500">
                    <Download className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Pembaruan Sistem
                    </h4>
                    <p className="text-[11px] text-zinc-500">
                      Tersedia Versi {updateInfo.version}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    setUpdateInfo((p) => ({ ...p, status: "idle" }))
                  }
                  className="text-zinc-600 hover:text-white transition-colors p-1"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleStartUpdate}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-[11px] h-9 rounded-xl font-bold"
                >
                  Update Sekarang
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setUpdateInfo((p) => ({ ...p, status: "idle" }))
                  }
                  className="flex-1 border-zinc-700 text-[11px] h-9 rounded-xl hover:bg-zinc-800 text-zinc-400"
                >
                  Nanti Saja
                </Button>
              </div>
            </>
          )}

          {/* Tampilan 3: SEDANG DOWNLOAD */}
          {updateInfo.status === "downloading" && (
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                <span className="animate-pulse text-blue-400">
                  Mengunduh...
                </span>
                <span>{Math.round(updateInfo.progress)}%</span>
              </div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${updateInfo.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Tampilan 4: SIAP INSTALL */}
          {updateInfo.status === "ready" && (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="size-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 animate-bounce">
                <Check className="size-5" />
              </div>
              <p className="text-[10px] text-green-500 font-bold tracking-widest uppercase">
                Menyiapkan Instalasi...
              </p>
            </div>
          )}
        </div>
      )}

      {/* 🔵 CONTENT UTAMA */}
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-black text-white leading-none tracking-tight">
              BRIDGE.
            </h1>
            <p className="text-xs text-zinc-500 mt-2 font-medium">
              Layanan Manajer Printer USB ESC/POS
            </p>
          </div>
          <Badge
            variant="outline"
            className="bg-zinc-900/50 border-zinc-800 text-zinc-400 px-3"
          >
            v{pkg.version}
          </Badge>
        </header>

        <section className="mb-12 relative">
          <div
            className={cn(
              "p-6 rounded-3xl border transition-all duration-500",
              selectedPrinter
                ? "bg-zinc-900/40 border-zinc-800 shadow-2xl"
                : "bg-zinc-950 border-dashed border-zinc-800",
            )}
          >
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-5">
                <div
                  className={cn(
                    "size-16 flex items-center justify-center rounded-2xl",
                    selectedPrinter
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-zinc-900 text-zinc-700",
                  )}
                >
                  {selectedPrinter ? (
                    <Printer className="size-8 stroke-[1.5]" />
                  ) : (
                    <PrinterX className="size-8 stroke-[1.5]" />
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em]">
                    Status Koneksi
                  </span>
                  <h2
                    className={cn(
                      "text-2xl font-bold mt-1 tracking-tight",
                      !selectedPrinter && "text-zinc-600",
                    )}
                  >
                    {selectedPrinter
                      ? selectedPrinter.name
                      : "Printer Belum Dipasangkan"}
                  </h2>
                </div>
              </div>
              {selectedPrinter && (
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase",
                    isOnline
                      ? "text-green-500 border-green-500/20"
                      : "text-red-500 border-red-500/20",
                  )}
                >
                  <div
                    className={cn(
                      "size-2 rounded-full",
                      isOnline
                        ? "bg-green-500 shadow-[0_0_8px_#22c55e]"
                        : "bg-red-500 animate-pulse",
                    )}
                  />
                  {isOnline ? "Terhubung" : "Terputus"}
                </div>
              )}
            </div>
            {selectedPrinter && (
              <div className="mt-8 flex gap-3">
                <Button
                  disabled={!isOnline}
                  onClick={() =>
                    invoke("print_test", {
                      vid: selectedPrinter.vid,
                      pid: selectedPrinter.pid,
                    })
                  }
                  className="flex-1 h-12 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2 transition-all active:scale-[0.98] disabled:opacity-30"
                >
                  <Printer className="size-4" /> Cetak Uji Coba
                </Button>
                <Button
                  onClick={handleRemovePrinter}
                  variant="outline"
                  className="px-6 h-12 rounded-2xl border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-red-400 transition-all gap-2"
                >
                  <X className="size-4" /> Hapus
                </Button>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
              Perangkat Tersedia
            </h3>
            <Button
              onClick={scan}
              variant="ghost"
              size="sm"
              className="h-8 text-[10px] text-zinc-400 gap-2"
            >
              <RefreshCw className="size-3" /> PINDAI ULANG
            </Button>
          </div>
          <div className="grid gap-3">
            {devices.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 bg-zinc-900/20 rounded-3xl border border-dashed border-zinc-800 text-zinc-600">
                <ListX className="size-8 mb-3" />
                <p className="text-xs italic">
                  Tidak ada printer USB yang terdeteksi...
                </p>
              </div>
            )}
            {devices.map((dev, i) => {
              const active =
                selectedPrinter?.vid === dev.vid &&
                selectedPrinter?.pid === dev.pid;
              return (
                <div
                  key={i}
                  className={cn(
                    "group flex justify-between items-center p-4 rounded-2xl border transition-all",
                    active
                      ? "bg-blue-600/5 border-blue-500/30"
                      : "bg-zinc-900/20 border-zinc-900 hover:bg-zinc-900/40",
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        "p-3 rounded-xl",
                        active
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-zinc-900 text-zinc-600 group-hover:text-zinc-400",
                      )}
                    >
                      <Printer className="size-5" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-zinc-200">
                        {dev.name}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-600 uppercase mt-0.5">
                        ID: {dev.vid} : {dev.pid}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSelect(dev)}
                    disabled={active}
                    className={cn(
                      "rounded-xl px-5 text-[10px] font-black tracking-widest transition-all",
                      active
                        ? "bg-transparent text-blue-500"
                        : "bg-white text-black",
                    )}
                  >
                    {active ? (
                      <>
                        <Check className="size-3" /> AKTIF
                      </>
                    ) : (
                      "PASANGKAN"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
