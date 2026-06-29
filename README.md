# NexPlay

NexPlay is a desktop anime media library for local collections. It combines an
Electron + React interface with a Rust backend, SQLite storage, Bangumi metadata,
dandanplay danmaku matching, Nyaa resource discovery, qBittorrent integration,
and a local libmpv-based player path.

The project is in active early development. Core media-library, metadata,
download, and playback flows are usable, while release packaging and the native
player bridge are still being hardened across platforms.

## Features

- Local media-library indexing with recursive scans, SQLite persistence, and
  per-file watch history.
- Bangumi metadata search, automatic matching, poster/hero image caching,
  collection sync, OAuth login, rating updates, and episode status updates.
- dandanplay danmaku matching and canvas-based danmaku rendering in the player.
- Local playback through Electron with mpv/libmpv integration, WebGL rendering
  support, manual subtitle import, subtitle memory, and playback-position resume.
- Nyaa resource search with resolution/batch filters and qBittorrent task
  creation, file selection, progress polling, pause/resume/cancel, and cleanup.
- React 19 frontend with Vite, TypeScript, Tailwind CSS, Framer Motion, and
  generated TypeScript contracts from the Rust backend.
- JSON-RPC backend daemon launched by Electron; the app does not expose an HTTP
  service for normal frontend/backend communication.
- GitHub Actions release workflow for Windows, macOS, and Linux artifacts.

## Current Status

| Area | Status | Notes |
| --- | --- | --- |
| Media library scan | Usable | Scans configured directories, stores file metadata, tracks matched/unmatched subjects, and preserves watch state. |
| Bangumi metadata | Usable | Search, detail hydration, image cache, collection sync, OAuth, and episode status updates are implemented. |
| Danmaku | Usable | dandanplay matching and frontend canvas rendering are implemented; performance tuning is ongoing. |
| Local playback | Usable on development machines with mpv/libmpv | Resume position, remembered subtitles, manual subtitle import, and WebGL/mpv paths are implemented; platform packaging still needs more validation. |
| Resource search | Usable | Nyaa search and qBittorrent download task flow are implemented. |
| Release packaging | Partial | Linux/macOS packaging includes the native backend path; Windows player packaging still needs libmpv packaging work. |
| Tests/diagnostics | Partial | Backend daemon and player/danmaku diagnostic scripts exist; broader automated test coverage is still planned. |

For a more detailed milestone view, see [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Screens

NexPlay currently includes:

- Home dashboard with continue-watching and library statistics.
- Library/search views for local media and Bangumi catalog results.
- Subject detail pages with local episode mapping and Bangumi actions.
- Player view with danmaku, subtitle controls, progress persistence, and mpv
  control bridge.
- Resource search and download task pages.
- Settings pages for media folders, Bangumi, dandanplay, Nyaa, qBittorrent, and
  logging.

## Requirements

- Node.js 22 or newer.
- npm 10 or newer.
- Rust toolchain with edition 2024 support.
- Electron-supported desktop environment.
- mpv/libmpv runtime for playback features.
- `pkg-config` and libmpv development headers when building the native render
  bridge.
- Optional service credentials:
  - Bangumi OAuth client or access token for authenticated sync.
  - dandanplay credentials/API key for danmaku matching.
  - qBittorrent Web UI for download management.

## Quick Start

Install dependencies:

```bash
npm install
```

Create a local configuration from the example if needed:

```bash
cp config.example.toml config.toml
```

Start the development app:

```bash
npm run dev
```

`npm run dev` starts the Vite renderer and the Electron main process. In
development, Electron starts the Rust backend with:

```bash
cargo run --quiet -- backend-daemon
```

Open Settings in the app, add one or more media-library directories, save, and
run a scan from the library page.

## Configuration

The repository includes [config.example.toml](config.example.toml). Local
configuration belongs in `config.toml`, which is intentionally ignored by Git.

Important sections:

- `media_libraries`: directories to scan.
- `database.path`: SQLite database location.
- `bangumi`: metadata, OAuth, token, image cache, and matching options.
- `dandanplay`: danmaku matching credentials.
- `nyaa`: resource-search provider settings.
- `qbittorrent`: Web UI connection and download defaults.
- `logging`: backend log level.

Packaged builds store production configuration under Electron's userData
directory instead of the installation directory.

## Development Commands

```bash
npm run dev                    # Vite + Electron development mode
npm run generate:types         # regenerate frontend TypeScript API contracts
npm run test:backend-daemon    # smoke-test the Rust backend daemon protocol
npm run build:native-render    # build the optional mpv native render bridge
npm run diagnose:player        # inspect player/mpv bridge behavior
npm run diagnose:danmaku       # inspect danmaku timing/render behavior
npm run build                  # type-check and build the renderer
npm run build:backend          # release-build the Rust backend
npm run package                # build unpacked Electron app for current OS
npm run dist                   # build distributable artifacts for current OS
```

The frontend API types in `frontend/src/generated/backend.ts` are generated from
Rust types. Run `npm run generate:types` after changing backend request/response
contracts.

## Build And Release

Build the renderer and run Electron in production renderer mode:

```bash
npm run build
npm start
```

Build the current platform package:

```bash
npm run dist
```

The release build performs:

1. `tsc --noEmit && vite build`
2. `cargo build --release`
3. `node scripts/build-native-render.cjs`
4. `node scripts/prepare-release-assets.cjs`
5. `electron-builder`

Artifacts are written to `release/`.

Pushing a `v*` tag triggers the GitHub Actions release workflow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Expected artifact families:

- Windows: NSIS installer (`.exe`)
- macOS: `.dmg` and `.zip`
- Linux: `.AppImage`, `.deb`, and `.tar.gz`

## Architecture

```text
React/Vite renderer
  -> Electron preload IPC
  -> Electron main process
  -> Rust JSON-RPC backend daemon
  -> SQLite, filesystem scan, Bangumi, dandanplay, Nyaa, qBittorrent

Player UI
  -> Electron player control bridge
  -> mpv/libmpv and optional native render bridge
```

Main directories:

- `frontend/src/`: React renderer source.
- `electron/`: Electron main process, preload, backend RPC client, asset
  protocol, player control, and render bridge.
- `src/`: Rust backend, domain model, repository, services, metadata providers,
  backend daemon, and generated API contract types.
- `native/mpv-render-bridge/`: optional native libmpv render bridge.
- `scripts/`: release preparation and diagnostics.
- `.github/workflows/release.yml`: multi-platform release workflow.

The old Slint frontend is no longer the app entrypoint.

## Contributing

Contributions are welcome while the project is stabilizing. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

For security-sensitive reports, use [SECURITY.md](SECURITY.md).

## License

NexPlay is licensed under the MIT License. See [LICENSE](LICENSE).
