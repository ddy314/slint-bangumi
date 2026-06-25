/// <reference types="vite/client" />

interface Window {
  nexplay?: {
    appName: string;
    getSnapshot: () => Promise<import("./backend").BackendSnapshot>;
    scanLibrary: () => Promise<import("./backend").ScanResponse>;
    getSettings: () => Promise<import("./backend").EditableSettings>;
    saveSettings: (settings: import("./backend").EditableSettings) => Promise<import("./backend").EditableSettings>;
    searchCatalog: (payload: import("./generated/backend").CatalogSearchRequest) => Promise<import("./backend").CatalogSearch>;
    onlineSubject: (payload: import("./generated/backend").OnlineSubjectRequest) => Promise<import("./data").Subject>;
    refreshSubjectMetadata: (payload: import("./generated/backend").RefreshSubjectRequest) => Promise<import("./data").Subject>;
    episodeResources: (payload: import("./generated/backend").EpisodeResourcesRequest) => Promise<import("./backend").EpisodeResources>;
    startResourceDownload: (payload: import("./generated/backend").StartResourceDownloadRequest) => Promise<import("./backend").DownloadTask>;
    downloadTasks: () => Promise<import("./backend").DownloadTasks>;
    controlDownloadTask: (payload: import("./generated/backend").DownloadTaskActionRequest) => Promise<import("./backend").DownloadTasks>;
    testQbittorrentConnection: () => Promise<import("./backend").ConnectionTest>;
    openMedia: (mediaId: number) => Promise<{ opened: boolean }>;
    getMediaSource: (mediaId: number) => Promise<import("./backend").MediaSource>;
    danmakuTrack: (mediaId: number) => Promise<import("./backend").DanmakuTrack>;
    mpvLoad: (mediaId: number) => Promise<import("./backend").MpvState>;
    mpvSetTrack: (kind: "audio" | "subtitle", id: number | null) => Promise<import("./backend").MpvState>;
    mpvSetPause: (paused: boolean) => Promise<import("./backend").MpvState>;
    mpvSeek: (position: number) => Promise<import("./backend").MpvState>;
    mpvSetVolume: (volume: number) => Promise<import("./backend").MpvState>;
    mpvStop: () => Promise<import("./backend").MpvState>;
    mpvState: () => Promise<import("./backend").MpvState>;
    mpvRenderInfo: () => Promise<import("./backend").MpvRenderInfo>;
    mpvProbeWebglTextureRenderer: () => Promise<import("./backend").MpvTextureProbe>;
    mpvRenderFrame: (width: number, height: number) => Promise<import("./backend").MpvFrame>;
    onBackendEvent: (callback: (event: import("./backend").BackendEvent) => void) => () => void;
    resolveAssetUrl: (value: string) => string;
  };
}
