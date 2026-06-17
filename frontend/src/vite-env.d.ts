/// <reference types="vite/client" />

interface Window {
  nexplay?: {
    appName: string;
    getSnapshot: () => Promise<import("./backend").BackendSnapshot>;
    scanLibrary: () => Promise<import("./backend").ScanResponse>;
  };
}
