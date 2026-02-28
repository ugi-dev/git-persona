<img src="/cover.png" alt="cover_image"/>
# Git Persona

Enforce per-repo git `user.name` and `user.email` before you work—no more committing with the wrong identity.

<a href="https://marketplace.visualstudio.com/items?itemName=ugi-dev.git-persona"><strong>Install from Marketplace →</strong></a>

## How it works

When you open a workspace, Git Persona checks each repository for a local git identity. If it’s missing or doesn’t match your rules (e.g. allowed domains), it can:

- **Auto-apply** the best-matching identity preset, or
- **Prompt you** to pick an identity (preset, recent, or one-time).

Identities are stored in the repo’s local git config, so each folder can have a different persona.

## Quick start

1. **Add identity presets** in settings (`Git Persona: Open Workspace Identity Settings` or `settings.json`):

```json
{
  "gitPersona.identities": [
    {
      "label": "Work",
      "name": "Jane Dev",
      "email": "jane@company.com",
      "match": ["github.com/my-org", "/work/"]
    },
    {
      "label": "Personal",
      "name": "Jane",
      "email": "jane@gmail.com",
      "match": ["github.com/jane", "/personal/"]
    }
  ]
}
```

2. **Match (optional)**  
   `match` is a string or list of strings. If any string appears in the repo path, repo name, or remote URLs, that preset can be auto-selected. Leave it out to still show the preset in the picker without auto-matching.

3. When you open a repo, Git Persona will:
   - Auto-apply the best-matching preset if **Auto-apply best match** is on (default), or
   - Show a prompt to choose an identity.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), then type for example **Git Persona: Configure Repository Identity** to pick a repo and set its identity.

| Command | Description |
|--------|-------------|
| **Git Persona: Configure Repository Identity** | Pick a repo and set its local identity (preset, recent, or one-time). |
| **Git Persona: Fix Active Repository Identity** | Run the identity flow for the repo of the currently active file. |
| **Git Persona: Toggle Ignore Repository** | Add or remove a repo from the ignore list so it’s no longer checked. |
| **Git Persona: Open Workspace Identity Settings** | Open VS Code settings filtered to Git Persona. |

## Status bar

When **Show status in status bar** is enabled, the current repository’s identity (name &lt;email&gt;) is shown in the left status bar. Click it to configure that repo’s identity.

## Settings

| Setting | Default | Description |
|--------|---------|-------------|
| `gitPersona.enabled` | `true` | Run identity checks when opening repositories. |
| `gitPersona.autoApplyBestMatch` | `true` | Auto-apply the best-matching preset when identity is missing or invalid. |
| `gitPersona.blockUntilConfigured` | `false` | If enabled, keep prompting until an identity is set for each repo. |
| `gitPersona.statusBarEnabled` | `true` | Show current repo identity in the status bar. |
| `gitPersona.checkIntervalMs` | `0` | Re-check identities every N ms; `0` = only on open/focus/config change. |
| `gitPersona.allowedDomains` | `[]` | Email domain allow-list (e.g. `["company.com"]`). Empty = any domain. |
| `gitPersona.ignoredRepositories` | `[]` | Absolute paths of repos to skip. Use **Toggle Ignore Repository** to manage. |
| `gitPersona.maxRecentIdentities` | `8` | How many recently used identities to keep in the picker. |

Presets in `gitPersona.identities` can also include **options**: extra local git config keys (e.g. `commit.gpgsign`, `user.signingkey`) applied when that identity is set.

## Ignore vs skip

- **Ignore**: Repo is added to `gitPersona.ignoredRepositories` and won’t be checked again until you un-ignore it.
- **Skip for this session**: Repo is skipped until you reload the window or reopen the workspace.

## License

MIT — see [LICENSE](LICENSE).
