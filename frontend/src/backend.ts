import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackendEvent as GeneratedBackendEvent,
  BackendSnapshot as GeneratedBackendSnapshot,
  BangumiAuthStatusData,
  BangumiLoginStartData,
  BangumiSyncSummaryData,
  FrontendEditableSettings,
  DanmakuTrackResponse as GeneratedDanmakuTrackResponse,
  CatalogSearchResponse,
  ConnectionTestResponse,
  DownloadTaskData,
  DownloadTasksResponse,
  EpisodeResourceData,
  EpisodeResourcesResponse,
  MediaSourceResponse,
  OpenMediaResponse,
  ScanResponse as GeneratedScanResponse,
} from "./generated/backend";

export type BackendSnapshot = GeneratedBackendSnapshot;
export type EditableSettings = FrontendEditableSettings;
export type ScanResponse = GeneratedScanResponse;
export type MediaSource = MediaSourceResponse;
export type DanmakuTrack = GeneratedDanmakuTrackResponse;
export type CatalogSearch = CatalogSearchResponse;
export type EpisodeResource = EpisodeResourceData;
export type EpisodeResources = EpisodeResourcesResponse;
export type DownloadTask = DownloadTaskData;
export type DownloadTasks = DownloadTasksResponse;
export type ConnectionTest = ConnectionTestResponse;
export type BangumiAuthStatus = BangumiAuthStatusData;
export type BangumiLoginStart = BangumiLoginStartData;
export type BangumiSyncSummary = BangumiSyncSummaryData;
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
  renderMode?: "browserVideo" | "webglTexture" | "externalMpv";
  textureProbe?: MpvTextureProbe;
};

