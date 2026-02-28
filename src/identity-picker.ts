import * as path from 'node:path';
import * as vscode from 'vscode';
import { getRemoteUrls } from './git';
import {
  getConfiguredIdentities,
  getRecentIdentities,
  identityKey,
  isValidEmail,
  setConfiguredIdentities,
  setRecentIdentities
} from './settings';
import type { GitConfigOptions, Identity, IdentityPreset } from './types';

// --- Module-level types ---

type IdentityPickItem = vscode.QuickPickItem & {
  preset?: IdentityPreset;
  custom?: boolean;
  addPreset?: boolean;
  presetIndex?: number;
  recentIndex?: number;
  isCurrentConfigured?: boolean;
};

// --- Module-level constants ---

const CURRENTLY_CONFIGURED_DETAIL = 'Currently configured for this repository';
const DUPLICATE_IDENTITY_WARNING = 'Git Persona: an identity with that name/email already exists.';
const EMPTY_IDENTITY: Identity = { name: '', email: '' };

// --- Module-level helpers ---

const presetDisplayLabel = (preset: IdentityPreset): string => {
  const label = preset.label?.trim();
  return label && label.length > 0 ? label : `${preset.name} <${preset.email}>`;
};

const parseMatchInput = (raw: string): string | string[] | undefined => {
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.length > 1 ? parts : parts[0];
};

const toMatchPatterns = (match: string | string[] | undefined): string[] => {
  if (!match) return [];
  const patterns = typeof match === 'string' ? [match] : match;
  return patterns.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
};

// --- Exports ---

export const collectIdentityInputs = async (current: Identity, repoPath: string): Promise<Identity | undefined> => {
  return pickPresetIdentity(current, repoPath);
};

