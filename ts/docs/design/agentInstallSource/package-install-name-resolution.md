# Package Install Name Resolution

Status: proposed

## Motivation

`@package install` currently requires two positional values:

```text
@package install <agent-name> <ref>
```

The `ref` is overloaded by source kind. It can be a filesystem path, a feed package specifier, or a catalog key. For catalog installs this means the user often has to know both the friendly agent name they want and the catalog property key that points at the package. For feed installs the user must also choose an agent name even when the package already has an obvious default.

The goal is to make the common install path simple while preserving explicit control:

```text
@package install <target>
@package install <ref> <agent-name>
```

With one argument, TypeAgent infers the package and the installed agent name. With two arguments, the first argument identifies the package or path and the second argument is an explicit agent-name override.

## Goals

- Allow install by only a filesystem path, default agent name, or package name.
- Allow install with an explicit agent name override plus a filesystem path or package name.
- Remove the need for users to know catalog property keys in the common case.
- Keep source precedence deterministic and explainable.
- Keep source-specific package lookup inside install sources rather than in the command handler.

## Non-Goals

- Changing how installed agents are loaded after they are recorded in `agents.json`.
- Changing `@package update` or `@package uninstall` command syntax.
- Installing multiple agents from one package in one command.
- Making path sources enumerable.

## Current Design

The current flow is:

1. `InstallCommandHandler` parses required `name` and `ref` args.
2. The command validates `name` using `AGENT_NAME_RE`.
3. `InstalledAgentSourceApi.install(name, ref, sourceName, issuingHost, onStatus)` validates name availability.
4. The source registry resolves `ref` in source order using `InstallSource.find(ref)`.
5. The winning source materializes a nameless `MaterializedInstallRecord`.
6. The provider wrapper adds `name`, validates the agent provider, writes `agents.json`, and fans out the provider.

The important limitation is that sources only answer one question: "can this source resolve this ref?" They do not expose the agent name that should be used when the user omits one, and enumerable sources only list refs.

## User-Facing Behavior

### One Argument

```text
@package install <target>
```

Resolution runs in two phases; a default agent name always wins over a ref match:

1. Phase 1 - default agent name. Walk the install sources in configured priority order calling `findName(<target>)`. The first source whose `findName` matches wins. If a single source has two entries declaring the same default agent name, that source fails as ambiguous (see Ambiguity and Errors).
2. Phase 2 - ref. Only if no source matched in phase 1, walk the sources again in priority order calling `find(<target>)` (a filesystem path for a path source, a package name for a feed, a package name or entry path for a catalog). The first source whose `find` matches wins.

Because every source's `findName` is tried before any source's `find`, a stray `weather` directory under a path source can never shadow a feed package whose default agent name is `weather`: the feed's `findName` is consulted (phase 1) before the path source's `find` (phase 2). Within each phase, source priority order decides and the first match wins. That intra-phase shadowing is intentional (source order is a deliberate priority list); `@package install --dry-run` surfaces the full match set across both phases so an incidental shadow is visible.

The installed dispatcher name is always the selected package's own default agent name. In phase 1 that equals the typed target. In phase 2 (matched by ref) the name is read from the resolved package's `package.json` `typeagent.defaultAgentName`, which is the source of truth, so the one-argument installed name never diverges from the package's own default.

Examples:

```text
@package install ./agents/weather
@package install weather
@package install weather-agent
```

One-argument path installs require `typeagent.defaultAgentName` in the resolved package's `package.json`. The path source reads that package metadata during lookup, before materialization. If the path resolves but no legal default name can be discovered there, install fails with a message that explains the two-argument form.

### Two Arguments

```text
@package install <ref> <agent-name>
```

Resolution order:

1. Resolve `<ref>` using the existing source ref walk. Depending on the matching source, this can be a filesystem path or package name.

The second argument is always the installed dispatcher agent name. It overrides the package default. In this form, `<ref>` is not matched as a default agent name.

Examples:

```text
@package install ./agents/weather localWeather
@package install weather-agent teamWeather
@package install echo myEcho
```

