export type Identity = {
  name: string;
  email: string;
};

/** Extra git config key-value options (e.g. user.signingkey). */
export type GitConfigOptions = Record<string, string>;

export interface IdentityPreset extends Identity {
  label?: string;
  match?: string | string[];
  options?: GitConfigOptions;
}

export type RepoStatus = {
  repoPath: string;
  identity: Identity;
  missing: Array<'name' | 'email'>;
  validDomain: boolean;
  ignored: boolean;
};