export const findBestPresetMatch = async (repoPath: string): Promise<IdentityPreset | undefined> => {
  const presets = getConfiguredIdentities();
  if (presets.length === 0) return undefined;

  const remotes = await getRemoteUrls(repoPath);
  const fingerprint = [repoPath, path.basename(repoPath), ...remotes].join('\n').toLowerCase();

  let bestPreset: IdentityPreset | undefined;
  let bestScore = 0;

  for (const preset of presets) {
    const patterns = toMatchPatterns(preset.match);
    if (patterns.length === 0) continue;

    let score = 0;
    for (const pattern of patterns) {
      if (fingerprint.includes(pattern)) {
        score = Math.max(score, pattern.length);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPreset = preset;
    }
  }

  return bestPreset ?? (presets.length === 1 ? presets[0] : undefined);
};

// --- Picker ---

const pickPresetIdentity = async (current: Identity, repoPath: string): Promise<Identity | undefined> => {
  const repoTitle = `Git Persona (${path.basename(repoPath)})`;

  const isCurrentIdentity = (identity: Identity): boolean =>
    current.name.trim() === identity.name &&
    current.email.trim().toLowerCase() === identity.email.toLowerCase();

  const deleteButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('trash'),
    tooltip: 'Delete preset'
  };
  const editButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('edit'),
    tooltip: 'Edit preset'
  };
  const itemButtons = [editButton, deleteButton];

  const createItems = (): IdentityPickItem[] => {
    const configuredIdentities = getConfiguredIdentities();
    const items: IdentityPickItem[] = configuredIdentities.map((preset, presetIndex) => {
      const isCurrent = isCurrentIdentity(preset);
      const displayLabel = presetDisplayLabel(preset);
      return {
        label: isCurrent ? `$(check) ${displayLabel}` : displayLabel,
        description: preset.label?.trim() ? `${preset.name} <${preset.email}>` : undefined,
        detail: isCurrent ? CURRENTLY_CONFIGURED_DETAIL : undefined,
        preset,
        presetIndex,
        isCurrentConfigured: isCurrent,
        buttons: itemButtons
      };
    });

    const presetKeys = new Set(configuredIdentities.map(identityKey));
    for (const [recentIndex, identity] of getRecentIdentities().entries()) {
      if (presetKeys.has(identityKey(identity))) continue;

      const isCurrent = isCurrentIdentity(identity);
      const baseLabel = `Recent: ${identity.name} <${identity.email}>`;
      items.push({
        label: isCurrent ? `$(check) ${baseLabel}` : baseLabel,
        detail: isCurrent ? CURRENTLY_CONFIGURED_DETAIL : 'From recently used identities',
        preset: { name: identity.name, email: identity.email },
        recentIndex,
        isCurrentConfigured: isCurrent,
        buttons: itemButtons
      });
    }

    items.push({
      label: 'Actions',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push({
      label: '$(edit) Create one-time identity (this repo only)',
      detail: 'Applies to this repository now, without saving a reusable preset.',
      custom: true
    });
    items.push({
      label: '$(add) Create reusable identity preset',
      detail: 'Saves to gitPersona.identities so you can reuse and auto-apply it later.',
      addPreset: true
    });

    return items;
  };

  const selection = await new Promise<IdentityPickItem | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<IdentityPickItem>();
    quickPick.title = repoTitle;
    quickPick.placeholder = 'Choose an identity preset or enter a custom identity';
    quickPick.ignoreFocusOut = true;
    quickPick.items = createItems();

    let hasIgnoredInitialSelectionEvent = false;
    let isHandlingItemButton = false;
    let resolved = false;

    const disposeAndResolve = (value: IdentityPickItem | undefined): void => {
      if (resolved) return;
      resolved = true;
      quickPick.dispose();
      resolve(value);
    };

    quickPick.onDidAccept(() => {
      disposeAndResolve(quickPick.selectedItems[0]);
    });

    quickPick.onDidChangeSelection((items) => {
      const selected = items[0];
      if (!selected) return;

      if (!hasIgnoredInitialSelectionEvent) {
        hasIgnoredInitialSelectionEvent = true;
        return;
      }

      if (selected.isCurrentConfigured) {
        disposeAndResolve(selected);
      }
    });

    quickPick.onDidHide(() => {
      if (!isHandlingItemButton) {
        disposeAndResolve(undefined);
      }
    });

    quickPick.onDidTriggerItemButton(async (event) => {
      isHandlingItemButton = true;
      try {
        const { item, button } = event;

        if (item.presetIndex !== undefined) {
          const allPresets = getConfiguredIdentities();
          const target = allPresets[item.presetIndex];
          if (!target) return;

          if (button === editButton) {
            const edited = await editPresetIdentity(repoPath, target);
            if (!edited) return;

            const isDuplicate =
              allPresets.some((p, i) => i !== item.presetIndex && identityKey(p) === identityKey(edited)) ||
              getRecentIdentities().some((r) => identityKey(r) === identityKey(edited));
            if (isDuplicate) {
              void vscode.window.showWarningMessage(DUPLICATE_IDENTITY_WARNING);
              return;
            }

            allPresets[item.presetIndex] = edited;
            await setConfiguredIdentities(allPresets);
            void vscode.window.showInformationMessage('Git Persona: preset updated.');
          } else {
            const targetLabel = presetDisplayLabel(target);
            const confirmed = await vscode.window.showWarningMessage(
              `Delete preset "${targetLabel}"?`,
              { modal: true },
              'Delete'
            );
            if (confirmed !== 'Delete') return;

            await setConfiguredIdentities(allPresets.filter((_, i) => i !== item.presetIndex));

            const allRecent = getRecentIdentities();
            const nextRecent = allRecent.filter((r) => identityKey(r) !== identityKey(target));
            if (nextRecent.length !== allRecent.length) {
              await setRecentIdentities(nextRecent);
            }

            void vscode.window.showInformationMessage(`Git Persona: deleted preset "${targetLabel}".`);
          }

          quickPick.items = createItems();
          return;
        }

        if (item.recentIndex !== undefined) {
          const allRecent = getRecentIdentities();
          const target = allRecent[item.recentIndex];
          if (!target) return;

          if (button === editButton) {
            const edited = await collectCustomIdentityInputs(target, repoPath);
            if (!edited) return;

            const isDuplicate =
              allRecent.some((r, i) => i !== item.recentIndex && identityKey(r) === identityKey(edited)) ||
              getConfiguredIdentities().some((p) => identityKey(p) === identityKey(edited));
            if (isDuplicate) {
              void vscode.window.showWarningMessage(DUPLICATE_IDENTITY_WARNING);
              return;
            }

            allRecent[item.recentIndex] = edited;
            await setRecentIdentities(allRecent);
            void vscode.window.showInformationMessage('Git Persona: recent identity updated.');
          } else {
            const targetLabel = `${target.name} <${target.email}>`;
            const confirmed = await vscode.window.showWarningMessage(
              `Delete recent identity "${targetLabel}"?`,
              { modal: true },
              'Delete'
            );
            if (confirmed !== 'Delete') return;

            await setRecentIdentities(allRecent.filter((_, i) => i !== item.recentIndex));
            void vscode.window.showInformationMessage(`Git Persona: deleted recent identity "${targetLabel}".`);
          }

          quickPick.items = createItems();
        }
      } finally {
        isHandlingItemButton = false;
        quickPick.show();
      }
    });

    quickPick.show();
  });

  if (!selection) return undefined;
  if (selection.custom) return collectCustomIdentityInputs(EMPTY_IDENTITY, repoPath);
  if (selection.addPreset) return addNewPresetIdentity(repoPath);
  return selection.preset;
};

