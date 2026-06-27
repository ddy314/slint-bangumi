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
    prepareResourceDownload: (payload: import("./generated/backend").PrepareResourceDownloadRequest) => Promise<import("./backend").PreparedResourceDownload>;
    confirmResourceDownload: (payload: import("./generated/backend").ConfirmResourceDownloadRequest) => Promise<import("./backend").DownloadTask>;
    downloadTasks: () => Promise<import("./backend").DownloadTasks>;
    controlDownloadTask: (payload: import("./generated/backend").DownloadTaskActionRequest) => Promise<import("./backend").DownloadTasks>;
    bangumiAuthStatus: () => Promise<import("./backend").BangumiAuthStatus>;
    startBangumiLogin: () => Promise<import("./backend").BangumiLoginStart>;
    completeBangumiOAuth: (payload: import("./generated/backend").BangumiCompleteOAuthInput) => Promise<import("./backend").BangumiAuthStatus>;
    logoutBangumi: () => Promise<import("./backend").BangumiAuthStatus>;
    syncBangumiNow: () => Promise<import("./backend").BangumiSyncSummary>;
    syncBangumiSubject: (payload: import("./generated/backend").RefreshSubjectRequest) => Promise<import("./backend").BangumiSyncSummary>;
    updateBangumiCollection: (payload: import("./generated/backend").BangumiUpdateCollectionInput) => Promise<import("./backend").BangumiSyncSummary>;
    updateBangumiEpisode: (payload: import("./generated/backend").BangumiUpdateEpisodeInput) => Promise<import("./backend").BangumiSyncSummary>;
    batchUpdateBangumiEpisodes: (payload: import("./generated/backend").BangumiBatchUpdateEpisodesInput) => Promise<import("./backend").BangumiSyncSummary>;
    reportPlaybackProgress: (payload: import("./generated/backend").PlaybackProgressRequest) => Promise<import("./backend").BangumiSyncSummary>;
    testQbittorrentConnection: () => Promise<import("./backend").ConnectionTest>;
    openMedia: (mediaId: number) => Promise<{ opened: boolean }>;
    getMediaSource: (mediaId: number) => Promise<import("./backend").MediaSource>;
    danmakuTrack: (mediaId: number) => Promise<import("./backend").DanmakuTrack>;
    mpvLoad: (mediaId: number) => Promise<import("./backend").MpvState>;
    mpvSetTrack: (kind: "audio" | "subtitle", id: number | null) => Promise<import("./backend").MpvState>;
    mpvAddSubtitle: () => Promise<{ state: import("./backend").MpvState; path: string } | null>;
    mpvAddSubtitlePath: (path: string) => Promise<{ state: import("./backend").MpvState; path: string }>;
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
