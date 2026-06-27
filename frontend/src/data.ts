import type {
  FrontendEpisode,
  FrontendLocalFile,
  FrontendMatchStatus,
  FrontendSubject,
} from "./generated/backend";

export type MatchStatus = FrontendMatchStatus;
export type Subject = FrontendSubject;
export type LocalFile = FrontendLocalFile;
export type EpisodeDetail = FrontendEpisode;

export type PlaybackEpisode = {
  key: string;
  episode: number;
  title: string;
  titleCn: string;
  airDate: string;
  cached: boolean;
  watched: boolean;
  bgmEpisodeId?: number;
  bgmCollectionType?: number;
  bgmCollectionLabel: string;
  bgmPending: boolean;
  mediaId?: number;
  fileName?: string;
  fileSize?: string;
};

export const STATUS_LABEL: Record<MatchStatus, string> = {
  matched: "已匹配",
  tentative: "待确认",
  unmatched: "未匹配",
  failed: "失败",
};

export const STATUS_COLOR: Record<MatchStatus, string> = {
  matched: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  tentative: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  unmatched: "bg-zinc-400/15 text-zinc-300 ring-zinc-300/30",
  failed: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
};

export type Episode = {
  index: number;
  title: string;
  duration: string;
  watched: boolean;
  airDate: string;
};

export function makeEpisodes(subject: Subject): Episode[] {
  const total = subject.episodes || subject.files || 0;
  return Array.from({ length: total }, (_, index) => ({
    index: index + 1,
    title: `Episode ${index + 1}`,
    duration: "",
    watched: index + 1 <= subject.watchedEpisodes,
    airDate: "",
  }));
}

export function makePlaybackEpisodes(subject: Subject): PlaybackEpisode[] {
  if (subject.episodesDetail?.length) {
    const rows: PlaybackEpisode[] = subject.episodesDetail.map((episode) => ({
      key: String(episode.mediaId || `episode-${episode.episode}`),
      episode: episode.episode,
      title: episode.title,
      titleCn: episode.titleCn,
      airDate: episode.airDate,
      cached: episode.cached,
      watched: episode.bgmCollectionType === 2 || (episode.cached && episode.episode <= subject.watchedEpisodes),
      bgmEpisodeId: episode.bgmEpisodeId,
      bgmCollectionType: episode.bgmCollectionType,
      bgmCollectionLabel: episode.bgmCollectionLabel,
      bgmPending: episode.bgmPending,
      mediaId: episode.mediaId,
      fileName: episode.fileName,
      fileSize: episode.fileSize,
    }));
    const localFiles = subject.localFiles ?? [];
    if (!localFiles.length) {
      return rows;
    }

    const usedMediaIds = new Set(rows.flatMap((row) => row.mediaId ? [row.mediaId] : []));
    const remainingFiles = localFiles.filter((file) => !usedMediaIds.has(file.mediaId));

    for (const row of rows) {
      if (row.mediaId) continue;
      const matchIndex = remainingFiles.findIndex((file) => file.episode === row.episode);
      if (matchIndex < 0) continue;
      const [file] = remainingFiles.splice(matchIndex, 1);
      attachLocalFile(row, file);
    }

    if (rows.length === 1 && !rows[0].mediaId && remainingFiles.length === 1) {
      attachLocalFile(rows[0], remainingFiles.shift()!);
    }

    rows.push(...remainingFiles.map((file, index) => playbackEpisodeFromLocalFile(
      file,
      rows.length + index,
      (file.episode || rows.length + index + 1) <= subject.watchedEpisodes,
    )));
    return rows;
  }

  if (subject.localFiles?.length) {
    return subject.localFiles.map((file, index) => playbackEpisodeFromLocalFile(
      file,
      index,
      (file.episode || index + 1) <= subject.watchedEpisodes,
    ));
  }

  return Array.from({ length: subject.episodes || subject.files }, (_, index) => ({
    key: `${subject.id}-${index}`,
    episode: index + 1,
    title: `Episode ${index + 1}`,
    titleCn: "",
    airDate: "",
    cached: false,
    watched: index + 1 <= subject.watchedEpisodes,
    bgmCollectionLabel: "未标记",
    bgmPending: false,
  }));
}

function attachLocalFile(row: PlaybackEpisode, file: FrontendLocalFile) {
  row.key = String(file.mediaId || row.key);
  row.cached = true;
  row.mediaId = file.mediaId;
  row.fileName = file.fileName;
  row.fileSize = file.fileSize;
}

function playbackEpisodeFromLocalFile(file: FrontendLocalFile, index: number, watched = false): PlaybackEpisode {
  const episode = file.episode || index + 1;
  return {
    key: String(file.mediaId || `${file.fileName}-${index}`),
    episode,
    title: `Episode ${episode}`,
    titleCn: "",
    airDate: "",
    cached: true,
    watched,
    bgmCollectionLabel: "未标记",
    bgmPending: false,
    mediaId: file.mediaId,
    fileName: file.fileName,
    fileSize: file.fileSize,
  };
}
