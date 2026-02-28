# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Nothing yet.

## [1.0.1] – 2025-02-28

### Added

- **Marketplace icon**: Extension icon declared in manifest so it appears on the Visual Studio Marketplace.
- **Keywords**: Added `keywords` in `package.json` for better discovery (git, identity, commit, author, per-repo, etc.).

### Changed

- **Description**: Tagline updated to “A VS Code extension that lets you customize your commit identity per repository.”

## [0.0.2] – 2025-02-28

### Fixed

- **Marketplace publish**: Use category `SCM Providers` instead of deprecated `SCM` so the extension can be published to the Visual Studio Marketplace.

## [0.0.1] – 2025-02-28 – Initial release

### Added

- **Per-repo git identity enforcement**: Prompt or auto-apply local `user.name` and `user.email` so you don’t commit with the wrong identity.
- **Identity presets**: Configure reusable identities in `gitPersona.identities` with optional match patterns for auto-apply.
- **Recent identities**: Recently used identities are remembered and offered in the picker.
- **Git config options**: Presets and one-time identities can set arbitrary local git config keys (e.g. `commit.gpgsign`, `user.signingkey`) via options.
- **Allowed domains**: Restrict which email domains are considered valid with `gitPersona.allowedDomains`.
- **Auto-apply best match**: When enabled, automatically apply the best-matching preset for the current repo (by path, basename, or remote URLs).
- **Ignore / skip**: Ignore specific repositories globally or skip validation for the session.
- **Status bar**: Show current repo identity; click to configure.
- **Commands**: Configure repo identity, fix active repository, toggle repository ignore, open extension settings.

### Changed

- **Identity validation**: When the current repo identity already matches the best preset, auto-apply now returns immediately without re-applying. This avoids repeated config writes, notification spam, and a feedback loop when the email domain is not in `allowedDomains`.
- **Identity picker**: Improved type definitions, constants, and helpers; clearer handling of button states (edit/delete) and recent identities.
- **Identity selection**: Streamlined selection logic, better error handling, and user notifications when saving or updating identities.
- **setRepoIdentity**: Accepts optional Git config options and passes them through to local git config.

### Fixed

- **editPresetIdentity**: Handles undefined inputs safely.
- **Quick pick**: Re-displays correctly when no target is found during identity selection.

[Unreleased]: https://github.com/ugi-dev/git-persona/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ugi-dev/git-persona/releases/tag/v1.0.0
[0.0.2]: https://github.com/ugi-dev/git-persona/releases/tag/v0.0.2
[0.0.1]: https://github.com/ugi-dev/git-persona/releases/tag/v0.0.1