export type MpvFrame = {
  ok: boolean;
  width: number;
  height: number;
  stride: number;
  position?: number;
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

export type BangumiSyncStatus = {
  running: boolean;
  message: string;
  processed: number;
  total: number;
  lastSyncedAt?: number;
  lastError?: string | null;
};

const fallbackSnapshot: BackendSnapshot = {
  subjects: [],
  bangumiCollections: [],
  bangumiAuth: {
    configured: false,
    authenticated: false,
    username: null,
    nickname: null,
    avatarUrl: null,
    clientConfigured: false,
    redirectUri: "http://127.0.0.1:17654/bangumi/callback",
    pendingSyncCount: 0,
    lastError: null,
  },
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
const BACKEND_EVENT_UI_FLUSH_MS = 120;
type ScanStatusUpdater = (current: ScanStatus) => ScanStatus;

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
  const [bangumiSyncStatus, setBangumiSyncStatus] = useState<BangumiSyncStatus>({
    running: false,
    message: "",
    processed: 0,
    total: 0,
    lastError: null,
  });
  const pendingLogsRef = useRef<BackendLogEntry[]>([]);
  const logFlushTimerRef = useRef<number | null>(null);
  const scanStatusThrottleRef = useRef<{
    lastCommitAt: number;
    timer: number | null;
    pending: ScanStatusUpdater | null;
  }>({
    lastCommitAt: 0,
    timer: null,
    pending: null,
  });

  const flushLogs = useCallback(() => {
    if (logFlushTimerRef.current !== null) {
      window.clearTimeout(logFlushTimerRef.current);
      logFlushTimerRef.current = null;
    }

    const nextLogs = pendingLogsRef.current;
    if (!nextLogs.length) {
      return;
    }

    pendingLogsRef.current = [];
    setLogs((current) => [...current, ...nextLogs].slice(-120));
  }, []);

  const appendLog = useCallback((text: string, tone?: BackendLogEntry["tone"]) => {
    pendingLogsRef.current.push({ id: Date.now() + Math.random(), text, tone });
    if (logFlushTimerRef.current === null) {
      logFlushTimerRef.current = window.setTimeout(flushLogs, BACKEND_EVENT_UI_FLUSH_MS);
    }
  }, [flushLogs]);

  const commitScanStatus = useCallback((updater: ScanStatusUpdater) => {
    const throttle = scanStatusThrottleRef.current;
    if (throttle.timer !== null) {
      window.clearTimeout(throttle.timer);
      throttle.timer = null;
    }
    throttle.pending = null;
    throttle.lastCommitAt = performance.now();
    setScanStatus(updater);
  }, []);

  const queueScanStatus = useCallback((updater: ScanStatusUpdater) => {
    const throttle = scanStatusThrottleRef.current;
    const now = performance.now();
    const elapsed = now - throttle.lastCommitAt;
    throttle.pending = updater;

    if (elapsed >= BACKEND_EVENT_UI_FLUSH_MS) {
      throttle.pending = null;
      throttle.lastCommitAt = now;
      setScanStatus(updater);
      return;
    }

    if (throttle.timer !== null) {
      return;
    }

    throttle.timer = window.setTimeout(() => {
      const pending = throttle.pending;
      throttle.pending = null;
      throttle.timer = null;
      throttle.lastCommitAt = performance.now();
      if (pending) {
        setScanStatus(pending);
      }
    }, BACKEND_EVENT_UI_FLUSH_MS - elapsed);
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

    if (logFlushTimerRef.current !== null) {
      window.clearTimeout(logFlushTimerRef.current);
      logFlushTimerRef.current = null;
    }
    pendingLogsRef.current = [];
    setLogs([]);
    commitScanStatus(() => ({
      running: true,
      stage: "scan",
      message: "正在启动扫描",
      scanned: 0,
      indexed: 0,
      processed: 0,
      total: 0,
    }));
    const response = normalizeScanResponse(await window.nexplay.scanLibrary());
    setSnapshot(response.snapshot);
    setError(null);
    commitScanStatus((current) => ({
      ...current,
      running: false,
      stage: "done",
      message: `扫描完成：${response.summary.scannedFiles} 个文件，整理 ${response.scraped} 个`,
    }));
    return response;
  }, [commitScanStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const autoScanGuardRef = useRef(false);

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
          commitScanStatus(() => ({
            running: true,
            stage: "scan",
            message: event.message || "扫描已开始",
            scanned: 0,
            indexed: 0,
            processed: 0,
            total: 0,
          }));
          break;
        case "scanProgress":
          queueScanStatus((current) => ({
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
          commitScanStatus((current) => ({
            ...current,
            running: true,
            stage: "metadata",
            message: "文件扫描完成，正在整理元数据",
            scanned: summary.scannedFiles || current.scanned,
            indexed: summary.scannedFiles || current.indexed,
          }));
          break;
        case "metadataProgress":
          queueScanStatus((current) => ({
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
          commitScanStatus((current) => ({
            ...current,
            running: false,
            stage: "failed",
            message: event.message || "扫描失败",
          }));
          autoScanGuardRef.current = false;
          break;
        case "bangumiOAuthCompleted":
          setBangumiSyncStatus((current) => ({
            ...current,
            running: true,
            message: event.message ? `Bangumi 登录完成：${event.message}` : "Bangumi 登录完成，正在刷新",
            lastError: null,
          }));
          void refresh();
          break;
        case "bangumiSyncStarted":
          setBangumiSyncStatus({
            running: true,
            message: event.message || "正在同步 Bangumi",
            processed: 0,
            total: event.total ?? 0,
            lastError: null,
          });
          break;
        case "bangumiSyncProgress":
          setBangumiSyncStatus((current) => ({
            ...current,
            running: true,
            message: event.message || "正在同步 Bangumi",
            processed: event.processed ?? current.processed,
            total: event.total ?? current.total,
            lastError: null,
          }));
          break;
        case "bangumiSyncFinished":
          setBangumiSyncStatus((current) => ({
            ...current,
            running: false,
            message: event.message || "Bangumi 同步完成",
            processed: event.processed ?? current.processed,
            total: event.total ?? current.total,
            lastSyncedAt: Date.now(),
            lastError: null,
          }));
          void refresh();
          break;
        case "bangumiSyncFailed":
          setBangumiSyncStatus((current) => ({
            ...current,
            running: false,
            message: event.message || "Bangumi 同步失败",
            lastError: event.message || "Bangumi 同步失败",
          }));
          void refresh();
          break;
        case "downloadCompleted":
          if (!autoScanGuardRef.current) {
            autoScanGuardRef.current = true;
            scanLibrary().finally(() => {
              autoScanGuardRef.current = false;
            });
          }
          break;
      }
    });
  }, [appendLog, commitScanStatus, queueScanStatus, refresh, scanLibrary]);

  useEffect(() => () => {
    if (logFlushTimerRef.current !== null) {
      window.clearTimeout(logFlushTimerRef.current);
      logFlushTimerRef.current = null;
    }
    pendingLogsRef.current = [];
    const throttle = scanStatusThrottleRef.current;
    if (throttle.timer !== null) {
      window.clearTimeout(throttle.timer);
      throttle.timer = null;
    }
  }, []);

  return {
    ...snapshot,
    loading,
    error,
    logs,
    scanStatus,
    bangumiSyncStatus,
    refresh,
    scanLibrary,
  };
}

export async function searchCatalog(query: string, limit = 24): Promise<CatalogSearch> {
  if (!window.nexplay) {
    return { subjects: [] };
  }
  return window.nexplay.searchCatalog({ query, limit });
}

export async function loadOnlineSubject(provider: string, providerSubjectId: string) {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.onlineSubject({ provider, providerSubjectId });
}

export async function refreshSubjectMetadata(subjectId: number) {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.refreshSubjectMetadata({ subjectId });
}

export async function searchEpisodeResources(input: {
  subjectProvider: string;
  providerSubjectId: string;
  title: string;
  titleCn: string;
  aliases?: string[];
  episodeNumber?: number;
  limit?: number;
}): Promise<EpisodeResources> {
  if (!window.nexplay) {
    return { resources: [] };
  }
  return window.nexplay.episodeResources({ ...input, aliases: input.aliases ?? [], limit: input.limit ?? 32 });
}

export async function startResourceDownload(input: {
  resource: EpisodeResource;
  subjectProvider: string;
  providerSubjectId: string;
  episodeNumber?: number;
}): Promise<DownloadTask> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.startResourceDownload(input);
}

export async function downloadTasks(): Promise<DownloadTasks> {
  if (!window.nexplay) {
    return { tasks: [] };
  }
  return window.nexplay.downloadTasks();
}

export async function controlDownloadTask(input: {
  taskId: number;
  action: "pause" | "resume" | "cancel" | "remove";
  deleteFiles?: boolean;
}): Promise<DownloadTasks> {
  if (!window.nexplay) {
    return { tasks: [] };
  }
  return window.nexplay.controlDownloadTask({ ...input, deleteFiles: input.deleteFiles ?? false });
}

export async function bangumiAuthStatus(): Promise<BangumiAuthStatus> {
  if (!window.nexplay) {
    return fallbackSnapshot.bangumiAuth;
  }
  return window.nexplay.bangumiAuthStatus();
}

export async function startBangumiLogin(): Promise<BangumiLoginStart> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.startBangumiLogin();
}

export async function logoutBangumi(): Promise<BangumiAuthStatus> {
  if (!window.nexplay) {
    return fallbackSnapshot.bangumiAuth;
  }
  return window.nexplay.logoutBangumi();
}

export async function syncBangumiNow(): Promise<BangumiSyncSummary> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.syncBangumiNow();
}

export async function syncBangumiSubject(subjectId: number): Promise<BangumiSyncSummary> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.syncBangumiSubject({ subjectId });
}

