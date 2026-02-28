import * as vscode from 'vscode';
import type { Identity, IdentityPreset, GitConfigOptions } from './types';

const RECENT_IDENTITIES_KEY = 'recentIdentities';

export const getExtensionConfig = (): vscode.WorkspaceConfiguration => {
  return vscode.workspace.getConfiguration('gitPersona');
};

export const isEnabled = (): boolean => {
  return getExtensionConfig().get<boolean>('enabled', true);
};

export const isStatusBarEnabled = (): boolean => {
  return getExtensionConfig().get<boolean>('statusBarEnabled', true);
};

export const isBlockUntilConfigured = (): boolean => {
  return getExtensionConfig().get<boolean>('blockUntilConfigured', false);
};

export const isAutoApplyBestMatchEnabled = (): boolean => {
  return getExtensionConfig().get<boolean>('autoApplyBestMatch', true);
};

export const getCheckIntervalMs = (): number => {
  return getExtensionConfig().get<number>('checkIntervalMs', 0);
};

export const isEmailDomainAllowed = (email: string): boolean => {
  const configured = getExtensionConfig()
    .get<string[]>('allowedDomains', [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  if (configured.length === 0 || email.trim().length === 0) {
    return true;
  }

  const emailLower = email.trim().toLowerCase();
  const atIndex = emailLower.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === emailLower.length - 1) {
    return false;
  }

  const domain = emailLower.slice(atIndex + 1);
  return configured.includes(domain);
};

export const isValidEmail = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

export const identityKey = (identity: Identity): string => {
  return `${identity.name.trim().toLowerCase()}::${identity.email.trim().toLowerCase()}`;
};

export const getIgnoredRepositories = (): string[] => {
  return getExtensionConfig()
    .get<string[]>('ignoredRepositories', [])
    .map((repoPath) => repoPath.trim())
    .filter((repoPath) => repoPath.length > 0);
};

export const setIgnoredRepositories = async (ignoredRepositories: string[]): Promise<void> => {
  const unique = Array.from(new Set(ignoredRepositories));
  await getExtensionConfig().update('ignoredRepositories', unique, vscode.ConfigurationTarget.Workspace);
};

export const getConfiguredIdentities = (): IdentityPreset[] => {
  const configured = getExtensionConfig().get<unknown[]>('identities', []);
  if (!Array.isArray(configured)) {
    return [];
  }

  const identities: IdentityPreset[] = [];
  for (const value of configured) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const candidate = value as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const email = typeof candidate.email === 'string' ? candidate.email.trim() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : undefined;
    const match = normalizeMatchValue(candidate.match);

    if (name.length === 0 || !isValidEmail(email)) {
      continue;
    }

    const options = normalizeOptions(candidate.options);
    identities.push({ name, email, label, match, ...(Object.keys(options).length > 0 ? { options } : {}) });
  }

  return identities;
};

export const setConfiguredIdentities = async (identities: IdentityPreset[]): Promise<void> => {
  await getExtensionConfig().update('identities', identities, vscode.ConfigurationTarget.Workspace);
};

export const getRecentIdentities = (): Identity[] => {
  const configured = getExtensionConfig().get<unknown[]>(RECENT_IDENTITIES_KEY, []);
  if (!Array.isArray(configured)) {
    return [];
  }

  const identities: Identity[] = [];
  for (const value of configured) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const candidate = value as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const email = typeof candidate.email === 'string' ? candidate.email.trim() : '';
    if (name.length === 0 || !isValidEmail(email)) {
      continue;
    }

    identities.push({ name, email });
  }

  return identities;
};

export const setRecentIdentities = async (identities: Identity[]): Promise<void> => {
  const maxRecent = getExtensionConfig().get<number>('maxRecentIdentities', 8);
  const sanitized = identities
    .map((identity) => ({ name: identity.name.trim(), email: identity.email.trim() }))
    .filter((identity) => identity.name.length > 0 && isValidEmail(identity.email));
  const deduped = sanitized.filter((identity, index, array) => {
    const key = identityKey(identity);
    return array.findIndex((item) => identityKey(item) === key) === index;
  });

  await getExtensionConfig().update(
    RECENT_IDENTITIES_KEY,
    deduped.slice(0, Math.max(1, maxRecent)),
    vscode.ConfigurationTarget.Workspace
  );
};

export const rememberRecentIdentity = async (identity: Identity): Promise<void> => {
  const maxRecent = getExtensionConfig().get<number>('maxRecentIdentities', 8);
  const trimmed: Identity = { name: identity.name.trim(), email: identity.email.trim() };
  const next = [trimmed, ...getRecentIdentities().filter((item) => identityKey(item) !== identityKey(trimmed))]
    .slice(0, Math.max(1, maxRecent));

  await setRecentIdentities(next);
};

const normalizeOptions = (value: unknown): GitConfigOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const options: GitConfigOptions = {};
  for (const key of Object.keys(record)) {
    const v = record[key];
    if (typeof v === 'string' && key.trim().length > 0) {
      options[key.trim()] = v.trim();
    }
  }
  return options;
};

const normalizeMatchValue = (value: unknown): string | string[] | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const matches = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return matches.length > 0 ? matches : undefined;
};
