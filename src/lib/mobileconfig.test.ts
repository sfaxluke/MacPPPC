import { describe, it, expect } from 'vitest';
import { generateMobileconfig } from './mobileconfig';
import type { PermissionsState, ProfileSettings, SelectedApp } from './types';

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

function pathApp(permissions: PermissionsState): SelectedApp {
  return {
    id: 1,
    app: {
      bundleId: '/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent',
      displayName: 'ninjarmm-macagent',
      codeRequirement: null,
      identifierType: 'path',
    },
    permissions,
    expanded: true,
    isKnownApp: false,
    profile: { name: '', description: '', identifier: 'x', organization: '' },
    scopeTagIds: ['0'],
    deploymentChannel: 'deviceChannel',
  };
}

describe('generateMobileconfig', () => {
  it('emits IdentifierType path for a path-identified standard entry', () => {
    const app = pathApp({
      fullDiskAccess: { enabled: true, authorization: 'Allow' },
    });

    const xml = generateMobileconfig([app], baseSettings());

    expect(xml).toMatch(
      /<key>Identifier<\/key>\s*<string>\/Applications\/NinjaRMMAgent\/programfiles\/ninjarmm-macagent<\/string>\s*<key>IdentifierType<\/key>\s*<string>path<\/string>/,
    );
  });

  it('emits IdentifierType path for a path-identified AppleEvents sender', () => {
    const app = pathApp({
      automation: {
        enabled: true,
        authorization: 'Allow',
        receivers: [
          {
            identifier: 'com.apple.finder',
            identifierType: 'bundleID',
            codeRequirement: 'identifier "com.apple.finder" and anchor apple generic',
            authorization: 'Allow',
          },
        ],
      },
    });

    const xml = generateMobileconfig([app], baseSettings());

    expect(xml).toMatch(
      /<key>Identifier<\/key>\s*<string>\/Applications\/NinjaRMMAgent\/programfiles\/ninjarmm-macagent<\/string>\s*<key>IdentifierType<\/key>\s*<string>path<\/string>/,
    );
  });
});
