# Path-Identified Apps in mobileconfig Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mobileconfig importer accept apps identified by absolute file path (not just bundle ID), and let both output generators correctly re-emit that identifier type, so a profile like a NinjaOne agent binary (no `CFBundleIdentifier`) imports and re-exports correctly in both formats.

**Architecture:** Add `identifierType: 'bundleID' | 'path'` to the existing `AppInfo` type. The importer already rejects any sender identifier that isn't `bundleID`; relax that to accept `path` too and carry the type through. Both generators (`mobileconfig.ts`, `settingsCatalog.ts`) already have a working `bundleID`/`path` distinction for AppleEvents *receivers* — extend the same mechanism to the app's own identifier, which is the only place it's still hardcoded.

**Tech Stack:** Same as the rest of this branch — TypeScript strict mode, Vitest.

## Global Constraints

- TypeScript strict mode applies repo-wide: `strict`, `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`.
- `npm run build` and `npm test` must both pass after every task.
- Manual entry of a path-identified app is explicitly out of scope — `AppInput.tsx`'s "Select Application" flow stays bundle-ID-only. Path-identified apps enter the workspace only via mobileconfig import.
- `KnownApp` and the known-apps library stay bundle-ID-only; unaffected by this plan.
- Existing behavior for bundle-ID-identified apps must not change — every existing test (in `mobileconfigImport.test.ts` and elsewhere) must stay green except the one test this plan explicitly rewrites (Task 2).
- Design source of truth: `docs/superpowers/specs/2026-08-27-path-identifier-import-design.md`.

---

## Task 1: Add `identifierType` to `AppInfo`

**Files:**
- Modify: `src/lib/types.ts:45-49`
- Modify: `src/lib/plist.ts:78-89`
- Modify: `src/components/AppInput.tsx:48-61`
- Test: `src/lib/plist.test.ts`

**Interfaces:**
- Produces: `AppInfo.identifierType: 'bundleID' | 'path'` (new required field) in `src/lib/types.ts` — consumed by every later task in this plan.

`AppInfo` is constructed in exactly three places in this codebase: `parsePlist` (`plist.ts`, the `.zip`/`Info.plist` import flow), `pickKnown` (`AppInput.tsx`, the known-apps picker), and `importMobileconfig` (`mobileconfigImport.ts`, built in Task 2). This task adds the field to the type and updates the first two — both always produce a bundle-ID app, so both get `identifierType: 'bundleID'`. TypeScript's strict mode means any construction site missed here fails to compile.

- [ ] **Step 1: Add the failing assertion**

Edit `src/lib/plist.test.ts` — in the existing `describe('parsePlist', ...)` block, change:

```ts
describe('parsePlist', () => {
  it('extracts bundle ID and display name from a flat Info.plist', () => {
    const info = parsePlist(INFO_PLIST, []);
    expect(info.bundleId).toBe('com.example.app');
    expect(info.displayName).toBe('Example App');
  });
});
```

to:

```ts
describe('parsePlist', () => {
  it('extracts bundle ID and display name from a flat Info.plist', () => {
    const info = parsePlist(INFO_PLIST, []);
    expect(info.bundleId).toBe('com.example.app');
    expect(info.displayName).toBe('Example App');
    expect(info.identifierType).toBe('bundleID');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/plist.test.ts`