export async function updateBangumiCollection(input: {
  subjectId: number;
  collectionType: number;
  rate?: number | null;
}): Promise<BangumiSyncSummary> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.updateBangumiCollection({
    subjectId: input.subjectId,
    collectionType: input.collectionType,
    rate: input.rate ?? null,
  });
}

export async function updateBangumiEpisode(input: {
  subjectId: number;
  episodeId: number;
  collectionType: number;
}): Promise<BangumiSyncSummary> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.updateBangumiEpisode(input);
}

export async function batchUpdateBangumiEpisodes(input: {
  subjectId: number;
  episodeIds: number[];
  collectionType: number;
}): Promise<BangumiSyncSummary> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.batchUpdateBangumiEpisodes(input);
}

export async function reportPlaybackProgress(input: {
  subjectId: number;
  episodeId: number;
  mediaId?: number;
  position: number;
  duration: number;
}): Promise<BangumiSyncSummary> {
  if (!window.nexplay) {
    throw new Error("当前页面没有连接到 NexPlay 后端。");
  }
  return window.nexplay.reportPlaybackProgress(input);
}

export async function testQbittorrentConnection(): Promise<ConnectionTest> {
  if (!window.nexplay) {
    return { ok: false, message: "当前页面没有连接到 NexPlay 后端。" };
  }
  return window.nexplay.testQbittorrentConnection();
}
