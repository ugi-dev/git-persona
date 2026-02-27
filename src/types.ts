export type Identity = {
  name: string;
  email: string;
};

export interface IdentityPreset extends Identity {
  label?: string;
  match?: string | string[];
}

export type RepoStatus = {
  repoPath: string;
  identity: Identity;
  missing: Array<'name' | 'email'>;
  validDomain: boolean;
  ignored: boolean;
};
