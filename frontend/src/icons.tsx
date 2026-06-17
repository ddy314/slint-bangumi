import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const I = (path: React.ReactNode) =>
  function Icon(p: SVGProps<SVGSVGElement>) {
    return (
      <svg {...base} {...p}>
        {path}
      </svg>
    );
  };

export const HomeIcon = I(
  <>
    <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </>
);

export const LibraryIcon = I(
  <>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="16" rx="1.5" />
    <path d="M18 4l3 .8-3 14.4-3-.8z" />
  </>
);

export const SettingsIcon = I(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
);

export const PlayIcon = I(<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />);
export const PauseIcon = I(
  <>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </>
);
export const PlusIcon = I(
  <>
    <path d="M12 5v14M5 12h14" />
  </>
);
export const SearchIcon = I(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>
);
export const ChevronRight = I(<path d="M9 6l6 6-6 6" />);
export const ChevronLeft = I(<path d="M15 6l-6 6 6 6" />);
export const ChevronDown = I(<path d="M6 9l6 6 6-6" />);
export const MoreIcon = I(
  <>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </>
);
export const GridIcon = I(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>
);
export const ListIcon = I(
  <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </>
);
export const FolderPlus = I(
  <>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v6M9 14h6" />
  </>
);
export const ScanIcon = I(
  <>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="M4 12h16" />
  </>
);
export const RefreshIcon = I(
  <>
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </>
);
export const StarIcon = I(
  <path d="M12 3l2.6 6 6.4.6-4.9 4.4 1.5 6.4L12 17l-5.6 3.4 1.5-6.4L3 9.6 9.4 9z" fill="currentColor" stroke="none" />
);
export const CheckIcon = I(<path d="M5 12l4 4 10-10" />);
export const CloseIcon = I(<path d="M6 6l12 12M18 6L6 18" />);
export const ArrowLeft = I(
  <>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </>
);
export const SortIcon = I(
  <>
    <path d="M4 6h16M6 12h12M9 18h6" />
  </>
);
export const QueueIcon = I(
  <>
    <path d="M3 6h13M3 12h13M3 18h9" />
    <path d="M19 6v12M22 9l-3-3-3 3" />
  </>
);
export const DanmakuIcon = I(
  <>
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <path d="M6 10h6M8 14h4M16 12h2" />
  </>
);
export const SparkleIcon = I(
  <>
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" fill="currentColor" stroke="none" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" stroke="none" />
  </>
);
export const FileIcon = I(
  <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>
);
export const CollapseIcon = I(
  <>
    <path d="M9 6l-6 6 6 6" />
    <path d="M21 6v12" />
  </>
);
export const ExpandIcon = I(
  <>
    <path d="M15 6l6 6-6 6" />
    <path d="M3 6v12" />
  </>
);
export const FilterIcon = I(
  <>
    <path d="M4 5h16l-6 8v6l-4-2v-4z" />
  </>
);
export const DownloadIcon = I(
  <>
    <path d="M12 4v12M6 12l6 6 6-6" />
    <path d="M4 20h16" />
  </>
);
export const KeyIcon = I(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3M14 9l3 3" />
  </>
);
export const InfoIcon = I(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>
);
export const BellIcon = I(
  <>
    <path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </>
);
