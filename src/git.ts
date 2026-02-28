import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Identity, GitConfigOptions } from './types';
import { rememberRecentIdentity } from './settings';

const execFileAsync = promisify(execFile);

export const runGit = async (args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync('git', args, { cwd });
};

export const findRepoRoot = async (cwd: string): Promise<string | undefined> => {
  try {
    const { stdout } = await runGit(['rev-parse', '--show-toplevel'], cwd);
    const repoPath = stdout.trim();
    return repoPath.length > 0 ? repoPath : undefined;
  } catch {
    return undefined;
  }
};

export const readLocalGitValue = async (repoPath: string, key: 'user.name' | 'user.email'): Promise<string> => {
  try {
    const { stdout } = await runGit(['config', '--local', '--get', key], repoPath);
    return stdout.trim();
  } catch {
    return '';
  }
};

export const getRepoIdentity = async (repoPath: string): Promise<Identity> => {
  const [name, email] = await Promise.all([
    readLocalGitValue(repoPath, 'user.name'),
    readLocalGitValue(repoPath, 'user.email')
  ]);

  return { name, email };
};

export const getMissingFields = (identity: Identity): Array<'name' | 'email'> => {
  const missing: Array<'name' | 'email'> = [];
  if (identity.name.trim().length === 0) {
    missing.push('name');
  }
  if (identity.email.trim().length === 0) {
    missing.push('email');
  }
  return missing;
};

export const setRepoIdentity = async (
  repoPath: string,
  identity: Identity,
  options?: GitConfigOptions
): Promise<void> => {
  await runGit(['config', '--local', 'user.name', identity.name], repoPath);
  await runGit(['config', '--local', 'user.email', identity.email], repoPath);
  if (options && Object.keys(options).length > 0) {
    for (const [key, value] of Object.entries(options)) {
      await runGit(['config', '--local', key, value], repoPath);
    }
  }
  await rememberRecentIdentity(identity);
};

export const getRemoteUrls = async (repoPath: string): Promise<string[]> => {
  try {
    const { stdout } = await runGit(['remote', '-v'], repoPath);
    const urls = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/)[1] ?? '')
      .filter((url) => url.length > 0);

    return Array.from(new Set(urls));
  } catch {
    return [];
  }
};
