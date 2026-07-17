# TypeAgent Default Agent Provider

The default agent provider used by the [shell](../shell) and [CLI](../cli). It include the built in agents included in this repo and external agent provider.

## Test agents

The provider also registers a small set of agents whose only purpose is to exercise dispatcher subsystems — disabled by default in production sessions:

- [`vampire`](../agents/vampire) — deliberately collides with other agents (`play`, `addItems`, `removeItems`, `getList`, `createCalendarEvent`) to exercise the dispatcher's [action collision detection](../dispatcher/dispatcher/README.md#action-collision-detection) subsystem. Default-disabled; enable via session config when evaluating collision-resolution strategies.

## Accessing non-bundled agents

Some agents are intentionally not bundled in the default provider profile and should be installed on demand from the workspace catalog source.

```text
@package install androidMobile
@package install vampire
```

Catalog source entries for these agents are defined in [../agents/agents.catalog.json](../agents/agents.catalog.json).

If install fails because the catalog source is missing, run:

```text
@package source list
```

## Managing installed agents (`@package`)

The `@package` commands install, update, and remove agents from the configured
install sources at runtime. They operate only on **installed** agent records —
built-in, inline, system, and MCP agents are managed elsewhere and are not shown
or modified by these commands. (Per-command usage, arguments, and flags are
listed in the auto-generated [command reference](../../docs/overview/command-reference.md);
the semantics below are the operator-facing details.)

### `@package list`

Lists installed agent records only. Each entry includes the agent name, the
source it was installed from, and the recorded handle when available.

### `@package install <target> [<name>]`

With one argument, TypeAgent infers both the package and the installed agent
name: a legal agent name is first matched against each source's default agent
name (`typeagent.defaultAgentName`), then, if unmatched, the argument is resolved
as a package name or filesystem path and the installed name is read from the
resolved package. With two arguments, the second argument is the explicit
installed name and overrides the package default. An explicit name must be a
legal dispatcher agent identifier and must not already be in use by any
installed, built-in, system, inline, or MCP provider. A source that matches owns
the install: if materialization fails, TypeAgent reports that failure instead of
silently falling through to later sources.

- `--source <sourceName>` resolves only against the named install source.
  Without it, TypeAgent walks the configured source order and uses the first
  source that resolves the target.
- `--dry-run` (`-n`) previews how the target would resolve (winning source, match
  kind, installed name, and the full shadow set) without installing.
- `--refresh` (`-r`) refreshes cache-backed source metadata (feed descriptor
  caches) before resolving; a fetch failure fails the command rather than acting
  on stale data.

### `@package update <name> [<range>]`

Updates re-resolve the installed record against its recorded source. Feed agents
move to the newest matching version (optionally constrained by a `<range>` such
as `^1.4`, `~2.0`, or `>=3 <4`), path agents refresh from their recorded path,
and catalog agents are looked up again by short name. If the recorded source is
no longer configured, the installed agent can still load at runtime, but update
fails until the source is added back or the agent is uninstalled.

### `@package uninstall <name>`

Removes the installed record and unloads the live agent from connected
dispatchers. Feed package roots are reclaimed by best-effort garbage collection
and startup orphan cleanup rather than by a synchronous `npm uninstall`.

### `@package source list | order | add | remove`

```text
@package source list
@package source order <name>...
@package source add feed <name> [--registry <url>] [--scope <scope>]...
@package source add catalog <name> --catalog <path>
@package source add path <name> [--baseDir <path>]
@package source remove <name> [--force]
```

Install sources are tried in configured order. To preview which source would
resolve a target without installing, use `@package install --dry-run <target>`.
`order` moves named sources to the front and keeps the rest in their current
relative order. `add` appends a source after validating its configuration.
`remove` refuses to remove a source still referenced by installed agents unless
`--force` is supplied; forced removal keeps already-installed agents loadable but
blocks future updates for those records until the source is re-added.

Feed sources install from Azure Artifacts npm feeds. If `--registry` and
`--scope` are omitted, the source reads `TYPEAGENT_FEED_REGISTRY` and
`TYPEAGENT_FEED_SCOPES` from the host environment at resolve time and resolves
nothing while they are unset.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
