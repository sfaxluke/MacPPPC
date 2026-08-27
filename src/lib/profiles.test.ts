import { describe, it, expect } from 'vitest';
import { generateProfiles } from './profiles';
import type { ProfileSettings, SelectedApp } from './types';

function baseSettings(): ProfileSettings {
  return {
    organization: '',
    payloadName: '',
    payloadIdentifier: 'acme.pppc.profile',
    payloadDescription: '',
    scopeTagIds: ['0'],
    deploymentChannel: 'deviceChannel',
  };
}

function pathApp(): SelectedApp {
  return {
    id: 1,
    app: {
      bundleId: '/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent',
      displayName: 'ninjarmm-macagent',
      codeRequirement: null,
      identifierType: 'path',
    },
    permissions: {
      fullDiskAccess: { enabled: true, authorization: 'Allow' },
    },
    expanded: true,
    isKnownApp: false,
    profile: { name: '', description: '', identifier: 'x', organization: '' },
    scopeTagIds: ['0'],
    deploymentChannel: 'deviceChannel',
  };
}

describe('generateProfiles filename generation', () => {
  it('uses the last path segment, not the whole path, for a path-identified app default filename', () => {
    const profiles = generateProfiles([pathApp()], baseSettings(), 'bundle', 'classic');

    expect(profiles).toHaveLength(1);
    expect(profiles[0].filename).toBe('PPPC-ninjarmm-macagent.mobileconfig');
  });
});
