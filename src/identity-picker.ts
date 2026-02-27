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
import { Identity, IdentityPreset } from './types';

export const collectIdentityInputs = async (current: Identity, repoPath: string): Promise<Identity | undefined> => {
  const picked = await pickPresetIdentity(repoPath, current);
  if (picked) {
    return picked;
  }

  return collectCustomIdentityInputs(current, repoPath);
};

export const findBestPresetMatch = async (repoPath: string): Promise<IdentityPreset | undefined> => {
  const presets = getConfiguredIdentities();
  if (presets.length === 0) {
    return undefined;
  }

  const remotes = await getRemoteUrls(repoPath);
  const fingerprint = [repoPath, path.basename(repoPath), ...remotes].join('\n').toLowerCase();

  let bestPreset: IdentityPreset | undefined;
  let bestScore = 0;

  for (const preset of presets) {
    const patterns = toMatchPatterns(preset.match);
    if (patterns.length === 0) {
      continue;
    }

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

  if (bestPreset) {
    return bestPreset;
  }

  return presets.length === 1 ? presets[0] : undefined;
};

const pickPresetIdentity = async (repoPath: string, current: Identity): Promise<Identity | undefined> => {
  const presets = getConfiguredIdentities();
  const recent = getRecentIdentities();
  if (presets.length === 0 && recent.length === 0) {
    return undefined;
  }

  type IdentityPickItem = vscode.QuickPickItem & {
    preset?: Identity;
    custom?: boolean;
    addPreset?: boolean;
    presetIndex?: number;
    isSavedPreset?: boolean;
    recentIndex?: number;
    isRecentIdentity?: boolean;
    isCurrentConfigured?: boolean;
  };

  const deleteButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('trash'),
    tooltip: 'Delete preset'
  };
  const editButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('edit'),
    tooltip: 'Edit preset'
  };

  const createItems = (): IdentityPickItem[] => {
    const currentPresets = getConfiguredIdentities();
    const currentRecent = getRecentIdentities();
    const nextItems: IdentityPickItem[] = currentPresets.map((preset, index) => {
      const presetLabel = preset.label?.trim();
      const isCurrent =
        current.name.trim() === preset.name &&
        current.email.trim().toLowerCase() === preset.email.toLowerCase();

      return {
        label: presetLabel && presetLabel.length > 0 ? presetLabel : `${preset.name} <${preset.email}>`,
        description: presetLabel && presetLabel.length > 0 ? `${preset.name} <${preset.email}>` : undefined,
        detail: isCurrent ? 'Currently configured for this repository' : undefined,
        preset: { name: preset.name, email: preset.email },
        presetIndex: index,
        isSavedPreset: true,
        isCurrentConfigured: isCurrent,
        buttons: [editButton, deleteButton]
      };
    });

    const existingKeys = new Set(nextItems.map((item) => identityKey(item.preset!)));
    for (const [recentIndex, recentIdentity] of currentRecent.entries()) {
      const key = identityKey(recentIdentity);
      if (existingKeys.has(key)) {
        continue;
      }

      const isCurrent =
        current.name.trim() === recentIdentity.name &&
        current.email.trim().toLowerCase() === recentIdentity.email.toLowerCase();

      nextItems.push({
        label: `Recent: ${recentIdentity.name} <${recentIdentity.email}>`,
        detail: isCurrent ? 'Currently configured for this repository' : 'From recently used identities',
        preset: { name: recentIdentity.name, email: recentIdentity.email },
        recentIndex,
        isRecentIdentity: true,
        isCurrentConfigured: isCurrent,
        buttons: [editButton, deleteButton]
      });
    }

    nextItems.push({
      label: '$(edit) Use one-time identity (this repo only)',
      detail: 'Applies to this repository now, without saving a reusable preset.',
      custom: true
    });

    nextItems.push({
      label: '$(add) Create reusable identity preset',
      detail: 'Saves to gitPersona.identities so you can reuse and auto-apply it later.',
      addPreset: true
    });

    return nextItems;
  };

  const selection = await new Promise<IdentityPickItem | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<IdentityPickItem>();
    quickPick.title = `Git Persona (${path.basename(repoPath)})`;
    quickPick.placeholder = 'Choose an identity preset or enter a custom identity';
    quickPick.ignoreFocusOut = true;
    quickPick.items = createItems();
    let hasIgnoredInitialSelectionEvent = false;
    let isHandlingItemButton = false;
    let resolved = false;

    const disposeAndResolve = (value: IdentityPickItem | undefined): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      quickPick.dispose();
      resolve(value);
    };

    quickPick.onDidAccept(() => {
      disposeAndResolve(quickPick.selectedItems[0]);
    });

    quickPick.onDidChangeSelection((items) => {
      const selected = items[0];
      if (!selected) {
        return;
      }

      if (!hasIgnoredInitialSelectionEvent) {
        hasIgnoredInitialSelectionEvent = true;
        return;
      }

      if (selected.isCurrentConfigured) {
        disposeAndResolve(selected);
      }
    });

    quickPick.onDidHide(() => {
      if (isHandlingItemButton) {
        return;
      }
      disposeAndResolve(undefined);
    });

    quickPick.onDidTriggerItemButton(async (event) => {
      isHandlingItemButton = true;
      if (!event.item.isSavedPreset && !event.item.isRecentIdentity) {
        isHandlingItemButton = false;
        return;
      }

      if (event.item.isSavedPreset && event.item.presetIndex !== undefined) {
        const allPresets = getConfiguredIdentities();
        const target = allPresets[event.item.presetIndex];
        if (!target) {
          return;
        }

        if (event.button === editButton) {
          const edited = await editPresetIdentity(repoPath, target);
          if (!edited) {
            return;
          }

          allPresets[event.item.presetIndex] = edited;
          await setConfiguredIdentities(allPresets);
          quickPick.items = createItems();
          void vscode.window.showInformationMessage('Git Persona: preset updated.');
          isHandlingItemButton = false;
          quickPick.show();
          return;
        }

        const targetLabel = target.label?.trim() || `${target.name} <${target.email}>`;
        const confirmed = await vscode.window.showWarningMessage(
          `Delete preset "${targetLabel}"?`,
          { modal: true },
          'Delete'
        );
        if (confirmed !== 'Delete') {
          isHandlingItemButton = false;
          quickPick.show();
          return;
        }

        const nextPresets = allPresets.filter((_, index) => index !== event.item.presetIndex);
        await setConfiguredIdentities(nextPresets);
        quickPick.items = createItems();
        void vscode.window.showInformationMessage(`Git Persona: deleted preset ${targetLabel}.`);
        isHandlingItemButton = false;
        quickPick.show();
        return;
      }

      if (event.item.isRecentIdentity && event.item.recentIndex !== undefined) {
        const allRecent = getRecentIdentities();
        const target = allRecent[event.item.recentIndex];
        if (!target) {
          return;
        }

        if (event.button === editButton) {
          const edited = await collectCustomIdentityInputs(target, repoPath);
          if (!edited) {
            return;
          }

          allRecent[event.item.recentIndex] = edited;
          await setRecentIdentities(allRecent);
          quickPick.items = createItems();
          void vscode.window.showInformationMessage('Git Persona: recent identity updated.');
          isHandlingItemButton = false;
          quickPick.show();
          return;
        }

        const targetLabel = `${target.name} <${target.email}>`;
        const confirmed = await vscode.window.showWarningMessage(
          `Delete recent identity "${targetLabel}"?`,
          { modal: true },
          'Delete'
        );
        if (confirmed !== 'Delete') {
          isHandlingItemButton = false;
          quickPick.show();
          return;
        }

        const nextRecent = allRecent.filter((_, index) => index !== event.item.recentIndex);
        await setRecentIdentities(nextRecent);
        quickPick.items = createItems();
        void vscode.window.showInformationMessage(`Git Persona: deleted recent identity ${targetLabel}.`);
        isHandlingItemButton = false;
        quickPick.show();
        return;
      }

      isHandlingItemButton = false;
    });

    quickPick.show();
  });

  if (!selection || selection.custom) {
    return undefined;
  }

  if (selection.addPreset) {
    return addNewPresetIdentity(repoPath);
  }

  return selection.preset;
};

