---
layout: docs
title: Agent Install Sources
---

The TypeAgent [Shell](../../../ts/packages/shell) and [CLI](../../../ts/packages/cli)
install application agents through **install sources**. A source describes _where_ an
agent can come from, and every installed agent records the source it was installed from.
This page is the command reference for the `@package` command group: `@package install`,
`@package update`, `@package uninstall`, `@package list`, and `@package source`.

If you just want to get a first agent running, follow the
[Creating an Agent](../tutorial/agent.md) tutorial — it uses a local `path` source and
the basic `@package install` command. This page covers the rest.

All install-related commands live under a single `@package` umbrella (each agent loads
from an underlying package — an npm module or a local path). The group is available
whenever the client has an agent installer; `@package` on its own defaults to
`@package list`.

## Source kinds

There are three kinds of install source:

- **`path`** — a local directory on disk (a built agent package). Used during
  development and for installing an agent you authored locally.
- **`catalog`** — a named list of agents resolved by short name. The shell ships with a
  bundled catalog; you can add your own.
- **`feed`** — an npm-style package registry, resolved by package specifier (for
  example `echo-agent@^1.2`).

Each configured source has a unique **name**. Names are what you pass to `--source` and
to the `@package source` commands.

## Resolution order

When you run `@package install <name> <ref>` without naming a source, the configured
sources are tried **in priority order** and the **first source that can resolve `ref`
wins**:

- A `ref` that exists on disk is claimed by a `path` source.
- A short name is claimed by a `catalog` source.
- A package specifier is claimed by a `feed` source.

Ordering is purely positional — there is no path/specifier heuristic beyond which source
matches first. Putting a local `path` source ahead of a `feed` source makes a local
agent shadow the published one automatically. Use `@package source list` to see the
current order and `@package install --where` to preview which source would win for a
given `ref`.

## `@package list`

```
@package list
```

Lists the agents you have installed (the recorded installs only — not the built-in,
system, or MCP agents). Each entry shows the agent name, the source it was installed
from, and the handle it resolves through (a feed specifier, package name, or path).
`@package` with no subcommand runs `@package list`.

## `@package install`

```
@package install <name> <ref> [--source <sourceName>] [--where]
```

- `<name>` is the dispatcher agent identifier to register. It must be a legal agent
  identifier and must not already be in use by any agent (installed, system/inline, or
  MCP). The name is validated before anything is installed, so a bad or colliding name
  fails fast.
- `<ref>` is interpreted by the resolving source (a path, a short name, or a package
  specifier).
- `--source <name>` installs from a specific source, bypassing the order. `<ref>` is
  interpreted by that source, and it is an error if that source cannot resolve `<ref>`.
- `--where` performs a dry run: it reports which source _would_ win for `<ref>` (and the
  candidate it found) **without installing**.

Examples:

```
@package install echo <path to echo package>                 # ordered resolution (path wins on disk)
@package install echo <path to echo package> --source path   # force the local path source
@package install echo echo-agent --where                     # preview resolution without installing
```

If no source matches, `@package install` reports the order and, for enumerable sources,
the agents they advertise. A feed authentication failure surfaces the exact `az login`
command to run.

## `@package update`

```
@package update <name> [<range>]
```

`@package install` over an **existing** name is an error, not a silent reinstall. To
refresh an already-installed agent, use `@package update`, which re-resolves the agent
against the **source it was installed from**:

- **feed** — resolve the newest version, optionally constrained by `<range>` (for
  example `^1.4`, `~2.0`, `>=3 <4`). With no range, updates to the latest version.
- **path** — re-materialize from the recorded path (picks up a moved or rebuilt local
  agent).
- **catalog** — re-look-up the agent's short name (picks up a catalog entry that now
  points elsewhere).

A failed `@package update` is a no-op — the previously installed agent stays in place.
For a `path` or `catalog` agent with no upstream change, `@package update` is a harmless
refresh. If the recorded source is no longer configured on this host, the agent keeps
working but `@package update` fails with an actionable error (re-add the source, or
uninstall).

## `@package source`

```
@package source list                       # show sources and the current resolution order
@package source order <name>...            # set the resolution order (subset allowed; rest appended)
@package source add path <name> [--baseDir <path>]
@package source add catalog <name> --catalog <path>
@package source add feed <name> --registry <url> [--scope <scope>]...
@package source remove <name> [--force]
```

- `@package source list` shows the configured sources and the order they are probed in.
- `@package source order` sets the priority. You can list a subset; any sources you omit
  are appended after the ones you name. Entries that name an unknown or removed source
  are ignored with a warning rather than erroring.
- `@package source add` registers a new source. `add` validates the input: names must be
  unique, a `feed` registry must be a well-formed URL, and a `catalog` file must be
  readable JSON.
- `@package source remove` deletes a source. If installed agents still reference it,
  removal warns and aborts unless you pass `--force`. With `--force`, those agents remain
  loadable but cannot be `@package update`d until the source is added back.

A source that is configured but not listed in the order is still usable via
`--source`; it just is not probed automatically during ordered resolution.

Source definitions and the resolution order persist to the instance configuration, so
they survive a restart.

## Host limitations

- Remote hosts can disable path resolution with `excludePathSources`. The `path`
  source still appears in `@package source list` and remains persisted, but it is
  skipped during resolution so a user path is not interpreted against the remote
  server's filesystem.
- Indexing-service discovery is currently a startup snapshot. Installed feed/path
  agents that declare indexing services keep loading as agents, but their indexing
  services are not registered dynamically on install, update, or uninstall until the
  host restarts.

## Uninstalling

```
@package uninstall <name>
```

Removes the installed agent record and unloads the agent. (For `feed` installs this does
not prune the downloaded package from disk; that is disk-only cruft with no runtime
effect.)
