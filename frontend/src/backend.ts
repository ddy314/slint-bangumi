import { useCallback, useEffect, useState } from "react";
import type { Subject } from "./data";

export type LibraryStats = {
  total: number;
  matched: number;
  unmatched: number;
  tentative: number;
};

export type BackendSnapshot = {
  subjects: Subject[];
  stats: LibraryStats;
  settings: {
    bangumiEnabled: boolean;
    bangumiAutoMatch: boolean;
    bangumiCacheImages: boolean;
    dandanplayConfigured: boolean;
  };
};

export type ScanResponse = {
  summary: {
    scannedFiles: number;
    added: number;
    modified: number;
    restored: number;
    unchanged: number;
    deleted: number;
  };
  scraped: number;
  snapshot: BackendSnapshot;
};

const fallbackSnapshot: BackendSnapshot = {
  subjects: [],
  stats: {
    total: 0,
    matched: 0,
    unmatched: 0,
    tentative: 0,
  },
  settings: {
    bangumiEnabled: true,
    bangumiAutoMatch: true,
    bangumiCacheImages: true,
    dandanplayConfigured: false,
  },
};

export function useBackendSnapshot() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(Boolean(window.nexplay));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.nexplay) {
      setSnapshot(fallbackSnapshot);
      setError("请从 Electron 窗口使用 NexPlay；浏览器中的 Vite 页面无法访问本地 Rust 后端。");
      setLoading(false);
      return fallbackSnapshot;
    }

    setLoading(true);
    try {
      const next = await window.nexplay.getSnapshot();
      setSnapshot(next);
      setError(null);
      return next;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setSnapshot(fallbackSnapshot);
      return fallbackSnapshot;
    } finally {
      setLoading(false);
    }
  }, []);

  const scanLibrary = useCallback(async () => {
    if (!window.nexplay) {
      return null;
    }

    const response = await window.nexplay.scanLibrary();
    setSnapshot(response.snapshot);
    setError(null);
    return response;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...snapshot,
    loading,
    error,
    refresh,
    scanLibrary,
  };
}