const editPresetIdentity = async (repoPath: string, preset: IdentityPreset): Promise<IdentityPreset | undefined> => {
  const updatedIdentity = await collectCustomIdentityInputs(
    { name: preset.name, email: preset.email },
    repoPath
  );
  if (!updatedIdentity) {
    return undefined;
  }

  const label = await vscode.window.showInputBox({
    title: `Git Persona (${path.basename(repoPath)})`,
    prompt: 'Preset label',
    value: preset.label ?? '',
    ignoreFocusOut: true
  });

  const currentMatch = Array.isArray(preset.match) ? preset.match.join(', ') : (preset.match ?? '');
  const matchInput = await vscode.window.showInputBox({
    title: `Git Persona (${path.basename(repoPath)})`,
    prompt: 'Auto-match hints (comma-separated)',
    value: currentMatch,
    ignoreFocusOut: true
  });

  const parsedMatches = (matchInput ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    ...updatedIdentity,
    label: label?.trim() || undefined,
    match: parsedMatches.length > 1 ? parsedMatches : parsedMatches[0]
  };
};

const collectCustomIdentityInputs = async (current: Identity, repoPath: string): Promise<Identity | undefined> => {
  const name = await vscode.window.showInputBox({
    title: `Git Persona (${path.basename(repoPath)})`,
    prompt: 'Git user.name (local to this repository)',
    value: current.name,
    ignoreFocusOut: true,
    validateInput: (input) => input.trim().length === 0 ? 'Name is required.' : undefined
  });
  if (!name) {
    return undefined;
  }

  const email = await vscode.window.showInputBox({
    title: `Git Persona (${path.basename(repoPath)})`,
    prompt: 'Git user.email (local to this repository)',
    value: current.email,
    ignoreFocusOut: true,
    validateInput: (input) => isValidEmail(input) ? undefined : 'Enter a valid email address.'
  });
  if (!email) {
    return undefined;
  }

  return { name: name.trim(), email: email.trim() };
};