Expected: FAIL — `info.identifierType` is `undefined`, not `'bundleID'` (the field doesn't exist on the returned object yet).

- [ ] **Step 3: Add the field to `AppInfo`**

Edit `src/lib/types.ts` — change:

```ts
export interface AppInfo {
  bundleId: string;
  displayName: string;
  codeRequirement: string | null;
}
```

to:

```ts
export interface AppInfo {
  bundleId: string;
  /**
   * How `bundleId` identifies the app. Defaults to 'bundleID' everywhere
   * except mobileconfig import — 'path' identifies an app by absolute file
   * path (used for binaries with no CFBundleIdentifier, e.g. a raw agent
   * executable). There is no manual-entry path for 'path' apps today.
   */
  identifierType: 'bundleID' | 'path';
  displayName: string;
  codeRequirement: string | null;
}
```

- [ ] **Step 4: Update the two other construction sites**

Edit `src/lib/plist.ts` — change:

```ts
    return {
      bundleId,
      displayName,
      codeRequirement: knownApp ? knownApp.codeRequirement : null,
    };
```

to:

```ts
    return {
      bundleId,
      identifierType: 'bundleID',
      displayName,
      codeRequirement: knownApp ? knownApp.codeRequirement : null,
    };
```

Edit `src/components/AppInput.tsx` — change:

```ts
    onAppDetected(
      {
        bundleId: known.bundleId,
        displayName: known.displayName,
        codeRequirement: known.codeRequirement,
      },
      true,
    );
```

to:

```ts
    onAppDetected(
      {
        bundleId: known.bundleId,
        identifierType: 'bundleID',
        displayName: known.displayName,
        codeRequirement: known.codeRequirement,
      },
      true,
    );
```

- [ ] **Step 5: Run it, verify it passes**

Run: `npx vitest run src/lib/plist.test.ts`
Expected: PASS.

- [ ] **Step 6: Full regression check**

Run: `npm run build && npm test`
Expected: both succeed. (`mobileconfigImport.ts` does not construct `AppInfo` yet in a way the compiler would catch here — Task 2 handles it — but this confirms nothing else broke.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/plist.ts src/lib/plist.test.ts src/components/AppInput.tsx
git commit -m "feat: add identifierType to AppInfo"
```

---

## Task 2: Accept path-identified sender apps in the importer

**Files:**
- Modify: `src/lib/mobileconfigImport.ts`
- Modify: `src/lib/mobileconfigImport.test.ts`

**Interfaces:**
- Consumes: `AppInfo.identifierType` (Task 1).
- Produces: `importMobileconfig(...)` now returns apps with `app.identifierType` set from the source profile (`'bundleID'` or `'path'`), instead of always implicitly `'bundleID'`.

The sender-identifier check currently rejects anything but `bundleID` outright — that's the line rejecting a real-world NinjaOne profile that identifies its agent by path. This task accepts both valid forms (matching the check already used for AppleEvents receivers) and carries the type through into the built `AppInfo`. One existing test needs rewriting: `'skips a path-identified entry and records a warning'` currently asserts that a `path`-typed entry gets rejected — that assumption is exactly what this task changes, so its scenario (and the warning it expects) no longer applies. It's replaced with a test for the new, narrower failure case: a genuinely invalid `IdentifierType`.

- [ ] **Step 1: Update the existing "path identifier" test, add new tests**

Edit `src/lib/mobileconfigImport.test.ts` — replace this whole test:

```ts
  it('skips a path-identified entry and records a warning', () => {
    const xml = profileXml(
      [
        serviceArray('Camera', [
          entryDict({
            Identifier: '/Applications/Foo.app',
            IdentifierType: 'path',
            Authorization: 'Deny',
          }),
        ]),
        serviceArray('Microphone', [
          entryDict({
            Identifier: 'com.example.app',
            IdentifierType: 'bundleID',
            Authorization: 'Deny',
          }),
        ]),
      ].join('\n'),
    );

    const result = importMobileconfig(xml, [], 1);
    expect(result.apps).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('path identifier'))).toBe(true);
  });
```

with:

```ts
  it('skips an entry with an invalid IdentifierType and records a warning', () => {
    const xml = profileXml(
      [
        serviceArray('Camera', [
          entryDict({
            Identifier: 'com.example.app',
            IdentifierType: 'wat',
            Authorization: 'Deny',
          }),
        ]),
        serviceArray('Microphone', [
          entryDict({
            Identifier: 'com.example.app',
            IdentifierType: 'bundleID',
            Authorization: 'Deny',
          }),
        ]),
      ].join('\n'),
    );

    const result = importMobileconfig(xml, [], 1);
    expect(result.apps).toHaveLength(1);
    expect(
      result.warnings.some((w) => w.includes('invalid IdentifierType')),
    ).toBe(true);
  });

  it('accepts a path-identified sender app and carries identifierType through', () => {
    // Real-world shape: an agent binary with no CFBundleIdentifier is
    // identified by its on-disk path instead (e.g. NinjaOne's agent).
    const xml = profileXml(
      serviceArray('SystemPolicyAllFiles', [
        entryDict({
          Identifier: '/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent',
          IdentifierType: 'path',
          Allowed: { bool: true },
          CodeRequirement: 'identifier "ninjarmm-macagent" and anchor apple generic',
        }),
      ]),
    );

    const result = importMobileconfig(xml, [], 1);
    expect(result.warnings).toEqual([]);
    expect(result.apps).toHaveLength(1);
    const app = result.apps[0];
    expect(app.app.bundleId).toBe(
      '/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent',
    );
    expect(app.app.identifierType).toBe('path');
    expect(app.permissions.fullDiskAccess.enabled).toBe(true);
    expect(app.permissions.fullDiskAccess.authorization).toBe('Allow');
  });

  it('defaults identifierType to bundleID for a normal entry', () => {
    const xml = profileXml(
      serviceArray('Camera', [
        entryDict({
          Identifier: 'com.example.app',
          IdentifierType: 'bundleID',
          Authorization: 'Deny',
        }),
      ]),
    );

    const result = importMobileconfig(xml, [], 1);
    expect(result.apps[0].app.identifierType).toBe('bundleID');
  });