// --- Identity input helpers ---

const editPresetIdentity = async (repoPath: string, preset: IdentityPreset): Promise<IdentityPreset | undefined> => {
  const repoTitle = `Git Persona (${path.basename(repoPath)})`;

  const updatedIdentity = await collectCustomIdentityInputs({ name: preset.name, email: preset.email }, repoPath);
  if (!updatedIdentity) return undefined;

  const label = await vscode.window.showInputBox({
    title: repoTitle,
    prompt: 'Preset label',
    value: preset.label ?? '',
    ignoreFocusOut: true
  });
  if (label === undefined) return undefined;

  const currentMatch = Array.isArray(preset.match) ? preset.match.join(', ') : (preset.match ?? '');
  const matchInput = await vscode.window.showInputBox({
    title: repoTitle,
    prompt: 'Auto-match hints (comma-separated)',
    value: currentMatch,
    ignoreFocusOut: true
  });
  if (matchInput === undefined) return undefined;

  return {
    ...updatedIdentity,
    label: label.trim() || undefined,
    match: parseMatchInput(matchInput),
    options: await collectPresetOptionsInputs(repoPath, preset.options)
  };
};

const collectCustomIdentityInputs = async (current: Identity, repoPath: string): Promise<Identity | undefined> => {
  const repoTitle = `Git Persona (${path.basename(repoPath)})`;

  const name = await vscode.window.showInputBox({
    title: repoTitle,
    prompt: 'Git user.name (local to this repository)',
    value: current.name,
    ignoreFocusOut: true,
    validateInput: (input) => input.trim().length === 0 ? 'Name is required.' : undefined
  });
  if (!name) return undefined;

  const email = await vscode.window.showInputBox({
    title: repoTitle,
    prompt: 'Git user.email (local to this repository)',
    value: current.email,
    ignoreFocusOut: true,
    validateInput: (input) => isValidEmail(input) ? undefined : 'Enter a valid email address.'
  });
  if (!email) return undefined;

  return { name: name.trim(), email: email.trim() };
};

