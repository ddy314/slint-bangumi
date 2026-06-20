import { useCallback, useEffect, useState } from "react";
import type {
  BackendEvent as GeneratedBackendEvent,
  BackendSnapshot as GeneratedBackendSnapshot,
  FrontendEditableSettings,
  MediaSourceResponse,
  OpenMediaResponse,
  ScanResponse as GeneratedScanResponse,
} from "./generated/backend";

export type BackendSnapshot = GeneratedBackendSnapshot;
export type EditableSettings = FrontendEditableSettings;
export type ScanResponse = GeneratedScanResponse;
export type MediaSource = MediaSourceResponse;
export type { OpenMediaResponse };

export type MpvTrack = {
  id: number;
  kind: string;
  title: string;
  lang: string;
  codec: string;
  selected: boolean;
  external: boolean;
};

export type MpvState = {
  ok?: boolean;
  loaded?: boolean;
  audioTracks: MpvTrack[];
  subtitleTracks: MpvTrack[];
  duration?: number;
  position?: number;
  paused?: boolean;
  volume?: number;
  fps?: number;
  videoWidth?: number;
  videoHeight?: number;
  source?: MediaSource;
  renderMode?: "webglTexture" | "externalMpv";
  textureProbe?: MpvTextureProbe;
};

export type MpvFrame = {
  ok: boolean;
  width: number;
  height: number;
  stride: number;
  pixels: Uint8Array;
};

export type MpvRenderProbe = {
  ok: boolean;
  stage?: string;
  error?: string;
  renderApi?: string;
  mpvClientApiVersion?: number;
  eglVendor?: string;
  eglVersion?: string;
  glVendor?: string;
  glRenderer?: string;
  glVersion?: string;
};

export type MpvTextureProbe = {
  ok: boolean;
  stage?: string;
  target?: string;
  renderApi?: string;
  transport?: string;
  upload?: string;
  fallback?: string;
  error?: string;
};

export type MpvRenderInfo = {
  available: boolean;
  modulePath?: string;
  reason?: string;
  build?: {
    available: boolean;
    bridge: string;
    renderApi: string;
    renderBackend?: string;
    nodeApiVersion: number;
    mpvClientApiVersion: number;
  };
  probe?: MpvRenderProbe;
  textureProbe?: MpvTextureProbe;
};

export type BackendEvent = GeneratedBackendEvent & {
  summary?: Partial<ScanResponse["summary"]> & {
    scanned_files?: number;
  };
};

export type BackendLogEntry = {
  id: number;
  text: string;
  tone?: "neutral" | "success" | "danger";
};

export type ScanStatus = {
  running: boolean;
  stage: "idle" | "scan" | "metadata" | "done" | "failed";
  message: string;
  scanned: number;
  indexed: number;
  processed: number;
  total: number;
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

function normalizeScanSummary(summary: BackendEvent["summary"] | ScanResponse["summary"] | undefined): ScanResponse["summary"] {
  const raw = summary as
    | (Partial<ScanResponse["summary"]> & { scanned_files?: number })
    | undefined;
  return {
    scannedFiles: raw?.scannedFiles ?? raw?.scanned_files ?? 0,
    added: raw?.added ?? 0,
    modified: raw?.modified ?? 0,
    restored: raw?.restored ?? 0,
    unchanged: raw?.unchanged ?? 0,
    deleted: raw?.deleted ?? 0,
  };
}

function normalizeScanResponse(response: ScanResponse): ScanResponse {
  return {
    ...response,
    summary: normalizeScanSummary(response.summary),
  };
}

export function useBackendSnapshot() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(Boolean(window.nexplay));
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<BackendLogEntry[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({
    running: false,
    stage: "idle",
    message: "",
    scanned: 0,
    indexed: 0,
    processed: 0,
    total: 0,
  });

  const appendLog = useCallback((text: string, tone?: BackendLogEntry["tone"]) => {
    setLogs((current) => [...current.slice(-119), { id: Date.now() + Math.random(), text, tone }]);
  }, []);

  const refresh = useCallback(async () => {
    if (!window.nexplay) {
      setSnapshot(fallbackSnapshot);
      setError("当前页面没有连接到 NexPlay 后端。请从 Electron 应用窗口使用。");
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

    setLogs([]);
    setScanStatus({
      running: true,
      stage: "scan",
      message: "正在启动扫描",
      scanned: 0,
      indexed: 0,
      processed: 0,
      total: 0,
    });
    const response = normalizeScanResponse(await window.nexplay.scanLibrary());
    setSnapshot(response.snapshot);
    setError(null);
    setScanStatus((current) => ({
      ...current,
      running: false,
      stage: "done",
      message: `扫描完成：${response.summary.scannedFiles} 个文件，整理 ${response.scraped} 个`,
    }));
    return response;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.nexplay?.onBackendEvent) {
      return;
    }

    return window.nexplay.onBackendEvent((event) => {
      if (event.message) {
        appendLog(event.message, event.type.toLowerCase().includes("failed") ? "danger" : "neutral");
      }

      switch (event.type) {
        case "scanStarted":
          setScanStatus({
            running: true,
            stage: "scan",
            message: event.message || "扫描已开始",
            scanned: 0,
            indexed: 0,
            processed: 0,
            total: 0,
          });
          break;
        case "scanProgress":
          setScanStatus((current) => ({
            ...current,
            running: true,
            stage: "scan",
            message: event.message || "正在扫描文件",
            scanned: event.scanned ?? current.scanned,
            indexed: event.indexed ?? current.indexed,
          }));
          break;
        case "scanFinished":
          const summary = normalizeScanSummary(event.summary);
          setScanStatus((current) => ({
            ...current,
            running: true,
            stage: "metadata",
            message: "文件扫描完成，正在整理元数据",
            scanned: summary.scannedFiles || current.scanned,
            indexed: summary.scannedFiles || current.indexed,
          }));
          break;
        case "metadataProgress":
          setScanStatus((current) => ({
            ...current,
            running: true,
            stage: "metadata",
            message: event.message || "正在整理元数据",
            processed: event.processed ?? current.processed,
            total: event.total ?? current.total,
          }));
          break;
        case "scanFailed":
        case "metadataFailed":
          setScanStatus((current) => ({
            ...current,
            running: false,
            stage: "failed",
            message: event.message || "扫描失败",
          }));
          break;
      }
    });
  }, [appendLog]);

  return {
    ...snapshot,
    loading,
    error,
    logs,
    scanStatus,
    refresh,
    scanLibrary,
  };
}