```

- [ ] **Step 2: Run it, verify the new/changed tests fail**

Run: `npx vitest run src/lib/mobileconfigImport.test.ts`
Expected: FAIL on 3 tests — the rewritten "invalid IdentifierType" test (current code's warning text still says "uses a path identifier", not "invalid IdentifierType"), the new "accepts a path-identified sender" test (current code rejects `path` outright, so `result.apps` would be empty / it would throw), and the new "defaults identifierType to bundleID" test (`app.identifierType` doesn't exist on the returned `AppInfo` yet — compile error surfaces as `undefined` at runtime, same mechanism as Task 1 Step 2).

- [ ] **Step 3: Update the importer**

Edit `src/lib/mobileconfigImport.ts` — update the doc comment:

```ts
/**
 * Parse an existing PPPC .mobileconfig document into the app/permission
 * state this tool already knows how to render and export. Entries this
 * tool can't represent (unsupported services, path-based identifiers,
 * unrecognized authorization values) are skipped and reported as warnings
 * rather than failing the whole import.
 */
```

to:

```ts
/**
 * Parse an existing PPPC .mobileconfig document into the app/permission
 * state this tool already knows how to render and export. Entries this
 * tool can't represent (unsupported services, an invalid IdentifierType,
 * unrecognized authorization values) are skipped and reported as warnings
 * rather than failing the whole import.
 */
```

Add `identifierType` to `AppOverlay`:

```ts
interface AppOverlay {
  codeRequirement: string | null;
  standard: Partial<Record<string, { enabled: true; authorization: Authorization }>>;
  receivers: Partial<Record<string, AppleEventReceiver[]>>;
}
```

becomes:

```ts
interface AppOverlay {
  codeRequirement: string | null;
  identifierType: 'bundleID' | 'path';
  standard: Partial<Record<string, { enabled: true; authorization: Authorization }>>;
  receivers: Partial<Record<string, AppleEventReceiver[]>>;
}
```

Update `overlayFor`'s initializer:

```ts
      overlay = { codeRequirement: null, standard: {}, receivers: {} };
```

becomes:

```ts
      overlay = { codeRequirement: null, identifierType: 'bundleID', standard: {}, receivers: {} };
```

Replace the sender-identifier check:

```ts
      const bundleId = asString(entry.Identifier);
      const identifierType = asString(entry.IdentifierType);
      if (!bundleId) {
        warnings.push(`Entry for "${tccService}" has no Identifier — skipped.`);
        continue;
      }
      if (identifierType !== 'bundleID') {
        warnings.push(
          `"${bundleId}" uses a path identifier for "${tccService}", which this tool doesn't support — skipped.`,
        );
        continue;
      }

      applyCodeRequirement(bundleId, asString(entry.CodeRequirement));
```

becomes:

```ts
      const bundleId = asString(entry.Identifier);
      const identifierType = asString(entry.IdentifierType);
      if (!bundleId) {
        warnings.push(`Entry for "${tccService}" has no Identifier — skipped.`);
        continue;
      }
      if (identifierType !== 'bundleID' && identifierType !== 'path') {
        warnings.push(
          `Entry for "${tccService}" has an invalid IdentifierType "${identifierType ?? ''}" — skipped.`,
        );
        continue;
      }

      overlayFor(bundleId).identifierType = identifierType;
      applyCodeRequirement(bundleId, asString(entry.CodeRequirement));
```

Update the `AppInfo` construction in the apps-building loop:

```ts
    const appInfo: AppInfo = {
      bundleId,
      displayName: known?.displayName ?? bundleId,
      codeRequirement: overlay.codeRequirement,
    };