The last example is only valid if `echo` resolves as a ref (a path or package name). Two-argument resolution never treats the first argument as a default agent name, so if `echo` is only a default agent name it fails as an unresolved ref.

### Source Filtering

`--source <source>` remains valid for both forms. It limits the candidate sources but does not change the matching rules.

`--refresh` fetches fresh source metadata and, on success, atomically replaces the cache-backed source's cached metadata. The existing cache is never deleted up front, so a failed refresh fetch leaves the prior cache intact. `--refresh` is most useful for feed sources, where one-argument default-name lookup depends on cached package descriptors. A `--refresh` that cannot fetch fresh metadata fails the command with the fetch error rather than silently falling back to the stale cache: the point of `--refresh` is to act on fresh data, so it never guesses from stale descriptors. Commands invoked without `--refresh` still serve whatever cache exists; only the explicit `--refresh` path turns a fetch failure into a command failure.

Examples:

```text
@package install weather --source workspace
@package install weather-agent myWeather --source typeagent
@package install weather --source typeagent --refresh
```

If `--source` names a path source, one-argument resolution simply falls through to the path source's normal path lookup.

## Default Agent Name

Four distinct "name" concepts coexist in this design. Keeping them separate is what makes the resolution rules well defined:

| Concept                   | What it is                                                   | Who types / uses it                                                | Durable?         |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------- |
| Catalog key               | The catalog's stable, source-owned entry identity            | Internal only (persisted `ref`, `load` handle)                     | Yes              |
| Package name              | The npm package name (`NpmAppAgentInfo.name`)                | User (as a phase-2 ref); shown in listings                         | Yes              |
| Default agent name        | `typeagent.defaultAgentName` in the package's `package.json` | User (as a phase-1 target); source of truth for the installed name | Yes (in package) |
| Installed dispatcher name | The name the agent is registered under in `agents.json`      | User sees it; equals the default name unless overridden two-arg    | Per install      |

Every installable package that wants to support one-argument install by agent name should expose one default dispatcher agent name.

The package metadata field should be named `typeagent.defaultAgentName` to avoid overloading the existing catalog `name` field, which means npm package name in `NpmAppAgentInfo`.

Recommended metadata locations:

- Package root: read `typeagent.defaultAgentName` from `package.json` after resolving the package root. This applies to path installs and catalog path entries.
- Feed: read `typeagent.defaultAgentName` from the selected package version metadata in the npm packument.

Default-name matching rule:

- If package metadata does not declare `typeagent.defaultAgentName`, that package does not match a default-agent-name lookup.
- A declared `typeagent.defaultAgentName` must be a legal agent name (`AGENT_NAME_RE`). An illegal declared default name is treated as no default name for matching and reported, so it never becomes an installed dispatcher name.
- A package with no default agent name can still be installed with the two-argument form when the second argument resolves as a path or package name.
- The `package.json` `typeagent.defaultAgentName` is the single source of truth for the installed name. A one-argument install never installs under a name the user did not effectively select: in phase 1 the target equals the default name; in phase 2 the name is read from the resolved package. Any cached copy of a default name (feed descriptors) is only a hint used to shortlist candidates, never the authoritative installed name.

Feed fallback:

- Feed packages should publish `typeagent.defaultAgentName` to support default-name matching.
- Phase 1 uses the cached descriptor's default name only to shortlist the package; the concrete version is then resolved and its `typeagent.defaultAgentName` must equal the typed target for the match to stand. If the resolved version has no default name (or it has drifted away from the target), that candidate does not match and resolution falls through. One-argument install by package name (phase 2) installs under the resolved version's default name; if the resolved version has no default name, it fails and the error suggests the two-argument form.

## Infrastructure Changes

### Source Lookup API

Keep `InstallSource.find(ref)` as the source's abstract ref lookup. The meaning of `ref` remains source-owned:

