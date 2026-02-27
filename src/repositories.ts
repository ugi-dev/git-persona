import * as path from 'node:path';
import * as vscode from 'vscode';
import { findRepoRoot, getMissingFields, getRepoIdentity } from './git';
import { getIgnoredRepositories, isEmailDomainAllowed } from './settings';
import type { RepoStatus } from './types';

export const getWorkspaceRepositories = async (): Promise<string[]> => {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [];
  }

  const roots = folders.map((folder) => folder.uri.fsPath);
  const discovered = await Promise.all(roots.map(async (root) => findRepoRoot(root)));
  const unique = new Set(discovered.filter((repo): repo is string => Boolean(repo)));
  return Array.from(unique);
};

export const pickRepository = async (repos: string[], placeholder: string): Promise<string | undefined> => {
  const selected = await vscode.window.showQuickPick(
    repos.map((repo) => ({
      label: path.basename(repo),
      description: repo,
      repo
    })),
    { placeHolder: placeholder }
  );

  return selected?.repo;
};

export const getRepoStatus = async (repoPath: string): Promise<RepoStatus> => {
  const identity = await getRepoIdentity(repoPath);
  const missing = getMissingFields(identity);
  const validDomain = isEmailDomainAllowed(identity.email);
  const ignored = getIgnoredRepositories().includes(repoPath);

  return { repoPath, identity, missing, validDomain, ignored };
};

export const getActiveRepository = async (): Promise<string | undefined> => {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      const activeRepo = await findRepoRoot(folder.uri.fsPath);
      if (activeRepo) {
        return activeRepo;
      }
    }
  }

  const repos = await getWorkspaceRepositories();
  return repos[0];
};