```

becomes:

```ts
    const appInfo: AppInfo = {
      bundleId,
      identifierType: overlay.identifierType,
      displayName: known?.displayName ?? bundleId,
      codeRequirement: overlay.codeRequirement,
    };
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/mobileconfigImport.test.ts`
Expected: PASS (all tests, including the 3 from Step 2 and everything from Tasks 3–4 of the prior mobileconfig-import plan).

- [ ] **Step 5: Full regression check**

Run: `npm run build && npm test`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mobileconfigImport.ts src/lib/mobileconfigImport.test.ts
git commit -m "feat: accept path-identified sender apps in mobileconfig import"
```

---

## Task 3: Dynamic IdentifierType in the classic mobileconfig generator

**Files:**
- Modify: `src/lib/mobileconfig.ts`
- Create: `src/lib/mobileconfig.test.ts`

**Interfaces:**
- Consumes: `AppInfo.identifierType` (Task 1).
- Produces: no new exports — `generateMobileconfig(...)`'s XML output now reflects each app's real `identifierType` instead of always emitting `bundleID`.

`mobileconfig.ts` has zero existing test coverage (pre-existing, out of scope to retrofit broadly). This task adds two narrowly-scoped tests proving only the new behavior: a path-identified standard entry, and a path-identified AppleEvents sender (these are two physically separate template-literal sites in the file, both currently hardcoding the `bundleID` literal).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mobileconfig.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/mobileconfig.test.ts`
Expected: FAIL on both tests — the current code always emits `<string>bundleID</string>` regardless of the app's `identifierType`.

- [ ] **Step 3: Make the generator dynamic**

Edit `src/lib/mobileconfig.ts` — add `identifierType` to both entry interfaces:

```ts
interface StandardEntry {
  kind: 'standard';
  bundleId: string;
  codeRequirement: string | null;
  authorization: Authorization;
  authMode: AuthMode;
}

interface AppleEventsEntry {
  kind: 'appleEvents';
  bundleId: string;
  codeRequirement: string | null;
  receivers: AppleEventReceiver[];
}
```

becomes:

```ts
interface StandardEntry {
  kind: 'standard';
  bundleId: string;
  identifierType: 'bundleID' | 'path';
  codeRequirement: string | null;
  authorization: Authorization;
  authMode: AuthMode;
}

interface AppleEventsEntry {
  kind: 'appleEvents';
  bundleId: string;
  identifierType: 'bundleID' | 'path';
  codeRequirement: string | null;
  receivers: AppleEventReceiver[];
}
```

Update both push sites in `buildServicesDict`. Change:

```ts
        serviceGroups[service].push({
          kind: 'appleEvents',
          bundleId: item.app.bundleId,
          codeRequirement: item.app.codeRequirement,
          receivers,
        });
```

to:

```ts
        serviceGroups[service].push({
          kind: 'appleEvents',
          bundleId: item.app.bundleId,
          identifierType: item.app.identifierType,
          codeRequirement: item.app.codeRequirement,
          receivers,
        });
```

Change:

```ts
      serviceGroups[service].push({
        kind: 'standard',
        bundleId: item.app.bundleId,
        codeRequirement: item.app.codeRequirement,
        authorization: state.authorization,
        authMode: perm.authMode,
      });
```

to:

```ts
      serviceGroups[service].push({
        kind: 'standard',
        bundleId: item.app.bundleId,
        identifierType: item.app.identifierType,
        codeRequirement: item.app.codeRequirement,
        authorization: state.authorization,
        authMode: perm.authMode,
      });
```

Replace the two hardcoded `bundleID` literals in the XML templates. Change:

```ts
            return [
              `                    <dict>
                        <key>Authorization</key>
                        <string>${auth}</string>
                        <key>CodeRequirement</key>
                        <string>${escapeXml(codeReq)}</string>
                        <key>Comment</key>
                        <string></string>
                        <key>Identifier</key>
                        <string>${escapeXml(entry.bundleId)}</string>
                        <key>IdentifierType</key>
                        <string>bundleID</string>
                    </dict>`,
            ];
```

to:

```ts
            return [
              `                    <dict>
                        <key>Authorization</key>
                        <string>${auth}</string>
                        <key>CodeRequirement</key>
                        <string>${escapeXml(codeReq)}</string>
                        <key>Comment</key>
                        <string></string>
                        <key>Identifier</key>
                        <string>${escapeXml(entry.bundleId)}</string>
                        <key>IdentifierType</key>
                        <string>${entry.identifierType}</string>
                    </dict>`,
            ];