const addNewPresetIdentity = async (repoPath: string): Promise<Identity | undefined> => {
  const createdPresets: IdentityPreset[] = [];

  while (true) {
    const created = await collectCustomIdentityInputs({ name: '', email: '' }, repoPath);
    if (!created) {
      break;
    }

    const label = await vscode.window.showInputBox({
      title: `Git Persona (${path.basename(repoPath)})`,
      prompt: 'Optional preset label (for example: Work, Personal)',
      ignoreFocusOut: true
    });

    const matchInput = await vscode.window.showInputBox({
      title: `Git Persona (${path.basename(repoPath)})`,
      prompt: 'Optional auto-match hints (comma-separated)',
      placeHolder: 'github.com/work-org, /work/, gitlab.company.com',
      ignoreFocusOut: true
    });

    const parsedMatches = (matchInput ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    createdPresets.push({
      ...created,
      label: label?.trim() || undefined,
      match: parsedMatches.length > 1 ? parsedMatches : parsedMatches[0]
    });

    const addAnother = await vscode.window.showQuickPick(['Add another preset', 'Finish'], {
      title: `Git Persona (${path.basename(repoPath)})`,
      placeHolder: 'Add more identities now?'
    });

    if (addAnother !== 'Add another preset') {
      break;
    }
  }

  if (createdPresets.length === 0) {
    return undefined;
  }

  const presets = getConfiguredIdentities();
  const existingKeys = new Set(presets.map((preset) => identityKey(preset)));
  const deduped = createdPresets.filter((preset) => !existingKeys.has(identityKey(preset)));
  if (deduped.length > 0) {
    await setConfiguredIdentities([...presets, ...deduped]);
  }

  return createdPresets[0];
};

const toMatchPatterns = (match: string | string[] | undefined): string[] => {
  if (!match) {
    return [];
  }

  if (typeof match === 'string') {
    const normalized = match.trim().toLowerCase();
    return normalized.length > 0 ? [normalized] : [];
  }

  return match
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
};
