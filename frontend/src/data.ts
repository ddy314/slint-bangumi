export type MatchStatus = "matched" | "tentative" | "unmatched" | "failed";

export type Subject = {
  id: string;
  mediaId?: number;
  subjectId?: number;
  title: string;
  titleCn: string;
  year: number;
  airDate: string;
  rating: number;
  rank: number;
  tags: string[];
  summary: string;
  poster: string;
  hero: string;
  status: MatchStatus;
  episodes: number;
  watchedEpisodes: number;
  currentEpisode?: number;
  progress: number;
  files: number;
  totalSize: string;
  lastPlayed?: string;
  newEpisode?: boolean;
  metadataReady?: boolean;
  fileSummary: string;
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