```

Change:

```ts
            return `                    <dict>
                        <key>AEReceiverCodeRequirement</key>
                        <string>${escapeXml(receiverCodeReq)}</string>
                        <key>AEReceiverIdentifier</key>
                        <string>${escapeXml(r.identifier)}</string>
                        <key>AEReceiverIdentifierType</key>
                        <string>${r.identifierType}</string>
                        <key>Authorization</key>
                        <string>${r.authorization}</string>
                        <key>CodeRequirement</key>
                        <string>${escapeXml(senderCodeReq)}</string>
                        <key>Comment</key>
                        <string></string>
                        <key>Identifier</key>
                        <string>${escapeXml(entry.bundleId)}</string>
                        <key>IdentifierType</key>
                        <string>bundleID</string>
                    </dict>`;
```

to:

```ts
            return `                    <dict>
                        <key>AEReceiverCodeRequirement</key>
                        <string>${escapeXml(receiverCodeReq)}</string>
                        <key>AEReceiverIdentifier</key>
                        <string>${escapeXml(r.identifier)}</string>
                        <key>AEReceiverIdentifierType</key>
                        <string>${r.identifierType}</string>
                        <key>Authorization</key>
                        <string>${r.authorization}</string>
                        <key>CodeRequirement</key>
                        <string>${escapeXml(senderCodeReq)}</string>
                        <key>Comment</key>
                        <string></string>
                        <key>Identifier</key>
                        <string>${escapeXml(entry.bundleId)}</string>
                        <key>IdentifierType</key>
                        <string>${entry.identifierType}</string>
                    </dict>`;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/mobileconfig.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Full regression check**

Run: `npm run build && npm test`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mobileconfig.ts src/lib/mobileconfig.test.ts
git commit -m "feat: emit the app's real IdentifierType in classic mobileconfig output"
```

---

## Task 4: Dynamic identifiertype in the Settings Catalog generator

**Files:**
- Modify: `src/lib/settingsCatalog.ts`
- Create: `src/lib/settingsCatalog.test.ts`

**Interfaces:**
- Consumes: `AppInfo.identifierType` (Task 1).
- Produces: no new exports — `buildSettingsCatalogPolicy(...)`'s output now reflects each app's real `identifierType` instead of always emitting the `bundleID` choice value.

Unlike `mobileconfig.ts`, this file has only **one** hardcoded call site (`appEntryChildren`'s bottom `choice` call is shared by both standard and AppleEvents rows), so one test is enough to prove the fix.

- [ ] **Step 1: Write the failing test**

Create `src/lib/settingsCatalog.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/settingsCatalog.test.ts`
Expected: FAIL — the current code always emits the `_identifiertype_0` (`bundleID`) suffix.

- [ ] **Step 3: Make the generator dynamic**

Edit `src/lib/settingsCatalog.ts` — add an `identifierType` parameter to `appEntryChildren`. Change:

```ts
function appEntryChildren(
  serviceId: string,
  bundleId: string,
  codeRequirement: string,
  authorization: Authorization,
  receiver?: AppleEventReceiver,
): SettingInstance[] {
```

to:

```ts
function appEntryChildren(
  serviceId: string,
  bundleId: string,
  identifierType: 'bundleID' | 'path',
  codeRequirement: string,
  authorization: Authorization,
  receiver?: AppleEventReceiver,
): SettingInstance[] {
```

Change the bottom of the same function:

```ts
  children.push(
    choice(`${prefix}_authorization`, AUTH_SUFFIX[authorization]),
    simple(`${prefix}_coderequirement`, codeRequirement),
    simple(`${prefix}_identifier`, bundleId),
    choice(`${prefix}_identifiertype`, IDENTIFIER_TYPE_SUFFIX.bundleID),
  );

  return children;
}
```

to:

```ts
  children.push(
    choice(`${prefix}_authorization`, AUTH_SUFFIX[authorization]),
    simple(`${prefix}_coderequirement`, codeRequirement),
    simple(`${prefix}_identifier`, bundleId),
    choice(`${prefix}_identifiertype`, IDENTIFIER_TYPE_SUFFIX[identifierType]),
  );

  return children;
}
```

Add `identifierType` to `ServiceAppRow`:

```ts
interface ServiceAppRow {
  bundleId: string;
  codeRequirement: string;
  authorization: Authorization;
  receiver?: AppleEventReceiver;
}
```

becomes:

```ts
interface ServiceAppRow {
  bundleId: string;
  identifierType: 'bundleID' | 'path';
  codeRequirement: string;
  authorization: Authorization;
  receiver?: AppleEventReceiver;
}
```

Update both row-push sites in `buildSettingsCatalogPolicy`. Change:

```ts
        for (const r of receivers) {
          list.push({
            bundleId: item.app.bundleId,
            codeRequirement: codeReq,
            authorization: r.authorization,
            receiver: r,
          });
        }
