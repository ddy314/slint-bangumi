# Project Status

NexPlay is currently an alpha-stage desktop app. The core direction is set:
Electron owns the desktop shell and player surface, React owns the interface,
and Rust owns local data, provider integration, and long-running backend work.

## Completed Or Usable

- Electron + React + Vite app shell with route-level pages for home, library,
  search, detail, resources, downloads, player, profile, and settings.
- Rust backend daemon connected through Electron IPC/JSON-RPC.
- SQLite-backed library scan, subject grouping, local file tracking, and watch
  progress persistence.
- Bangumi metadata integration, search, detail hydration, image caching,
  collection sync, OAuth login flow, rating updates, and episode watched-state
  updates.
- dandanplay danmaku matching and frontend danmaku overlay rendering.
- Local player page with mpv/libmpv control path, WebGL surface support,
  playback resume, subtitle import, and remembered subtitle paths.
- Nyaa resource search plus qBittorrent task creation, file picking, progress
  polling, and task controls.
- Generated TypeScript contracts from Rust backend types.
- Release workflow and electron-builder configuration for Windows, macOS, and
  Linux.
- Diagnostic scripts for backend daemon, player, and danmaku flows.

## In Progress

- Cross-platform hardening of the native mpv render bridge.
- Windows release packaging for the full player backend and libmpv dependency
  chain.
- More reliable metadata and danmaku fallback behavior when external providers
  are unavailable.
- Broader automated coverage for frontend behavior and backend service flows.
- UI polish for large libraries, long episode lists, and download-heavy
  workflows.

## Planned

- First tagged alpha release with documented platform support.
- More complete onboarding for first-run configuration.
- Import/export or backup tooling for local settings and watch history.
- Better provider health reporting and retry controls.
- Expanded diagnostics for playback, native bridge, and provider sync failures.
- Contributor-friendly issue templates and development fixtures.

## Known Limitations

- The application depends on third-party services for metadata, danmaku, torrent
  search, and download management. Those features require network access and may
  be affected by provider availability or credentials.
- Playback features require a working mpv/libmpv installation. The native bridge
  build also requires platform-specific libmpv development files.
- The project is not yet API-stable. Backend contract changes should be followed
  by `npm run generate:types`.
- Release packaging has not reached the same confidence level on all platforms.
