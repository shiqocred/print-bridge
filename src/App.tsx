import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import pkg from "../package.json";
import {
  Check,
  Download,
  ListX,
  Printer,
  PrinterX,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { cn } from "./lib/utils";

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

  const [updateInfo, setUpdateInfo] = useState<UpdateState>({
    status: "idle",
    progress: 0,
    version: "",
  });

  useEffect(() => {
    const init = async () => {
      const store = await load("settings.json", {
        autoSave: true,
        defaults: {},
      });
      const saved = await store.get<UsbDevice>("printer_aktif");
      if (saved) setSelectedPrinter(saved);

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

  const handleInstallUpdate = async () => {
    try {
      await invoke("install_update");
    } catch (err) {
      alert("Gagal menginstal pembaruan: " + err);
    }
  };

  return (
    <div className="p-8 bg-black min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* 🟢 OVERLAY UPDATER */}
      {updateInfo.status !== "idle" && (
        <div className="fixed bottom-6 right-6 w-64 bg-zinc-900 border border-zinc-800 p-3 rounded-2xl shadow-2xl z-50 animate-in slide-in-from-bottom-10 duration-500 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg text-blue-500">
              <Download className="size-5" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-white">
                Pembaruan Sistem
              </h4>
              <p className="text-[11px] text-zinc-400">
                Versi {updateInfo.version}
              </p>
            </div>
          </div>

          {updateInfo.status === "downloading" ? (
            <div>
              <div className="flex justify-between text-[11px] mb-2 font-mono text-zinc-400">
                <span>Mengunduh...</span>
                <span>{Math.round(updateInfo.progress)}%</span>
              </div>
              <div className="w-full bg-zinc-700/70 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${updateInfo.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <Button
              onClick={handleInstallUpdate}
              className="w-full bg-blue-700 hover:bg-blue-800 rounded-full text-xs"
            >
              Pasang & Mulai Ulang
            </Button>
          )}
        </div>
      )}

      {/* 🔵 HEADER & PRINTER AKTIF */}
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-black text-white leading-none">
              BRIDGE.
            </h1>
            <p className="text-xs text-zinc-400 mt-2">
              Layanan Manajer Printer USB ESC/POS
            </p>
          </div>
          <Badge
            variant="outline"
            className="bg-zinc-800 border-zinc-600 text-zinc-300 tabular-nums"
          >
            v{pkg.version}
          </Badge>
        </header>

        <section className="mb-12 relative">
          <div
            className={cn(
              "p-6 rounded-xl border transition-all duration-500",
              selectedPrinter
                ? "bg-zinc-900/50 border-zinc-500/80 shadow-2xl"
                : "bg-zinc-950 border-dashed border-zinc-700",
            )}
          >
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-4">
                <div className="size-16 flex items-center justify-center rounded-lg bg-blue-500/35 text-blue-300">
                  {selectedPrinter ? (
                    <Printer className="size-8 stroke-[1.25]" />
                  ) : (
                    <PrinterX className="size-8 stroke-[1.25]" />
                  )}
                </div>
                <div>
                  <span className="text-xs font-medium text-blue-400">
                    Status Koneksi
                  </span>
                  <h2
                    className={cn(
                      "text-2xl font-semibold",
                      !selectedPrinter && "text-zinc-500",
                    )}
                  >
                    {selectedPrinter
                      ? selectedPrinter.name
                      : "Belum Ada Printer Terpilih"}
                  </h2>
                </div>
              </div>

              {selectedPrinter && (
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-1 rounded-full border",
                    isOnline
                      ? "bg-green-500/5 border-green-500/20"
                      : "bg-red-500/5 border-red-500/20",
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
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isOnline ? "text-green-400" : "text-red-400",
                    )}
                  >
                    {isOnline ? "Terhubung" : "Terputus"}
                  </span>
                </div>
              )}
            </div>

            {selectedPrinter && (
              <div className="mt-6 flex gap-3">
                <Button
                  disabled={!isOnline}
                  onClick={() =>
                    invoke("print_test", {
                      vid: selectedPrinter.vid,
                      pid: selectedPrinter.pid,
                    })
                  }
                  size="lg"
                  className="bg-blue-500 w-full flex-auto rounded-full hover:bg-blue-600 gap-2"
                >
                  <Printer className="size-4" />
                  Cetak Tes
                </Button>
                <Button
                  onClick={handleRemovePrinter}
                  size="lg"
                  variant="destructive"
                  className="bg-red-500/50 hover:bg-red-500/70 rounded-full text-white gap-2"
                >
                  <X className="size-4" />
                  Hapus
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* 🟠 DAFTAR PERANGKAT */}
        <section>
          <div className="flex justify-between items-end mb-6 px-2">
            <h3 className="text-sm text-zinc-400">Perangkat Terdeteksi</h3>
            <Button
              onClick={scan}
              size="sm"
              className="text-xs gap-2 hover:bg-blue-600 bg-blue-600/50"
            >
              <RefreshCw className="size-3" />
              Pindai Ulang
            </Button>
          </div>

          <div className="flex flex-col gap-3 items-center justify-center">
            {devices.length === 0 && (
              <div className="flex items-center flex-col gap-4 h-32 justify-center bg-zinc-900/90 w-full rounded-xl border border-zinc-800">
                <div className="size-10 bg-zinc-700 flex items-center justify-center rounded-full text-zinc-400">
                  <ListX className="size-4" />
                </div>
                <p className="text-zinc-400 text-xs text-center">
                  Tidak ada printer USB yang ditemukan...
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
                    "group flex justify-between items-center p-4 rounded-xl border transition-all w-full",
                    active
                      ? "bg-blue-600/5 border-blue-500/30"
                      : "bg-zinc-900/20 border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900/70",
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        "p-3 rounded-lg",
                        active
                          ? "bg-blue-500/35 text-blue-300"
                          : "bg-zinc-700 text-zinc-300",
                      )}
                    >
                      <Printer className="size-5" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="font-semibold text-sm text-zinc-200">
                        {dev.name}
                      </p>
                      <p className="text-xs font-mono text-zinc-500 uppercase">
                        VID: {dev.vid} - PID: {dev.pid}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSelect(dev)}
                    disabled={active}
                    className={cn(
                      "rounded-full w-28 transition-all",
                      active
                        ? "bg-transparent text-blue-500 disabled:opacity-100 gap-2"
                        : "bg-white text-black hover:bg-zinc-300",
                    )}
                  >
                    {active ? (
                      <>
                        <Check className="size-4" />
                        Digunakan
                      </>
                    ) : (
                      "Gunakan"
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
