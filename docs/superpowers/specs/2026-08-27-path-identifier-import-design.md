# Path-Identified Apps in mobileconfig Import

Status: Approved (design)
Date: 2026-08-27

## Problem

Apple's PPPC schema lets an app be identified either by bundle ID
(`IdentifierType: bundleID`) or by absolute file path
(`IdentifierType: path`) — the latter is used for binaries that have no
`CFBundleIdentifier` (e.g. NinjaOne's raw agent executable,
`/Applications/NinjaRMMAgent/programfiles/ninjarmm-macagent`).

The mobileconfig importer (`src/lib/mobileconfigImport.ts`) already accepts
both forms for AppleEvents *receivers*, but rejects any entry whose *sender*
app uses `path` — every service entry for a path-identified app is skipped
with a warning, and a profile containing only such entries fails to import
at all ("This profile has no importable PPPC entries."). This was a
deliberate scope decision in the original mobileconfig-import design
(`2026-08-27-mobileconfig-import-design.md`), made before real-world
profiles surfaced the gap.

Verified against a real file
(`NinjaOne - Full Disk Access.mobileconfig`) supplied by the user — the only
one of 24 real-world PPPC profiles that still fails to import after the
`Allowed`-boolean fix.

## Goal

Let the importer accept path-identified sender apps, and let both output
generators (classic `.mobileconfig` and Intune Settings Catalog) correctly
re-emit `IdentifierType: path` for such an app — so importing a
path-identified profile round-trips correctly end to end.

## Non-goals

- **Manual entry.** There is no way today to hand-build a path-identified
  app from scratch via "Select Application" (that flow only ever produces a
  bundle ID, from an `Info.plist` or the known-apps picker). This stays
  true — path-identified apps enter the workspace only via mobileconfig
  import. Adding a manual bundleID/path toggle to `AppInput.tsx` (mirroring
  `AppleEventReceiverEditor.tsx`'s existing pattern) is a separate,
  smaller follow-up if ever needed.
- **`KnownApp` / the known-apps library.** Always bundle-ID; unaffected.
- **App-level dedup logic in `App.tsx`.** Mobileconfig import replaces the
  whole workspace rather than merging into `handleAppDetected`'s dedup path
  (per the original design), so this feature needs no changes there.

## Design

### Data model

Add `identifierType: 'bundleID' | 'path'` to `AppInfo`
(`src/lib/types.ts`). The existing `bundleId: string` field keeps its name
and holds either a bundle ID or a path string — deliberately not renamed to
`identifier`, to avoid touching the ~16 files that already treat it as an
opaque string. `identifierType` defaults to `'bundleID'` everywhere except
the importer (`makeAppEntry`, known-app entries, manually-added apps all
stay bundle-ID-only, matching current behavior).

### Importer (`src/lib/mobileconfigImport.ts`)

The per-entry loop currently has:

```ts
if (identifierType !== 'bundleID') {
  warnings.push(
    `"${bundleId}" uses a path identifier for "${tccService}", which this tool doesn't support — skipped.`,
  );
  continue;
}
```

Change to accept both valid forms, matching the check already used for
AppleEvents receivers, and warn+skip only on a genuinely invalid value:

```ts
if (identifierType !== 'bundleID' && identifierType !== 'path') {
  warnings.push(
    `Entry for "${tccService}" has an invalid IdentifierType "${identifierType ?? ''}" — skipped.`,
  );
  continue;
}
```

`AppOverlay` gains an `identifierType: 'bundleID' | 'path'` field, captured
the same way `codeRequirement` already is (first entry seen for that
identifier wins — in practice every entry for the same identifier string
agrees). The built `AppInfo` carries this through.

This check is shared by both the standard-service and AppleEvents branches
(it runs before either), so AppleEvents senders become path-capable too, for
symmetry with receivers — even though no real-world example was found using
that combination.

### Generators

Both `src/lib/mobileconfig.ts` and `src/lib/settingsCatalog.ts` already
have a working `bundleID`/`path` distinction for AppleEvents *receivers*:
`settingsCatalog.ts` has `IDENTIFIER_TYPE_SUFFIX = { bundleID: '0', path: '1' }`
already indexed dynamically by `r.identifierType`; `mobileconfig.ts` emits
`r.identifierType` literally into `<key>AEReceiverIdentifierType</key>`.
Only the *app itself* (both the standard-entry `IdentifierType` and the
AppleEvents sender's own `IdentifierType`) is hardcoded to the `bundleID`
literal in both files. Both `StandardEntry`/`AppleEventsEntry`
(`mobileconfig.ts`) and `ServiceAppRow` (`settingsCatalog.ts`) gain an
`identifierType` field sourced from `SelectedApp.app.identifierType`, and
the two hardcoded-`bundleID` sites in each file read from it instead.

### Filename quality

`src/lib/profiles.ts`'s bundle-mode default filename builds a segment via
`a.app.bundleId.split('.').pop()`, which produces a poor result for a path
string (e.g. the whole path, or a fragment after some incidental dot).
Change the split to be path-aware (`/[./]/`) so a path-identified app still
contributes a reasonable filename segment (its last path component).

### UI

`AppCard.tsx` gains a small "Path" badge next to the app name — same visual
treatment as the existing "Known" badge — shown when
`item.app.identifierType === 'path'`, so a user isn't left looking at what
appears to be a malformed bundle ID with no explanation. No other UI
changes: the identifier display in `AppCard`/`PolicyList` is already plain
text and works unchanged for either form; there is no identity-editing UI
for either form today.

### Error handling

| Condition | Behavior |
|---|---|
| Sender `IdentifierType` is `bundleID` or `path` | Accepted, `identifierType` carried through |
| Sender `IdentifierType` is anything else (missing, typo, future value) | Skip entry, warning (unchanged shape, updated wording) |
| AppleEvents receiver `IdentifierType` | Unchanged — already accepts both |

## Testing

- `mobileconfigImport.test.ts`: a path-identified sender entry is accepted
  (using the exact NinjaOne shape that motivated this), `identifierType:
  'path'` appears on the resulting `AppInfo`; an entry with a genuinely
  invalid `IdentifierType` still warns and is skipped, with updated wording
  asserted.
- `mobileconfig.ts` / `settingsCatalog.ts`: neither file has any test
  coverage today (pre-existing, out of scope to retrofit broadly). Add
  narrowly-scoped new tests proving only the new branch — a path-identified
  `SelectedApp` produces `IdentifierType: path` (classic XML) /
  `..._identifiertype` value `1` (Settings Catalog) — without attempting
  full coverage of either generator.
- Manual verification: re-import the user's actual
  `NinjaOne - Full Disk Access.mobileconfig` and confirm it now succeeds,
  and that both export formats correctly represent the path identifier.