const addNewPresetIdentity = async (repoPath: string): Promise<Identity | undefined> => {
  const repoTitle = `Git Persona (${path.basename(repoPath)})`;
  const createdPresets: IdentityPreset[] = [];
  const existingKeys = new Set([
    ...getConfiguredIdentities().map(identityKey),
    ...getRecentIdentities().map(identityKey)
  ]);

  while (true) {
    const created = await collectCustomIdentityInputs(EMPTY_IDENTITY, repoPath);
    if (!created) break;

    const createdKey = identityKey(created);
    if (existingKeys.has(createdKey)) {
      await vscode.window.showWarningMessage(DUPLICATE_IDENTITY_WARNING, 'Try different values');
      continue;
    }

    const label = await vscode.window.showInputBox({
      title: repoTitle,
      prompt: 'Optional preset label (for example: Work, Personal)',
      ignoreFocusOut: true
    });

    const matchInput = await vscode.window.showInputBox({
      title: repoTitle,
      prompt: 'Optional auto-match hints (comma-separated)',
      placeHolder: 'github.com/work-org, /work/, gitlab.company.com',
      ignoreFocusOut: true
    });

    createdPresets.push({
      ...created,
      label: label?.trim() || undefined,
      match: parseMatchInput(matchInput ?? ''),
      options: await collectPresetOptionsInputs(repoPath)
    });
    existingKeys.add(createdKey);

    const addAnother = await vscode.window.showQuickPick(['Add another preset', 'Finish'], {
      title: repoTitle,
      placeHolder: 'Add more identities now?'
    });
    if (addAnother !== 'Add another preset') break;
  }

  if (createdPresets.length === 0) return undefined;

  await setConfiguredIdentities([...getConfiguredIdentities(), ...createdPresets]);
  return createdPresets[createdPresets.length - 1];
};

// --- Git config options ---

const GIT_CONFIG_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/;

const collectPresetOptionsInputs = async (
  repoPath: string,
  currentOptions?: GitConfigOptions
): Promise<GitConfigOptions | undefined> => {
  const repoTitle = `Git Persona (${path.basename(repoPath)})`;
  const options: GitConfigOptions = { ...(currentOptions ?? {}) };

  while (true) {
    const summary = Object.keys(options).length === 0
      ? 'No extra git options set'
      : `Current: ${Object.keys(options).join(', ')}`;

    const choices = [
      { label: 'Set signing key (user.signingkey)', value: 'signing' as const },
      { label: 'Add/update custom option (dot-path)', value: 'custom' as const },
      { label: 'Remove an option', value: 'remove' as const },
      { label: 'Finish', value: 'done' as const }
    ];

    const selected = await vscode.window.showQuickPick(choices, {
      title: repoTitle,
      placeHolder: `Extra git config options. ${summary}`,
      ignoreFocusOut: true
    });
    if (!selected || selected.value === 'done') break;

    if (selected.value === 'signing') {
      const signingKey = await vscode.window.showInputBox({
        title: repoTitle,
        prompt: 'Git user.signingkey value (leave empty to clear)',
        value: options['user.signingkey'] ?? '',
        ignoreFocusOut: true
      });
      if (signingKey === undefined) continue;

      const normalized = signingKey.trim();
      if (normalized.length === 0) {
        delete options['user.signingkey'];
      } else {
        options['user.signingkey'] = normalized;
      }
      continue;
    }

    if (selected.value === 'custom') {
      const key = await vscode.window.showInputBox({
        title: repoTitle,
        prompt: 'Git config key (dot-path syntax, e.g. commit.gpgsign)',
        ignoreFocusOut: true,
        validateInput: (input) => {
          const normalized = input.trim();
          if (!normalized.includes('.') || !GIT_CONFIG_KEY_PATTERN.test(normalized)) {
            return 'Use a valid dot-path key, for example: user.signingkey';
          }
          return undefined;
        }
      });
      if (!key) continue;

      const normalizedKey = key.trim();
      const value = await vscode.window.showInputBox({
        title: repoTitle,
        prompt: `Value for ${normalizedKey}`,
        value: options[normalizedKey] ?? '',
        ignoreFocusOut: true,
        validateInput: (input) => input.trim().length === 0 ? 'Value is required.' : undefined
      });
      if (!value) continue;

      options[normalizedKey] = value.trim();
      continue;
    }

    const keys = Object.keys(options);
    if (keys.length === 0) {
      void vscode.window.showInformationMessage('Git Persona: no extra options to remove.');
      continue;
    }

    const keyToRemove = await vscode.window.showQuickPick(keys, {
      title: repoTitle,
      placeHolder: 'Select an option to remove',
      ignoreFocusOut: true
    });
    if (!keyToRemove) continue;

    delete options[keyToRemove];
  }

  return Object.keys(options).length > 0 ? options : undefined;
};
