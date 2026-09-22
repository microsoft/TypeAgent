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

## Main APIs

- `SkillCatalog.publish/get/readFile/list/search/transition/activate/rollback`
- `SkillCorrectionStore.add/list/grammarRules`
- `SkillGrammarIndex.buildSnapshot/getSnapshot/match/route`
- `qualifySkill` and `validateSkillPath`
