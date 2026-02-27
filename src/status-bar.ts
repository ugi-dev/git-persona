import * as path from 'node:path';
import * as vscode from 'vscode';
import { getRepoStatus, getActiveRepository } from './repositories';
import { isEnabled, isStatusBarEnabled } from './settings';

export const updateStatusBar = async (statusBarItem: vscode.StatusBarItem): Promise<void> => {
  if (!isEnabled() || !isStatusBarEnabled()) {
    statusBarItem.hide();
    return;
  }

  const repo = await getActiveRepository();
  if (!repo) {
    statusBarItem.hide();
    return;
  }

  const status = await getRepoStatus(repo);
  if (status.ignored) {
    statusBarItem.text = `$(circle-slash) Git Persona: ignored (${path.basename(repo)})`;
    statusBarItem.tooltip = `Git Persona is ignoring ${repo}`;
    statusBarItem.command = 'gitPersona.toggleRepositoryIgnore';
    statusBarItem.show();
    return;
  }

  statusBarItem.command = 'gitPersona.configureRepoIdentity';

  if (status.missing.length > 0) {
    statusBarItem.text = `$(warning) Git Persona: missing (${path.basename(repo)})`;
    statusBarItem.tooltip = `Missing: ${status.missing.map((field) => `user.${field}`).join(', ')}`;
    statusBarItem.command = 'gitPersona.fixActiveRepository';
    statusBarItem.show();
    return;
  }

  if (!status.validDomain) {
    statusBarItem.text = '$(alert) Git Persona: domain mismatch';
    statusBarItem.tooltip = `${status.identity.email} is outside gitPersona.allowedDomains`;
    statusBarItem.command = 'gitPersona.fixActiveRepository';
    statusBarItem.show();
    return;
  }

  statusBarItem.text = `$(git-commit) ${status.identity.email}`;
  statusBarItem.tooltip = `${status.identity.name} <${status.identity.email}>`;
  statusBarItem.show();
};