```

to:

```ts
        for (const r of receivers) {
          list.push({
            bundleId: item.app.bundleId,
            identifierType: item.app.identifierType,
            codeRequirement: codeReq,
            authorization: r.authorization,
            receiver: r,
          });
        }
```

Change:

```ts
      const list = rowsByService.get(perm.tccService) ?? [];
      list.push({
        bundleId: item.app.bundleId,
        codeRequirement: codeReq,
        authorization: effectiveAuthorization(perm.authMode, state.authorization),
      });
      rowsByService.set(perm.tccService, list);
```

to:

```ts
      const list = rowsByService.get(perm.tccService) ?? [];
      list.push({
        bundleId: item.app.bundleId,
        identifierType: item.app.identifierType,
        codeRequirement: codeReq,
        authorization: effectiveAuthorization(perm.authMode, state.authorization),
      });
      rowsByService.set(perm.tccService, list);
```

Update the `appEntryChildren` call site. Change:

```ts
        rows.map((row) =>
          valueWrapper(
            appEntryChildren(
              serviceId,
              row.bundleId,
              row.codeRequirement,
              row.authorization,
              row.receiver,
            ),
          ),
        ),
```

to:

```ts
        rows.map((row) =>
          valueWrapper(
            appEntryChildren(
              serviceId,
              row.bundleId,
              row.identifierType,
              row.codeRequirement,
              row.authorization,
              row.receiver,
            ),
          ),
        ),
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/settingsCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Full regression check**

Run: `npm run build && npm test`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/settingsCatalog.ts src/lib/settingsCatalog.test.ts
git commit -m "feat: emit the app's real identifiertype in Settings Catalog output"
```

---

## Task 5: Path-aware default filename segment

**Files:**
- Modify: `src/lib/profiles.ts:61-63`
- Create: `src/lib/profiles.test.ts`

**Interfaces:**
- Consumes: `AppInfo.identifierType` (Task 1) — indirectly, via `SelectedApp.app.bundleId` potentially holding a path.
- Produces: no new exports.

The bundle-mode default filename builds a segment via `bundleId.split('.').pop()`. For a path-identified app this produces a poor result (a fragment of the path, split on incidental dots, rather than a clean name). This task makes the split path-aware while leaving bundle-ID behavior unchanged (`.split(/[./]/).pop()` on `'com.example.app'` still yields `'app'`, identical to today).

- [ ] **Step 1: Write the failing test**

Create `src/lib/profiles.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/profiles.test.ts`
Expected: FAIL — the current `.split('.').pop()` on a path with no dots returns the whole path string, producing a filename like `PPPC-/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent.mobileconfig` (which `safeFilename` then mangles into a run of hyphens), not `PPPC-ninjarmm-macagent.mobileconfig`.

- [ ] **Step 3: Make the split path-aware**

Edit `src/lib/profiles.ts` — change:

```ts
    const appSegment = apps
      .map((a) => a.app.bundleId.split('.').pop())
      .filter(Boolean)
      .join('-');
```

to:

```ts
    const appSegment = apps
      .map((a) => a.app.bundleId.split(/[./]/).pop())
      .filter(Boolean)
      .join('-');
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/profiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Full regression check**

Run: `npm run build && npm test`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/profiles.ts src/lib/profiles.test.ts
git commit -m "fix: use the last path segment for a path-identified app's default filename"
```

---

## Task 6: "Path" badge in the app list

**Files:**
- Modify: `src/components/AppCard.tsx`

**Interfaces:**
- Consumes: `AppInfo.identifierType` (Task 1).

Mirrors the existing "Known" badge exactly, so a user isn't left looking at what appears to be a malformed bundle ID with no explanation. No component-test infrastructure exists in this repo; verified by the type-check build here, and visually in Task 7's end-to-end check.

- [ ] **Step 1: Add the badge**

Edit `src/components/AppCard.tsx` — change:

```tsx
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{item.app.displayName}</span>
              {item.isKnownApp && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  <ShieldCheck className="w-3 h-3" />
                  Known
                </span>
              )}
            </div>
