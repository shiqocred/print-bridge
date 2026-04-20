import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

interface UsbDevice {
  name: string;
  vid: string;
  pid: string;
}

export default function PrinterManager() {
  const [devices, setDevices] = useState<UsbDevice[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<UsbDevice | null>(
    null,
  );

  // --- 1. MOUNT: Ambil data dari Store saat aplikasi dibuka ---
  useEffect(() => {
    const initStore = async () => {
      try {
        // Load file settings.json (otomatis dibuat jika belum ada)
        const store = await load("settings.json", {
          autoSave: true,
          defaults: {},
        });

        // Ambil data dengan key 'printer_aktif'
        const saved = await store.get<UsbDevice>("printer_aktif");

        if (saved) {
          console.log("Printer otomatis dimuat:", saved);
          setSelectedPrinter(saved);
        }
      } catch (err) {
        console.error("Gagal memuat store:", err);
      }
    };

    initStore();
    scan(); // Scan list printer saat startup
  }, []);

  // --- 2. SELECT: Simpan printer terpilih ke Store ---
  const handleSelect = async (dev: UsbDevice) => {
    try {
      const store = await load("settings.json", {
        autoSave: true,
        defaults: {},
      });

      // Simpan data
      await store.set("printer_aktif", dev);

      // Update State UI
      setSelectedPrinter(dev);

      alert(`Printer ${dev.name} tersimpan sebagai default!`);
    } catch (err) {
      console.error("Gagal menyimpan ke store:", err);
    }
  };

  const handleRemovePrinter = async () => {
    try {
      const store = await load("settings.json", {
        autoSave: true,
        defaults: {},
      });

      // 1. Hapus key 'printer_aktif' dari store
      await store.delete("printer_aktif");

      // 2. Simpan perubahan (Opsional jika autoSave aktif, tapi lebih aman dipanggil)
      await store.save();

      // 3. Reset state di UI
      setSelectedPrinter(null);

      alert("Printer default berhasil dihapus!");
    } catch (err) {
      console.error("Gagal menghapus printer:", err);
    }
  };

  const scan = async () => {
    try {
      const list: UsbDevice[] = await invoke("list_usb_devices");
      setDevices(list);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePrint = async () => {
    if (!selectedPrinter) return alert("Pilih printer dulu!");
    try {
      await invoke("print_test", {
        vid: selectedPrinter.vid,
        pid: selectedPrinter.pid,
      });
    } catch (err) {
      alert(err);
    }
  };

  return (
    <div className="p-10 bg-zinc-950 min-h-screen text-white">
      {/* Header & Status */}
      <div className="mb-8 border-b border-zinc-800 pb-6">
        <h1 className="text-2xl font-bold">Printer Bridge</h1>
        <div className="mt-4 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
          <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">
            Printer Aktif
          </p>
          <p className="text-lg font-mono text-blue-400">
            {selectedPrinter
              ? `${selectedPrinter.name} (${selectedPrinter.vid})`
              : "Belum Ada"}
          </p>
          {selectedPrinter && (
            <div className="flex gap-2">
              <button
                onClick={handlePrint}
                className="bg-blue-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-500"
              >
                Test Print
              </button>

              <button
                onClick={handleRemovePrinter}
                className="bg-zinc-800 border border-zinc-700 px-4 py-2 rounded-lg text-sm font-bold text-red-400 hover:bg-red-950/30"
              >
                Hapus Default
              </button>
            </div>
          )}
        </div>
      </div>

      {/* List Hasil Scan */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold">USB Terdeteksi</h3>
          <button
            onClick={scan}
            className="text-xs text-zinc-400 hover:text-white"
          >
            Refresh
          </button>
        </div>

        {devices.map((dev, i) => {
          const isSelected =
            selectedPrinter?.vid === dev.vid &&
            selectedPrinter?.pid === dev.pid;
          return (
            <div
              key={i}
              className="flex justify-between items-center p-4 bg-zinc-900/50 rounded-xl border border-zinc-800"
            >
              <div>
                <p className="font-bold text-sm">{dev.name}</p>
                <p className="text-[10px] text-zinc-600">
                  {dev.vid} | {dev.pid}
                </p>
              </div>
              <button
                onClick={() => handleSelect(dev)}
                disabled={isSelected}
                className={`px-4 py-1 rounded-lg text-[10px] font-bold ${
                  isSelected ? "bg-green-600 text-white" : "bg-white text-black"
                }`}
              >
                {isSelected ? "AKTIF" : "GUNAKAN"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
