# Skill Catalog

`@typeagent/skill-catalog` is a focused local catalog and deterministic
grammar-routing core. It stores data through the structural `InstanceStorage`
interface, so a future host can pass TypeAgent's `SessionContext.instanceStorage`
without an adapter. The package indexes and translates requests but never
executes actions.

## Catalog

`SkillCatalog` publishes content-addressed, immutable revisions. A revision has
an origin-qualified identity (`scope:origin:name`), schema fingerprint, and a
complete file manifest containing SHA-256 and byte size. Publication writes to
a hidden staging area, copies immutable content, publishes revision metadata
last, and then updates the catalog index. Readers never inspect staging data.
The supplied storage implementation must make individual `write` operations
atomic, as TypeAgent instance storage does.

Lifecycle operations support `draft`, `validated`, `approved`, `active`,
`disabled`, and `archived`. `activate` maintains one active revision pointer;
`rollback` atomically repoints it to an approved older revision. Package paths
are relative forward-slash paths and reject traversal, absolute paths, empty
segments, backslashes, and drive prefixes.

`search` performs case-insensitive exact identity/name/display-name matching.
When exact search misses, callers may supply an asynchronous
`SemanticSkillSearch`; the catalog remains embedding-provider independent.

## Acquisition and updates

`SkillAcquirer` safely stages external content and publishes it through
`SkillCatalog`; providers cannot activate or execute a skill. Built-in providers
support an explicitly named local directory, a Git repository and ref through
the installed `git` CLI, and local ZIP, TAR, or gzip-compressed TAR archives.
Every operation uses a UUID-named directory below the caller-supplied absolute
`stagingRoot` and removes it after success or failure.

Before publication, acquisition rejects symbolic links, junctions, Git links
and submodules, archive links and devices, executable modes and common
executable extensions, package scripts/binaries, repository metadata, unsafe
absolute/traversal/device/ADS paths, Unicode case-fold collisions, malformed
archives, and limit violations. The default limits cover archive bytes,
expanded bytes, individual files, file count, path/frontmatter length, process
output, and process duration. A root UTF-8 `SKILL.md` with scalar YAML
frontmatter is required; its valid Agent Skills `name` must match the requested
catalog identity and it must have a non-empty `description`.

Git is invoked without a shell and package content is produced with
`git archive`, so checkout filters and package hooks are never run.
`BoundedProcessRunner` is the default process implementation; callers may
inject `ProcessRunner` and custom providers. Tests use only local repositories
and never access the network.

Each acquired revision records a sanitized source description, source
fingerprint (Git commit, archive SHA-256, or directory manifest digest), and
complete manifest digest. `checkForUpdate` stages and compares both
fingerprints without publishing. `update` publishes when the source, content,
requested schema, or display metadata changes. Older revisions remain immutable
and available to the existing lifecycle and `rollback` APIs.

## Grammar routing

`SkillGrammarIndex` compiles `GrammarJson` with
`@typeagent/action-grammar` directly, independent of the dispatcher. Each
immutable `RoutingSnapshot` is content-addressed over its skill revision,
schema fingerprint, rule source, and grammar. Rule sources have deterministic
precedence:

1. `contextOverlay`
2. `userCorrection`
3. `generated`
4. `package`

`match` returns an explicit `match`, `miss`, `ambiguous`, or `invalid` outcome.
Equivalent matches from the same skill revision and schema are deduplicated;
equal action values for different skills remain ambiguous. A caller-supplied
`SchemaValidator` validates every distinct result.

`route` supports `grammarFirst`, `grammarOnly`, `hybrid`, and `shadow`.
Fallback routing is an interface only and performs no execution. User
corrections are persisted by `SkillCorrectionStore` under a separate storage
tree and can be added to a future snapshot as `userCorrection` rules.

`LiveSkillCatalog` is the host-facing integration. It loads every `*.ag.json`
artifact from active revisions, overlays corrections for that exact revision
and schema fingerprint, and publishes an immutable routing snapshot before
updating the current snapshot pointer. Publishing or changing lifecycle state
rebuilds the snapshot under the same serialized mutation boundary; startup
rebuilds it from persisted packages and corrections. A unique valid grammar
match is ranked before lexical or semantic catalog results. Ambiguous, invalid,
or missed matches use normal catalog search and retain routing diagnostics.
This selects a skill revision only; authorization and execution remain host
responsibilities.

## Main APIs

- `SkillCatalog.publish/get/readFile/list/search/transition/activate/rollback`
- `SkillCorrectionStore.add/list/grammarRules`
- `SkillGrammarIndex.buildSnapshot/getSnapshot/match/route`
- `LiveSkillCatalog.create/search/routeGrammar/addCorrection/rebuild`
- `SkillAcquirer.acquireAndPublish/checkForUpdate/update`
- `LocalDirectorySkillProvider`, `GitSkillProvider`, `ArchiveSkillProvider`
- `BoundedProcessRunner` and injectable `ProcessRunner`
- `qualifySkill` and `validateSkillPath`
