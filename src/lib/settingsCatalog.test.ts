import { describe, it, expect } from 'vitest';
import { buildSettingsCatalogPolicy } from './settingsCatalog';
import type { ProfileSettings, SelectedApp } from './types';

function baseSettings(): ProfileSettings {
  return {
    organization: 'Acme Corp',
    payloadName: 'Acme PPPC',
    payloadIdentifier: 'acme.pppc.profile',
    payloadDescription: '',
    scopeTagIds: ['0'],
    deploymentChannel: 'deviceChannel',
  };
}

describe('buildSettingsCatalogPolicy', () => {
  it('emits identifiertype value 1 (path) for a path-identified app', () => {
    const app: SelectedApp = {
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

    const policy = buildSettingsCatalogPolicy([app], baseSettings());
    const json = JSON.stringify(policy);

    expect(json).toContain('_identifiertype_1');
    expect(json).not.toContain('_identifiertype_0');
  });
});
