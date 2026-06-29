# Security Policy

NexPlay is an early-stage local desktop application. Security reports are still
welcome, especially for issues that could expose local files, credentials,
tokens, media-library metadata, or download-manager access.

## Reporting A Vulnerability

Please open a private security advisory on GitHub if available for the
repository. If that is not available, contact the maintainer through the
repository owner profile and avoid posting exploitable details publicly until
there is a fix or mitigation.

## Sensitive Data

Do not include these values in issues, logs, pull requests, or screenshots:

- Bangumi access tokens, OAuth client secrets, or authorization codes.
- dandanplay credentials or API keys.
- qBittorrent usernames, passwords, cookies, or Web UI URLs exposed to a wider
  network.
- Local media-library paths when they reveal private information.
- SQLite databases, cached provider responses, or generated config files.

Local secrets belong in `config.toml` or the packaged app's userData
configuration, not in tracked files.
