const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { protocol } = require("electron");

function registerAssetProtocol({ getAllowedRoots = () => [] } = {}) {
  protocol.handle("nexplay-asset", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "local") {
      return new Response("unsupported asset host", { status: 400 });
    }

    const filePath = path.resolve(decodeURIComponent(url.pathname.slice(1)));
    if (!isAllowedAssetPath(filePath, getAllowedRoots())) {
      return new Response("asset path is not allowed", { status: 403 });
    }
    return streamLocalFile(filePath, request);
  });
}

function isAllowedAssetPath(filePath, roots) {
  const resolvedFilePath = path.resolve(filePath);
  return normalizeRoots(roots).some((root) => (
    resolvedFilePath === root || resolvedFilePath.startsWith(`${root}${path.sep}`)
  ));
}

function normalizeRoots(roots) {
  const seen = new Set();
  const normalized = [];
  for (const root of roots) {
    if (typeof root !== "string" || !root.trim()) {
      continue;
    }
    const resolved = path.resolve(root);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    normalized.push(resolved);
  }
  return normalized;
}

function streamLocalFile(filePath, request) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response("asset not found", { status: 404 });
  }

  if (!stat.isFile()) {
    return new Response("asset is not a file", { status: 404 });
  }

  const range = request.headers.get("range");
  const contentType = contentTypeForPath(filePath);
  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new Response("invalid range", {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${stat.size}`,
        },
      });
    }

    const parsed = parseByteRange(match, stat.size);
    if (!parsed) {
      return new Response("range not satisfiable", {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${stat.size}`,
        },
      });
    }

    const { start, end } = parsed;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      return new Response("range not satisfiable", {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${stat.size}`,
        },
      });
    }

    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(stat.size),
    },
  });
}

function parseByteRange(match, size) {
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) {
    return null;
  }
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0 || size <= 0) {
      return null;
    }
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  return { start, end };
}

function contentTypeForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "application/octet-stream";
  }
}

module.exports = {
  registerAssetProtocol,
};
