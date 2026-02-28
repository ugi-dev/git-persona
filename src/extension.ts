import * as path from 'node:path';
import * as vscode from 'vscode';
import { setRepoIdentity } from './git';
import { collectIdentityInputs, findBestPresetMatch } from './identity-picker';
import { getActiveRepository, getRepoStatus, getWorkspaceRepositories, pickRepository } from './repositories';
import {
  getCheckIntervalMs,
  getIgnoredRepositories,
  isAutoApplyBestMatchEnabled,
  isBlockUntilConfigured,
  isEnabled,
  setIgnoredRepositories
} from './settings';
import { updateStatusBar } from './status-bar';
import type { IdentityPreset, RepoStatus } from './types';

const SESSION_SKIP_KEY = 'gitPersona.session.skippedRepos';

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusBarItem.command = 'gitPersona.configureRepoIdentity';
  context.subscriptions.push(statusBarItem);

  const configureCommand = vscode.commands.registerCommand(
    'gitPersona.configureRepoIdentity',
    async () => {
      const repos = await getWorkspaceRepositories();
      if (repos.length === 0) {
        void vscode.window.showInformationMessage('Git Persona: no git repositories were found in this workspace.');
        return;
      }

      const selected = await pickRepository(repos, 'Choose a repository to configure git identity');
      if (!selected) {
        return;
      }

      await promptAndApplyIdentity(context, selected, true);
      await updateStatusBar(statusBarItem);
    }
  );

  const openSettingsCommand = vscode.commands.registerCommand(
    'gitPersona.openRepoSettings',
    async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ugi-dev.git-persona gitPersona');
    }
  );

  const toggleIgnoreCommand = vscode.commands.registerCommand(
    'gitPersona.toggleRepositoryIgnore',
    async () => {
      const repos = await getWorkspaceRepositories();
      if (repos.length === 0) {
        void vscode.window.showInformationMessage('Git Persona: no git repositories were found in this workspace.');
        return;
      }

      const selected = await pickRepository(repos, 'Choose a repository to ignore/unignore');
      if (!selected) {
        return;
      }

      const ignored = new Set(getIgnoredRepositories());
      if (ignored.has(selected)) {
        ignored.delete(selected);
        void vscode.window.showInformationMessage(`Git Persona: re-enabled checks for ${path.basename(selected)}.`);
      } else {
        ignored.add(selected);
        void vscode.window.showInformationMessage(`Git Persona: ignoring ${path.basename(selected)}.`);
      }

      await setIgnoredRepositories(Array.from(ignored));
      await updateStatusBar(statusBarItem);
    }
  );

  const fixActiveRepoCommand = vscode.commands.registerCommand(
    'gitPersona.fixActiveRepository',
    async () => {
      const repo = await getActiveRepository();
      if (!repo) {
        void vscode.window.showInformationMessage('Git Persona: no active git repository found.');
        return;
      }

      await promptAndApplyIdentity(context, repo, true);
      await updateStatusBar(statusBarItem);
    }
  );

  context.subscriptions.push(configureCommand, openSettingsCommand, toggleIgnoreCommand, fixActiveRepoCommand);

  let checkInterval: NodeJS.Timeout | undefined;
  const restartPeriodicChecks = (): void => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = undefined;
    }

    const intervalMs = getCheckIntervalMs();
    if (intervalMs <= 0) {
      return;
    }

    checkInterval = setInterval(() => {
      void validateWorkspaceRepositories(context).then(async () => {
        await updateStatusBar(statusBarItem);
      });
    }, intervalMs);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async () => {
      await updateStatusBar(statusBarItem);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await validateWorkspaceRepositories(context);
      await updateStatusBar(statusBarItem);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('gitPersona')) {
        return;
      }

      await validateWorkspaceRepositories(context);
      restartPeriodicChecks();
      await updateStatusBar(statusBarItem);
    }),
    {
      dispose: () => {
        if (checkInterval) {
          clearInterval(checkInterval);
        }
      }
    }
  );

  await validateWorkspaceRepositories(context);
  restartPeriodicChecks();
  await updateStatusBar(statusBarItem);
};

export const deactivate = (): void => {
  // No-op.
};