```

to:

```tsx
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{item.app.displayName}</span>
              {item.isKnownApp && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  <ShieldCheck className="w-3 h-3" />
                  Known
                </span>
              )}
              {item.app.identifierType === 'path' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-medium">
                  Path
                </span>
              )}
            </div>
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppCard.tsx
git commit -m "feat: show a Path badge for path-identified apps"
```

---

## Task 7: End-to-end verification with the user's real file

**Files:** none (verification only).

**Interfaces:** none.

This is the feature's real acceptance test: re-import the actual file that motivated this work and confirm the whole chain — import, UI, both export formats — works correctly together, not just in isolated unit tests.

- [ ] **Step 1: Read the real file**

Read the file at:
`C:\Users\luke.steward\OneDrive - Techwyse\Documents\MacOS Permission Configs\NinjaOne - Full Disk Access.mobileconfig`

This is a real PPPC profile whose only entry identifies its app by path
(`/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent`,
`IdentifierType: path`) rather than bundle ID — the exact profile that
motivated this plan. Keep its content for Step 3.

- [ ] **Step 2: Start the dev server and open the app**

Run: `npx vite` via Bash with `run_in_background: true`. Confirm it's reachable (typically `http://localhost:5173`) via the browser tool's `preview_start` or `navigate`.

- [ ] **Step 3: Import the file and verify success**

The file input is a real `<input type="file" accept=".mobileconfig" class="sr-only">` hidden behind a styled label in the "Import Existing Profile" card. If the active browser toolset has no file-upload primitive (as was the case for the original mobileconfig-import feature's own end-to-end verification — check `.superpowers/sdd/` history or just try first), drive it the same way that verification did: dispatch a synthetic `DragEvent('drop', ...)` carrying a real `File`/`DataTransfer` payload (built from the content read in Step 1) at the drop-zone `<label>` element via the browser tool's JS-execution capability. This exercises the real `onDrop` handler, the real `importMobileconfig` parser, and the real `App.tsx` wiring — only the OS-level file-picker chrome is bypassed.

Confirm via the page's rendered text/DOM:
- An "ok" toast appears (not an error) — the import succeeded.
- The app list shows 1 app with the "Path" badge (Task 6) next to its name.
- The app's displayed identifier is the full path
  (`/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent`).
- The Full Disk Access permission is enabled (this file's only service is
  `SystemPolicyAllFiles` with `Allowed: true`).

- [ ] **Step 4: Verify the classic export**

With Classic format selected (or switch to it), read the generated `.mobileconfig` XML from the Preview panel's DOM. Confirm it contains:

```
<key>Identifier</key>
<string>/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent</string>
<key>IdentifierType</key>
<string>path</string>
```

- [ ] **Step 5: Verify the Settings Catalog export**

Switch format to Settings Catalog. Read the generated JSON from the Preview panel's DOM. Confirm it contains an `_identifiertype` setting instance whose `value` ends in `_1` (the `path` suffix), and that the `_identifier` simple setting's value is the full path string.

- [ ] **Step 6: Final regression check**

Run: `npm test && npm run build`
Expected: both succeed (17 tests from before this plan, plus the new tests from Tasks 1–5).

- [ ] **Step 7: Report**

Write a brief report of what was observed at each step above (pass/fail per sub-step, any deviation and why) — there is no code to commit for this task.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), importer acceptance (Task 2), classic generator (Task 3), Settings Catalog generator (Task 4), filename quality (Task 5), UI badge (Task 6), manual verification with the user's real file (Task 7) — all covered. Non-goals (manual entry, `KnownApp`, `App.tsx` dedup) correctly untouched by any task.
- **Type consistency checked:** `AppInfo.identifierType` (Task 1) flows unchanged through `AppOverlay.identifierType` (Task 2) into `StandardEntry`/`AppleEventsEntry.identifierType` (Task 3) and `ServiceAppRow.identifierType` (Task 4) — same `'bundleID' | 'path'` union throughout, matching the type already used by `AppleEventReceiver.identifierType`.
- **No placeholders:** every step contains complete, real code.
