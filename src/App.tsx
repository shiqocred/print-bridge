import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Listen status dari Rust
    const unlisten = listen<boolean>("printer-status", (event) => {
      setIsReady(event.payload);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="p-4 rounded-lg border">
      <div className="flex items-center gap-2">
        <div
          className={`w-3 h-3 rounded-full ${isReady ? "bg-green-500" : "bg-red-500"}`}
        />
        <span className="font-bold">
          Printer POS:{" "}
          {isReady ? "READY (ONLINE)" : "OFFLINE / TIDAK TERDETEKSI"}
        </span>
      </div>
      {!isReady && (
        <p className="text-sm text-red-400 mt-1">
          Mohon cek kabel USB dan pastikan printer sudah menyala.
        </p>
      )}
    </div>
  );
}