const validateWorkspaceRepositories = async (context: vscode.ExtensionContext): Promise<void> => {
  if (!isEnabled()) {
    return;
  }

  const repos = await getWorkspaceRepositories();
  if (repos.length === 0) {
    return;
  }

  const skippedForSession = new Set(context.workspaceState.get<string[]>(SESSION_SKIP_KEY, []));
  const ignoredRepos = new Set(getIgnoredRepositories());

  for (const repo of repos) {
    if (skippedForSession.has(repo) || ignoredRepos.has(repo)) {
      continue;
    }

    const status = await getRepoStatus(repo);
    if (status.missing.length === 0 && status.validDomain) {
      continue;
    }

    const autoApplied = await tryAutoApplyIdentity(repo, status);
    if (autoApplied) {
      continue;
    }

    const configured = await promptAndApplyIdentity(context, repo, false);
    if (!configured && isBlockUntilConfigured()) {
      return validateWorkspaceRepositories(context);
    }
  }
};

const promptAndApplyIdentity = async (
  context: vscode.ExtensionContext,
  repoPath: string,
  isManualTrigger: boolean
): Promise<boolean> => {
  const status = await getRepoStatus(repoPath);
  const repoName = path.basename(repoPath);
  const isConfigured = status.missing.length === 0 && status.validDomain;

  if (isConfigured && !isManualTrigger) {
    return true;
  }

  if (!isConfigured) {
    if (!status.validDomain && status.identity.email) {
      void vscode.window.showWarningMessage(
        `Git Persona: ${repoName} uses ${status.identity.email}, which is outside gitPersona.allowedDomains.`
      );
    }

    const choices: vscode.MessageItem[] = [
      { title: 'Configure now' },
      { title: 'Choose another repo' },
      { title: 'Skip for this session' },
      { title: 'Ignore this repository' }
    ];

    const detail = status.missing.length > 0
      ? `Missing: ${status.missing.map((field) => `user.${field}`).join(', ')}`
      : 'Identity configured, but email domain does not match allowed domains.';

    const action = await vscode.window.showWarningMessage(
      `Git Persona: ${repoName} needs a local git identity. ${detail}`,
      ...choices
    );

    if (!action) {
      return false;
    }

    if (action.title === 'Choose another repo') {
      const repos = await getWorkspaceRepositories();
      const selected = await pickRepository(repos, 'Choose a repository to configure git identity');
      if (!selected) {
        return false;
      }

      return promptAndApplyIdentity(context, selected, true);
    }

    if (action.title === 'Skip for this session') {
      const skipped = context.workspaceState.get<string[]>(SESSION_SKIP_KEY, []);
      if (!skipped.includes(repoPath)) {
        await context.workspaceState.update(SESSION_SKIP_KEY, [...skipped, repoPath]);
      }
      return false;
    }

    if (action.title === 'Ignore this repository') {
      const ignored = new Set(getIgnoredRepositories());
      ignored.add(repoPath);
      await setIgnoredRepositories(Array.from(ignored));
      return false;
    }
  }

  const nextIdentity = await collectIdentityInputs(status.identity, repoPath);
  if (!nextIdentity) {
    return isConfigured;
  }

  const options = (nextIdentity as IdentityPreset).options;
  const isSameIdentity =
    status.identity.name.trim() === nextIdentity.name.trim() &&
    status.identity.email.trim().toLowerCase() === nextIdentity.email.trim().toLowerCase();

  const hasOptions = Boolean(options && Object.keys(options).length > 0);
  if (!isSameIdentity || hasOptions) {
    await setRepoIdentity(repoPath, nextIdentity, options);
  }

  const savedStatus = await getRepoStatus(repoPath);
  const actionLabel = isSameIdentity ? 'identity selected' : 'identity saved';
  void vscode.window.showInformationMessage(
    `Git Persona: ${actionLabel} for ${repoName}: ${savedStatus.identity.name} <${savedStatus.identity.email}>.`
  );
  return true;
};

const tryAutoApplyIdentity = async (repoPath: string, status: RepoStatus): Promise<boolean> => {
  if (!isAutoApplyBestMatchEnabled()) {
    return false;
  }

  const preset = await findBestPresetMatch(repoPath);
  if (!preset) {
    return false;
  }

  const isSame =
    status.identity.name.trim() === preset.name &&
    status.identity.email.trim().toLowerCase() === preset.email.toLowerCase();
  if (isSame) {
    return true;
  }

  await setRepoIdentity(repoPath, preset, preset.options);
  const label = preset.label?.trim() || `${preset.name} <${preset.email}>`;
  void vscode.window.showInformationMessage(
    `Git Persona: auto-applied ${label} to ${path.basename(repoPath)}.`
  );
  return true;
};