- Path source: filesystem path.
- Catalog source: package name or entry path. The catalog key is internal (the durable load handle persisted in the record's `ref`) and is never matched as a user-facing ref.
- Feed source: npm package specifier or package name.

Add one optional lookup for default agent names:

```ts
interface InstallSource {
  find(
    ref: string,
    onWarn?: SourceWarning,
  ): Promise<ResolvedCandidate | undefined>;

  findName?(
    name: string,
    onWarn?: SourceWarning,
  ): Promise<ResolvedCandidate | undefined>;

  materialize(candidate: ResolvedCandidate): Promise<MaterializedInstallRecord>;
}
```

`find(ref)` preserves today's explicit ref lookup (but for a catalog it now matches the package name or entry path, not the internal key). `findName(name)` matches `typeagent.defaultAgentName`. Sources that cannot support default-name lookup omit `findName`. The `package.json` reads behind `findName` for catalog entries and path installs are read-through (re-read on each install), so the authoritative default name is always current; only the completion/listing path caches derived rows (see Command Completion and Listing) and the feed descriptor list is cached (rebuilt with `--refresh`). One-argument install resolves in two phases: it walks every source's `findName` first (priority order, first match wins), then, only if nothing matched, every source's `find`. The only ambiguity failure is within a single source when two entries declare the same default agent name.

### Resolved Candidate

Extend `ResolvedCandidate` with the default name and the user-facing package identity:

```ts
export interface ResolvedCandidate {
  source: string;
  module?: string;
  ref?: string;
  path?: string;
  version?: string;
  loaderConfig?: Record<string, unknown>;
  defaultAgentName?: string;
  packageName?: string;
}
```

Rules:

- `defaultAgentName` is required whenever the install name is inferred, including path installs.
- `packageName` is the npm package name for catalog and feed matches. It is omitted for path-only matches.
- `ref` remains the durable update/load handle: feed specifier for feed, catalog key for catalog entries, and path for path installs. It is internal identity, not a user-facing match target: one-argument resolution matches on default agent name (phase 1) or package name / path (phase 2), never on a durable `ref` the user would have to know.

### Registry Resolution API

Replace the current materializing `resolve(ref, sourceName, onWarn, onStatus)` install path with a single non-materializing install resolver. The command handler owns command arity and turns it into an explicit request shape; the registry owns source resolution and never guesses intent from an optional string:

```ts
type InstallResolveRequest =
  | { kind: "infer"; target: string }
  | { kind: "explicit"; ref: string; installName: string };

type InstallMatchKind = "defaultAgentName" | "packageName" | "path";

interface InstallResolution {
  source: InstallSource;
  candidate: ResolvedCandidate;
  installName: string;
  matchKind: InstallMatchKind;
  explicitName: boolean;
}

resolveInstall(
  request: InstallResolveRequest,
  sourceName?: string,
  onWarn?: SourceWarning,
  onStatus?: SourceStatus,
): Promise<InstallResolution>;
```

The provider wrapper should continue to be the layer that checks builtin/name collisions, materializes the winning candidate, validates the provider, persists the record, and fans out the provider. The registry resolves source-owned candidates and returns the final installed dispatcher name. `@package install` and `@package install --dry-run` both consume the same `InstallResolution`, so preview and install cannot drift.

Internally, the registry can still keep private helper walks. The existing private ref walk scans the configured source list in order and calls `source.find(ref)` for explicit two-argument installs. Add a sibling source-first resolver for one-argument inferred installs:

```ts
async function walkInferName(
  target: string,
  sourceName?: string,
  onWarn?: SourceWarning,
  onStatus?: SourceStatus,
): Promise<{ source: InstallSource; candidate: ResolvedCandidate } | undefined>;
```

`walkInferName` resolves in two phases. Phase 1: scan the configured source list in priority order calling `source.findName?.(target)`; the first source that matches wins. If one source has two entries with the same default agent name, that source fails as ambiguous and the error lists the concrete candidate packages. Phase 2 (only if phase 1 matched nothing): scan again calling `source.find(target)`; the first source that matches wins. A default agent name (phase 1) always beats a ref match (phase 2). Explicit source filtering runs the same two-phase walk over a one-source list; it changes the candidate set, not the matching rules. The resolver records `matchKind` from the winning lookup path so success and dry-run output can explain whether the target matched a default agent name, package name, or path.

## Resolution Algorithm

Pseudo-code for the single public resolver:

```ts
async function resolveInstall(request, sourceName) {
  switch (request.kind) {
    case "infer": {
      const match = await walkInferName(request.target, sourceName);
      if (match === undefined) {
        throw unresolved(request.target);
      }
      return {
        source: match.source,
        candidate: match.candidate,
        installName: requireLegalDefaultName(match.candidate, request.target),
        matchKind: inferMatchKind(match.candidate, request.target),
        explicitName: false,
      };
    }
    case "explicit": {
      validateAgentName(request.installName);
      const match = await walkRef(request.ref, sourceName);
      if (match === undefined) {
        throw unresolved(request.ref);
      }
      return {
        source: match.source,
        candidate: match.candidate,
        installName: request.installName,
        matchKind: inferRefMatchKind(match.candidate, request.ref),
        explicitName: true,
      };
    }
  }
}
```

The public resolver throws on no match. There is no path-specific branch: path sources simply omit `findName`, so inferred-name resolution falls through to their existing `find(ref)` path lookup. The command handler decides arity once, before calling the resolver: one argument becomes `{ kind: "infer", target }`; two arguments become `{ kind: "explicit", ref, installName }`. This keeps the rule that explicit installs never consult default agent names visible in the type shape.

### Install Commit Flow

Install remains two-phase:

1. Resolve the package candidate and final installed dispatcher name without materializing package contents.
2. Validate the final installed name and check built-in and existing-agent collisions.
3. Materialize the candidate through the winning source.
4. Build and validate the provider manifest.
5. Persist the `agents.json` record and fan out the provider.

The important change is that phase 1 may infer the name. All name collision checks still happen before materialization, so a bad inferred name, built-in collision, or existing installed agent fails without touching disk or the feed. Steps 1, 2, and 5 (resolve, derive name, collision check, and the `agents.json` write) run inside the installer's shared serialize-to-one limiter, so no early name reservation is needed - see Install Serialization. If the implementation later narrows the limiter so materialization can run concurrently, it must replace the broad limiter with an equivalent per-name reservation made immediately after name derivation and before materialization.

### Install Serialization

Concurrency scope: a single instance directory is owned by exactly one dispatcher process (enforced by the instance-dir lock), so `agents.json` is only ever mutated from one process. Concurrency is therefore purely in-process - multiple sessions in one agent-server host issuing `@package install` - and needs only in-process serialization. There is no cross-process file-lock requirement.

One-argument installs do not know the final installed name until after resolution (for feed, after the registry reads the resolved version's `typeagent.defaultAgentName`). Rather than reserve a name before it is known, install runs resolve -> derive installed name -> collision check -> `agents.json` write inside the installer's existing serialize-to-one limiter (`createLimiter(1)`). A second install cannot enter that critical section until the first has committed its record, so the in-limiter existing-agent check catches any collision - including two one-argument installs that resolve to the same inferred name. No early name reservation is required, which is what makes inferred names safe, and it also covers the two-argument path.

The limiter is not optional unless an equivalent reservation mechanism replaces it. Without one, two concurrent installs can both resolve to the same inferred dispatcher name, both observe that `agents.json` does not contain the name, then both materialize and race to write or fan out providers. The current single-process ownership guarantee removes the need for a cross-process file lock, but it does not remove the need for in-process serialization across concurrent sessions in the same dispatcher host.

The per-name `busy`/`removing` guard is kept, but only for the lifecycle window the limiter does not cover. `update` and `uninstall` run a long asynchronous barrier drain across sessions that outlives the limiter's synchronous critical section, and the name must stay locked for that whole drain so a new op cannot start on a name that is still tearing down. So the division of labor is: the limiter provides install-vs-install atomicity (resolve + name derivation + collision check + write), and `busy`/`removing` provide per-name mutual exclusion across the async drain of a prior `update`/`uninstall`.

## Source Behavior

### Path Source

- Supports `path` matching only.
- Implements `find(ref)` for filesystem paths.
- Does not implement `findName`.
- Reads `typeagent.defaultAgentName` from the resolved directory's `package.json` lazily - only when a name must be inferred (one-argument install). The two-argument form skips the read entirely. So `find` stays a `stat`, plus this one metadata read when (and only when) the caller needs an inferred name.
- `find` never fails on `package.json`: a missing, unreadable, or unparseable `package.json` (or a missing / illegal `typeagent.defaultAgentName`) simply yields a candidate with no `defaultAgentName`, so the two-argument form (explicit name) still resolves. Only the one-argument resolver treats a missing default name as an error.
- If the path resolves but no legal default name can be discovered from `package.json`, one-argument install fails with a message that explains the two-argument form. Provider validation still performs the deeper manifest validation after name selection.

### Catalog Source

The catalog format is unchanged: it keeps the keyed `agents` map, so the catalog key remains the durable `ref` and the `load` "live pointer" behavior (re-look-up the entry by its key) is preserved. The key is now purely internal: it is never matched as a user-facing install target. Users install a catalog entry by its default agent name (phase 1) or by its package name / path (phase 2), never by the key.

> Why the catalog key still exists (do not remove it): the key is the catalog's stable, source-owned identity for an entry, decoupled from both the package name and the default agent name so that:
>
> - It is the durable `ref` persisted in each installed record. `load` re-resolves an entry by key, so a catalog author can change an entry's `path`, package `name`, or `typeagent.defaultAgentName` and existing installs keep resolving. Deriving `ref` from the package path or package name instead would break already-installed records and turn a catalog entry into a plain path record, losing the live-pointer property.
> - It keeps entry identity unique and stable when two entries would otherwise collide on package name or default agent name (for example, two variants of the same package), which is what lets the same-source ambiguity check be well defined.
>
> The key is not a user-facing match target: users never need to know it. Install by default agent name (`findName`) or by package name / path (`find`) covers every user path, while the key keeps the identity and live-pointer guarantees above.

```json
{
  "description": "Workspace catalog of non-bundled agents",
  "agents": {
    "androidMobile": { "path": "androidMobile" },
    "echo": { "path": "../../examples/agentExamples/echo" },
    "measure": { "path": "measure" },
    "vampire": { "path": "vampire", "execMode": "separate" }
  }
}
```

`execMode` remains optional loader metadata.

For each catalog entry:

- Durable `ref`: the catalog key (unchanged; `load` re-looks-up by key; internal only).
- Resolution handle: entry `path` (relative paths resolve against the catalog dir) or package `name` (-> module), exactly as today.
- Default agent name: `packageJson.typeagent.defaultAgentName`, read from the entry's resolved `package.json` when available.

Supported lookups:

- `find(ref)`: match the entry `path` or package `name`, not the internal key. Used for two-argument ref installs and as the one-argument phase-2 fallback.
- `findName(name)`: match `packageJson.typeagent.defaultAgentName`, read read-through from the entry's resolved `package.json`. If no default name is declared or the metadata is unreadable, the entry is a non-match for this method.

A catalog entry resolves to a local `path` or, when it declares only a package `name`, to a `module`. `findName` reads the entry's `package.json` from the resolved `path`; a `module`-only entry has no local `package.json` to read before install, so it cannot participate in `findName` (it is a non-match for name lookup and remains installable by package name or with the two-argument form). In practice the workspace catalog entries all carry a `path`, so this only affects hypothetical package-name-only catalog entries.

There is no `find`/`findName` collapse: one-argument resolution is two-phase, so a catalog entry is matched either by default agent name (phase 1) or by package name / path (phase 2), never by both competing. The only intra-catalog ambiguity is two entries declaring the same default agent name.

Because keys are retained, catalog records still store the key in `ref`, so already-installed catalog agents load unchanged and there is no persisted-record migration. The `package.json` reads behind `findName` are read-through on each install (the catalog file is already re-read live on every access, so the entry's metadata stays consistent with it). The completion/listing path caches its derived rows separately (see Command Completion and Listing) so interactive completion does not read every entry's `package.json` per keystroke.

### Feed Source

Supported lookups:

- `find(ref)`: same package membership and version resolution as current `find(ref)`.
- `findName(name)`: use the cached descriptors only to shortlist the package whose default agent name equals `name`, then run the same version resolution as ref lookup. The cached default name is a hint, never authoritative: after the concrete version is resolved, its `typeagent.defaultAgentName` must equal `name` for the match to stand, and that resolved value becomes the installed name. A stale or drifted cache therefore never installs under a surprising name - it just fails to match and resolution falls through.

Feed lookup should use a descriptor cache instead of a bare package-name list. The cache should evolve from `string[]` to package descriptors:

```ts
export interface FeedAgentPackageCache {
  readonly fetchedAt: number;
  readonly packages: FeedAgentPackageInfo[];
}

export interface FeedAgentPackageInfo {
  readonly packageName: string;
  readonly defaultAgentName?: string;
  readonly latestVersion?: string;
}
```

The cache is source-scoped and should be stored as one file per feed source, as today, but each package entry carries the metadata needed for completion and inferred-name matching. Cache refresh should update the package list and package descriptors together so `@package available`, completion, package-name lookup, and default-name lookup all see the same snapshot.

When the cache is missing or expired, feed lookup refreshes the descriptor cache before matching, serving the prior cache if the refresh fetch fails. `--refresh` fetches into a temporary cache and atomically swaps it in only on success, so the existing descriptors are never destroyed by a failed fetch. A `--refresh` whose fetch fails leaves the prior descriptors in place and fails the command with the fetch error rather than guessing from stale data. Old `string[]` cache files are treated as package names with no default name and upgraded to descriptors on the next successful refresh.

## Ambiguity and Errors

Ambiguity should fail before materialization.

Cases:

- A single source has multiple entries with the same default agent name and cannot choose one deterministically. The error lists the concrete candidate packages and suggests the two-argument form for each.
- The inferred default agent name is illegal (fails `AGENT_NAME_RE`).
- The inferred or explicit agent name already exists or shadows a built-in agent.
- One-argument path install cannot discover a legal default agent name.

Cross-source matches are not ambiguous. Install sources are ordered, and the first source that returns a match wins, same as today's ref resolution. The only one-argument ambiguity is within a single source: two entries declaring the same default agent name (phase 1). Because resolution is two-phase - every source's `findName` before any source's `find` - a target is never simultaneously a name match and a ref match competing for the same install; the name interpretation always wins, so there is no name-vs-ref ambiguity to resolve.

Source order is a deliberate priority list, so a higher-priority source shadowing a lower-priority one within the same phase is intentional, not an error. Two-phase resolution removes the worst case (a path source's `fs.stat` shadowing a real default-name match), because default-name matching happens in phase 1, before any `find`. Remaining same-phase shadows (two feeds both matching a name, or two sources both matching a ref) are resolved by priority; `@package install --dry-run` reports every source that would match, in priority order across both phases, so an incidental shadow is visible, and `--source` forces a specific source.

Error messages should include the next usable command. Examples:

```text
Source 'workspace' has multiple packages with default agent name 'weather': weather-agent, weather-preview-agent. Use '@package install weather-agent <name> --source workspace' or '@package install weather-preview-agent <name> --source workspace'.
```

```text
'./agents/weather' resolved as a path, but no default agent name could be discovered. Use '@package install ./agents/weather <name>'.
```

## Command Completion and Listing

`@package available` displays only what can be passed to `@package install` - the default agent name and the package name - never the internal catalog key/ref:

```text
Name          Package                   Source
weather       @typeagent/weather-agent  typeagent
echo          echo                      workspace
```

Completion changes:

- For one-argument `target`, complete default agent names, package names, and source paths when available.
- For the first argument, complete default agent names and package names.
- For the second argument, do not complete refs; it is the explicit installed agent name.
- Keep `--source` completion unchanged.
- `@package available --refresh` should refresh cache-backed source metadata before listing rows.

This likely requires changing `listAvailableAgents()` from `{ ref, source }[]` to a richer row:

```ts
export interface AvailableInstallRow {
  readonly source: string;
  readonly ref: string; // internal durable/identity handle; used only for dedup, never displayed
  readonly defaultAgentName?: string; // shown as the install name; absent if the package declares none
  readonly packageName?: string; // shown as the package; absent for path-only entries
}
```

`ref` is required (every enumerable entry has a durable handle) but is never rendered - it exists only as the dedup/identity key. The invariant is that at least one of `defaultAgentName` / `packageName` is present, so every row has something typeable into `install`. Rows are de-duplicated by `(source, ref)`, since one source can surface the same entry under both its default agent name and its package name. Displayed columns are the default agent name (or `-` when the package declares none), the package name (or `-` for path-only entries), and the source.

Dry-run resolution should be a `--dry-run` (`-n`) flag on `@package install`, and it should be the only resolution-preview command. `@package install --dry-run <target>` (or `<ref> <name>`) runs the exact same one-argument / two-argument resolution and reports the winning source, the match kind, and the name it would install as. It additionally lists every other source that would match, in priority order across both phases, so an intentional shadow is visible. Dry-run makes no install changes: nothing is materialized and `agents.json` is not written. (`--refresh` may still rewrite a cache-backed source's cache, since that is metadata, not an install.) Reusing install's own parameters, completion, and errors means the preview can never drift from what install actually does.

The former `@package source where <ref>` command is removed. Because the second install argument is optional, one-argument `@package install --dry-run <target>` is a strict superset of what `where` did: it reports the winning source, the match kind, and the full match set, using the exact resolver install uses. Keeping a second command that re-runs the resolver is exactly the drift risk `--dry-run` is meant to avoid, so it is dropped rather than kept as an alias. `@package install --dry-run --refresh` refreshes cache-backed source metadata before previewing.

## User Feedback

Because one-argument install accepts both default agent names and package refs, successful commands should show what matched and what will be installed. The user should not have to infer whether a target was interpreted as a default agent name, package name, or path.

Install success should include:

- Installed dispatcher agent name.
- Matched source.
- Matched kind: default agent name, package name, or path.
- User-facing package identity when available.
- Durable ref when it differs from the package identity.

Example success messages:

```text
Agent 'weather' installed from package '@typeagent/weather-agent' via source 'typeagent' (matched default agent name).
```

```text
Agent 'teamWeather' installed from package '@typeagent/weather-agent' via source 'typeagent' (explicit name override).
```

`@package install --dry-run` should show the same resolution facts without installing:

```text
'weather-agent' would resolve via source 'workspace' as package 'weather-agent' and install as 'weather'.
```

Errors should also make the next usable command explicit when the shorthand is not enough. In particular, one-argument package-name matches without a legal default agent name should suggest the two-argument form. Two-argument resolution never consults default agent names: the first argument is resolved only as a ref, so a first argument that is merely a default agent name simply fails as an unresolved ref.

Feed cache errors should say whether resolution used fresh metadata, stale cached metadata, or no usable cache. When a feed lookup fails because the descriptor cache may be stale, the error should suggest retrying with `--refresh`.

## Breaking Changes

Note: `@package install` (and the `@package` source commands) are new and not yet released, so none of the items below break real users or existing scripts - there is no prior released behavior to be compatible with. They are recorded here only as differences from the interim in-development shape of the command, not as compatibility hazards.

- The command syntax changes from `<agent-name> <ref>` to `<ref> <agent-name>` for two-argument installs. Because the command is new, this is not a compatibility concern (the earlier order was never released).
- The catalog key is no longer accepted as a user-facing install ref. Previously (in development) `@package install <catalog-key> <name>` resolved a catalog entry by key; now a catalog entry is installed by its default agent name or its package name / path. (Already-installed catalog records still carry the key in `ref` and load unchanged.)
- `@package source where` is removed; `@package install --dry-run` replaces it.
- The catalog file format is unchanged (keys retained internally), so catalogs and already-installed catalog records need no migration.

## Implementation Plan

1. Add `defaultAgentName` and `packageName` to `ResolvedCandidate`.
2. Keep `InstallSource.find(ref)` as the source's abstract ref lookup and add optional `findName(name)` for default-agent-name lookup.
3. Keep the catalog `agents` keyed format; add `findName` that reads `typeagent.defaultAgentName` read-through from each entry's resolved `package.json`, and change `find` to match the package name or entry path (the catalog key stays internal as the durable `ref`/load handle, no longer a user ref).
4. Update feed source cache and lookup to expose package descriptors with default names; use the cache only to shortlist a `findName` candidate and take the final installed name from the resolved version's metadata, which must equal the typed target.
5. Add a `--refresh` flag (fetch fresh metadata, atomically swap the cache in on success, and fail the command on fetch error without destroying the prior cache) for install and `@package available`.
6. Replace the materializing registry install resolver with one `resolveInstall(request, sourceName, ...)` API. The request is an explicit union: `{ kind: "infer"; target }` for one argument or `{ kind: "explicit"; ref; installName }` for two arguments.
7. Keep private registry walks underneath `resolveInstall`: a ref walk for explicit installs and a two-phase inferred-name walk that matches `findName` across sources in priority order first, then `find` if nothing matched; fail ambiguous only when one source has two entries with the same default agent name.
8. Change `InstalledAgentSourceApi.install` to accept the same explicit install request shape instead of required `name` and `ref` strings.
9. Change `InstallCommandHandler` args so the second name argument is optional, parse one-argument versus two-argument form once, and delegate the explicit request shape to the source API.
10. Add a `--dry-run` flag to `@package install` that runs the same `resolveInstall` path and reports the winning source, match kind, and inferred install name without materializing or persisting; remove the `@package source where` command, since `--dry-run` supersedes it.
11. Update install success messages and `@package install --dry-run` output to show match kind, package identity, source, and installed name.
12. Update `@package available` and completion to use richer available rows (name + package only, never the key), backed by a short-TTL cache of derived rows refreshable via `--refresh`.
13. Add tests for path refs, default-name matching, package-name matching, two-phase precedence (a `findName` match beats a path `find`), explicit name override, source filtering, read-through `findName` vs cached completion rows, cache refresh, user feedback text, `install --dry-run` (including the shadow match set), ambiguity, in-process install serialization via the limiter, and breaking changes.

## Test Matrix

| Case                             | Command                                               | Expected                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One arg path                     | `@package install ./agents/weather`                   | Path source has no name lookup; ref lookup resolves the path and installs using `typeagent.defaultAgentName`.                                                          |
| One arg catalog default name     | `@package install echo`                               | `findName` matches the entry's default agent name `echo`; installs as `echo`.                                                                                          |
| One arg catalog key not matched  | `@package install echoKey`                            | The catalog key is internal; `echoKey` is neither a default name nor a package name, so it fails as unresolved.                                                        |
| One arg findName beats path find | `@package install weather`                            | A `weather` directory exists under a higher-priority path source AND a feed default name `weather` exists; the feed wins (phase 1 `findName` precedes phase 2 `find`). |
| One arg multi-source match       | `@package install weather`                            | Target matches in multiple sources within one phase; the first source in priority order wins (not ambiguous).                                                          |
| One arg package without default  | `@package install no-default-agent`                   | Fails and suggests `@package install no-default-agent <name>`.                                                                                                         |
| One arg feed default             | `@package install weather`                            | Matches feed metadata default and installs as `weather`.                                                                                                               |
| One arg feed package             | `@package install @typeagent/weather-agent`           | Matches package name and installs as feed default name.                                                                                                                |
| Two arg path                     | `@package install ./agents/weather myWeather`         | Installs path as `myWeather`.                                                                                                                                          |
| Two arg package                  | `@package install @typeagent/weather-agent myWeather` | Installs package as `myWeather`.                                                                                                                                       |
| Two arg default-name only        | `@package install weather myWeather`                  | Fails as unresolved ref unless `weather` resolves as a ref (path/package name); default names are not consulted.                                                       |
| Built-in collision               | `@package install list` where `list` is built-in      | Fails before persistence.                                                                                                                                              |
| Source filter                    | `@package install weather --source workspace`         | Searches only `workspace` by default-name lookup and then ref lookup.                                                                                                  |
