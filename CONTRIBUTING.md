# Contributing

Thanks for taking the time to improve NexPlay. The project is still early, so
small, focused changes are preferred over broad rewrites.

## Development Setup

```bash
npm install
cp config.example.toml config.toml
npm run dev
```

Add local media folders from the app settings page before testing library and
playback behavior.

## Before Opening A Pull Request

Run the checks that match the area you changed:

```bash
npm run build
cargo check
npm run test:backend-daemon
```

For player or danmaku changes, also run the relevant diagnostics when possible:

```bash
npm run diagnose:player
npm run diagnose:danmaku
```

If backend request/response types changed, regenerate frontend contracts:

```bash
npm run generate:types
```

## Code Guidelines

- Keep frontend/backend contracts generated from Rust types.
- Prefer Electron IPC and the Rust backend daemon over adding local HTTP
  services.
- Keep user configuration, API tokens, databases, and media-library data out of
  Git.
- Preserve existing playback behavior unless a change explicitly targets that
  behavior.
- Add diagnostics or tests when changing shared backend services, generated
  contracts, or playback state handling.

## Pull Request Notes

Please include:

- What changed and why.
- Which platforms were tested.
- Which commands were run.
- Any provider credentials or local services required to reproduce the behavior,
  without including secret values.
