// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    AppAgentEvent,
    AppAgentManifest,
    CompletionGroup,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import {
    AppAgentHost,
    AppAgentProvider,
    InstalledAgentInfo,
} from "agent-dispatcher";
import chalk from "chalk";
import {
    AvailableInstallRow,
    InstallMatchKind,
    InstallPreview,
    InstallResult,
    deriveMatchKind,
    SourceStatus,
    UninstallOutcomeStatus,
    UpdateOutcomeStatus,
} from "./config.js";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications").
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The record-store / registry API the `@package` handlers use, supplied by
 * the host's `AppAgentSource`. All `agents.json` access, source resolution, and
 * the cross-session fan-out live behind this, so the handlers never touch the
 * dispatcher's internals. Each mutating op takes the `issuingHost` (the session
 * that ran the command, reached off the package agent's own `agentContext`) so
 * the source can register/tear down the agent in the issuing session (awaited)
 * while fanning out to the other sessions best-effort as a follow-up.
 */
export interface InstalledAgentSourceApi {
    // Resolve + materialize + write a record, then fan out `addProvider` to
    // every connected session. Resolve/materialize errors are thrown
    // synchronously (the record commit is where it fails fast); the
    // apply then lands asynchronously on every session — including the issuing
    // one — through its idle-gated applicator, each notified with a system
    // message. Each session derives the agent's enabled state from its own
    // config with the manifest default as fallback. Returns which
    // source matched plus any warnings once the record is committed. `onStatus`,
    // when supplied, is called as each source is probed during the sequential
    // resolution walk so the caller can show a live status line. `abortSignal`,
    // when supplied, cancels a long install (the feed source's `npm install`)
    // mid flight.
    install(
        nameOrTarget: string,
        ref: string | undefined,
        sourceName: string | undefined,
        issuingHost: AppAgentHost,
        onStatus?: SourceStatus,
        abortSignal?: AbortSignal,
    ): Promise<InstallResult>;
    // Dry-run: report how a one/two-argument target would resolve (winning
    // source, match kind, installed name, and the full shadow set) without
    // installing anything. `--refresh` may still rewrite a cache-backed source's
    // cache, but no record is materialized or written.
    preview(
        nameOrTarget: string,
        ref: string | undefined,
        sourceName: string | undefined,
        onStatus?: SourceStatus,
    ): Promise<InstallPreview | undefined>;
    // Refresh cache-backed source metadata (feed descriptor caches) before an
    // install/preview/listing. When `sourceName` is given, only that source is
    // refreshed. A fetch failure throws so the `--refresh` command fails rather
    // than acting on stale data.
    refresh(sourceName?: string): Promise<void>;
    // Fan the unload out to every session — including the issuing one — through
    // its idle-gated applicator, each notified with a system message ("Agent 'x'
    // was removed."), exactly as an install announces its add. Unlike `update`,
    // uninstall needs no version-swap barrier: the shared agent provider is
    // refcounted, so once EVERY session has unloaded it the process closes, and
    // the source frees the name (drops the record) only then — so a name is never
    // reused while its process may still be live. The COMMITTED removal is
    // announced by that fan-out, so callers need not echo it. `onOutcome` reports
    // the final status: `uninstalled` (freed) or `reverted` (a session never
    // idled within the timeout, so the agent was left installed — which the
    // fan-out cannot express, since nothing changed). Returns as soon as the
    // teardown starts; the issuing session's own unload runs after this returns.
    uninstall(
        name: string,
        issuingHost: AppAgentHost,
        onOutcome?: (status: UninstallOutcomeStatus) => void,
    ): Promise<void>;
    // Re-materialize against the recorded source (fails fast on error), write the
    // record (commit), then start a coordinated, time-bounded swap: the old
    // version is removed across every session before the new one is added to any,
    // all under one held command lock per session, so two versions of the name
    // are never loaded at once (required because an agent's persisted storage is
    // keyed by agent name and cannot be shared between versions). The whole swap
    // is enqueued on every session's idle-gated applicator — including the
    // issuing one — so this returns as soon as the record is committed. A
    // COMMITTED swap is announced by the cross-session fan-out ("Agent 'x' was
    // updated."), exactly as install announces an add, so callers need not echo
    // it. `onOutcome` reports the final status: `updated` (committed), `reverted`
    // (a rollback to v1 on timeout/failed-start), or `unchanged` (the requested
    // version was already serving — a no-op the fan-out cannot express).
    update(
        name: string,
        range: string | undefined,
        issuingHost: AppAgentHost,
        onOutcome?: (status: UpdateOutcomeStatus) => void,
    ): Promise<void>;
    // Host-rendered summaries of installed agents, backing `@package list`.
    listInstalled(): InstalledAgentInfo[];
    // Source names in resolution order (for `@package install --source`).
    listSources(): string[];
    // Enumerable install rows (default agent name + package name) with source
    // names. Optional source filter narrows results to one source.
    listAvailableAgents(opts?: {
        sourceName?: string;
    }): Promise<AvailableInstallRow[]>;
    // The host-owned source command table, nested under `@package source`.
    sourceCommands(): CommandHandlerTable;
}

/**
 * The host-owned `agentContext` of the `@package` app agent. It is not the
 * dispatcher's `CommandHandlerContext`: the only dispatcher access it exposes
 * is the narrow {@link AppAgentHost} (to register/tear down agents in
 * the issuing session), plus the host's own {@link InstalledAgentSourceApi}
 * closures. So a handler can never reach back into dispatcher internals.
 */
export interface PackageAgentContext {
    readonly appAgentHost: AppAgentHost;
    readonly source: InstalledAgentSourceApi;
}

type PackageActionContext = ActionContext<PackageAgentContext>;
type PackageSessionContext = SessionContext<PackageAgentContext>;

// Names of agents that can be uninstalled/updated.
function managedAgentNames(context: PackageSessionContext): string[] {
    return context.agentContext.source.listInstalled().map((info) => info.name);
}

class ListInstalledCommandHandler implements CommandHandler {
    public readonly description = "List installed agents";
    public readonly parameters = {} as const;
    public async run(
        context: PackageActionContext,
        _params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { source } = context.sessionContext.agentContext;
        // `@package list` shows mutable installed records only.
        const records = source.listInstalled();
        if (records.length === 0) {
            displayResult("No installed agents found.", context);
            return;
        }

        // Group records by source so each source renders as its own table.
        const groups = new Map<string, typeof records>();
        for (const record of records) {
            const group = groups.get(record.source);
            if (group === undefined) {
                groups.set(record.source, [record]);
            } else {
                group.push(record);
            }
        }

        // Sources listed alphabetically; one table per source, with a heading.
        const sortedSources = [...groups.keys()].sort();
        sortedSources.forEach((source, index) => {
            const groupRecords = groups
                .get(source)!
                .sort((a, b) => a.name.localeCompare(b.name));
            context.actionIO.appendDisplay({
                type: "text",
                content: chalk.yellow(`${index === 0 ? "" : "\n"}${source}\n`),
            });
            const text: string[][] = [["Agent", "Reference"]];
            for (const record of groupRecords) {
                text.push([
                    chalk.cyanBright(record.name),
                    record.ref !== undefined
                        ? chalk.gray(record.ref)
                        : chalk.gray("—"),
                ]);
            }
            context.actionIO.appendDisplay({
                type: "text",
                content: text,
            });
        });

        context.actionIO.appendDisplay({
            type: "text",
            content: chalk.gray(
                "\nShowing installable installed agents only. Use '@config agent' to see all available agents and their status.",
            ),
        });
    }
}

class ListAvailableCommandHandler implements CommandHandler {
    public readonly description =
        "List available agents from configured install sources";
    public readonly parameters = {
        flags: {
            source: {
                description: "Optional source name to filter by",
                char: "s",
                type: "string",
                optional: true,
            },
            refresh: {
                description:
                    "Refresh cache-backed source metadata before listing",
                char: "r",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { source } = context.sessionContext.agentContext;
        const sourceName = params.flags?.source ?? undefined;
        if (params.flags?.refresh) {
            displayStatus("Refreshing source metadata...", context);
            await source.refresh(sourceName);
        }
        const rows = (
            await source.listAvailableAgents(
                sourceName !== undefined ? { sourceName } : undefined,
            )
        ).sort(
            (a, b) =>
                (a.defaultAgentName ?? a.packageName ?? "").localeCompare(
                    b.defaultAgentName ?? b.packageName ?? "",
                ) || a.source.localeCompare(b.source),
        );
        if (rows.length === 0) {
            displayResult("No installable agents found.", context);
            return;
        }

        // Show only what can be typed into `@package install`: the default agent
        // name and the package name. The internal catalog key / durable ref is
        // never displayed.
        const text: string[][] = [["Name", "Package", "Source"]];
        for (const row of rows) {
            text.push([
                chalk.cyanBright(row.defaultAgentName ?? "—"),
                row.packageName ? chalk.gray(row.packageName) : chalk.gray("—"),
                chalk.gray(row.source),
            ]);
        }
        context.actionIO.appendDisplay({
            type: "text",
            content: text,
        });
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const { source } = context.agentContext;
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "--source") {
                completions.push({
                    name,
                    completions: source.listSources(),
                });
            }
        }
        return { groups: completions };
    }
}

class InstallCommandHandler implements CommandHandler {
    public readonly description = "Install an agent";
    public readonly parameters = {
        args: {
            target: {
                description:
                    "One-argument install: a default agent name, a package name, or a filesystem path. Two-argument install: the ref (path or package name) to install.",
                type: "string",
            },
            name: {
                description:
                    "Optional explicit installed agent name. When given, the first argument is resolved only as a ref (path or package name); default agent names are not consulted.",
                type: "string",
                optional: true,
            },
        },
        flags: {
            source: {
                description:
                    "Resolve only against this named source, bypassing the order.",
                char: "s",
                type: "string",
                optional: true,
            },
            "dry-run": {
                description:
                    "Preview how the target would resolve without installing.",
                char: "n",
                type: "boolean",
                default: false,
            },
            refresh: {
                description:
                    "Refresh cache-backed source metadata before resolving.",
                char: "r",
                type: "boolean",
                default: false,
            },
        },
    } as const;

    private describeMatch(m: {
        matchKind: InstallMatchKind;
        name: string;
        packageName?: string | undefined;
        path?: string | undefined;
    }): string {
        switch (m.matchKind) {
            case "defaultAgentName":
                return `default agent name '${m.name}'`;
            case "packageName":
                return `package '${m.packageName ?? "?"}'`;
            case "path":
                return `path '${m.path ?? "?"}'`;
        }
    }

    // "<kind> source '<name>'" (e.g. "catalog source 'workspace'"), or just
    // "source '<name>'" when the kind is unknown.
    private describeSource(m: {
        source: string;
        sourceKind?: string | undefined;
    }): string {
        return m.sourceKind !== undefined
            ? `${m.sourceKind} source '${m.source}'`
            : `source '${m.source}'`;
    }

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { appAgentHost, source } = context.sessionContext.agentContext;
        const { args, flags } = params;
        const { target, name } = args;
        const sourceName = flags.source ?? undefined;
        const explicit = name !== undefined;

        // Two-argument form: the explicit installed name must be legal. This
        // runs before any resolution so a bad name fails fast.
        if (explicit && !AGENT_NAME_RE.test(name)) {
            throw new Error(
                `'${name}' is not a legal agent name (letters, digits, '-' and '_'; must start with a letter).`,
            );
        }

        // Map the two command forms onto (nameOrTarget, ref):
        //   one arg  -> install(target, undefined)
        //   two args -> install(name, target)  (target is the ref)
        const nameOrTarget = name ?? target;
        const ref = explicit ? target : undefined;

        // `--refresh` fetches fresh cache-backed metadata first; a fetch
        // failure throws and fails the command rather than acting on stale data.
        if (flags.refresh) {
            displayStatus("Refreshing source metadata...", context);
            await source.refresh(sourceName);
        }

        if (flags["dry-run"]) {
            const preview = await source.preview(
                nameOrTarget,
                ref,
                sourceName,
                (message) => displayStatus(message, context),
            );
            if (preview === undefined) {
                displayResult(`No source would resolve '${target}'.`, context);
                return;
            }
            const { winner, matches } = preview;
            let message = `'${target}' would resolve via ${this.describeSource(
                winner,
            )} as ${this.describeMatch(
                winner,
            )} and install as '${winner.name}'.`;
            const shadows = matches.slice(1);
            if (shadows.length > 0) {
                const list = shadows
                    .map(
                        (m) =>
                            `${this.describeSource(m)} (${this.describeMatch(
                                m,
                            )})`,
                    )
                    .join(", ");
                message += ` Also matched: ${list}.`;
            }
            displayResult(message, context);
            return;
        }

        displayStatus(`Resolving '${target}'...`, context);
        // The source resolves + writes the record + fans out to every connected
        // session. Resolve/materialize errors are thrown here
        // (it fails fast on the record commit); the apply then lands asynchronously
        // on every session — including this one — through its idle-gated
        // applicator, each honoring the agent's manifest default.
        const result = await source.install(
            nameOrTarget,
            ref,
            sourceName,
            appAgentHost,
            (message) => displayStatus(message, context),
            context.abortSignal,
        );
        // Show any non-fatal source warnings once, for this command.
        for (const warning of result.warnings ?? []) {
            displayWarn(warning, context);
        }
        const pkgPart =
            result.packageName !== undefined
                ? ` from package '${result.packageName}'`
                : "";
        const sourceLabel = this.describeSource(result);
        // One-argument (inferred) installs clarify HOW the single ambiguous
        // token matched, on a separate line shown before the install
        // confirmation. A two-argument install typed the name explicitly, so
        // there is nothing to clarify.
        if (!explicit) {
            const matchKind: InstallMatchKind = deriveMatchKind({
                matchedByName: result.matchedByName,
                path: result.path,
            });
            displayResult(
                `Matched ${this.describeMatch({
                    matchKind,
                    name: result.name,
                    packageName: result.packageName,
                    path: result.path,
                })}.`,
                context,
            );
        }
        let message = `Agent '${result.name}' installed${pkgPart} via ${sourceLabel}; it will load in each session shortly.`;
        if (result.ref !== undefined && result.ref !== result.packageName) {
            message += ` Durable ref: ${result.ref}.`;
        }
        displayResult(message, context);
    }

    public async getCompletion(
        context: PackageSessionContext,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const { source } = context.agentContext;
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "target") {
                // Complete default agent names and package names. The second
                // argument (explicit installed name) is not completed.
                const sourceName = params.flags?.source as string | undefined;
                const rows = await source.listAvailableAgents(
                    sourceName !== undefined ? { sourceName } : undefined,
                );
                const values = new Set<string>();
                for (const row of rows) {
                    if (row.defaultAgentName !== undefined) {
                        values.add(row.defaultAgentName);
                    }
                    if (row.packageName !== undefined) {
                        values.add(row.packageName);
                    }
                }
                completions.push({ name, completions: [...values] });
            } else if (name === "--source") {
                completions.push({
                    name,
                    completions: source.listSources(),
                });
            }
        }
        return { groups: completions };
    }
}

class UninstallCommandHandler implements CommandHandler {
    public readonly description = "Uninstall an agent";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { appAgentHost, source } = context.sessionContext.agentContext;
        const name = params.args.name;
        // Start the coordinated teardown and fan out the removal to every
        // session — including this one — through its idle-gated applicator, each
        // notified with a system message ("Agent 'x' was removed."), exactly as
        // install announces an add. This returns as soon as the teardown starts.
        //
        // A COMMITTED uninstall is therefore announced by that cross-session
        // fan-out, delivered uniformly to every session; the command adds no
        // echo of its own (which would double the message and, firing after the
        // command's ActionContext is finished, could not render anyway). Only a
        // ROLLBACK — a phase timeout that leaves the agent installed and changes
        // nothing, so the fan-out is silent — is surfaced here, through the
        // session's notification channel (which survives command completion).
        let settledSynchronously = false;
        await source.uninstall(name, appAgentHost, (outcome) => {
            settledSynchronously = true;
            if (outcome === "reverted") {
                context.sessionContext.notify(
                    AppAgentEvent.Inline,
                    `Agent '${name}' uninstall reverted; the agent is still installed.`,
                );
            }
        });
        // The barrier teardown settles asynchronously, so print the "started"
        // acknowledgement — unless the source already settled inline (a
        // non-active agent removed with no barrier), in which case the fan-out
        // "was removed" is the whole story and a "will unload shortly" line would
        // be misleading.
        if (!settledSynchronously) {
            displayResult(
                `Agent '${name}' uninstall started; it will unload from each session shortly.`,
                context,
            );
        }
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                completions.push({
                    name,
                    completions: managedAgentNames(context),
                });
            }
        }
        return { groups: completions };
    }
}

class UpdateCommandHandler implements CommandHandler {
    public readonly description = "Update an installed agent";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent to update",
                type: "string",
            },
            range: {
                description:
                    "Optional version range for feed agents (e.g. ^1.4, ~2.0, '>=3 <4'). Updates are supported only for feed-sourced agents.",
                type: "string",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { appAgentHost, source } = context.sessionContext.agentContext;
        const { name, range } = params.args;

        // The source materializes the new version first and only rewrites the
        // record after it succeeds, so a failed update is a no-op and that
        // error is thrown here. It then starts a coordinated, time-bounded swap
        // (no two versions loaded at once) enqueued on every session's
        // idle-gated applicator — including this one — returning as soon as the
        // record is committed.
        //
        // A COMMITTED swap is announced by the source's cross-session fan-out
        // ("Agent 'x' was updated."), delivered uniformly to every session
        // exactly as install announces an add; the command adds no echo of its
        // own. Only the outcomes the fan-out cannot express are surfaced here,
        // through the session's notification channel (which survives command
        // completion): a ROLLBACK (v1 restored, nothing changed) and an
        // UNCHANGED no-op (the requested version was already serving).
        let settledSynchronously = false;
        await source.update(name, range, appAgentHost, (outcome) => {
            settledSynchronously = true;
            if (outcome === "reverted") {
                context.sessionContext.notify(
                    AppAgentEvent.Inline,
                    `Agent '${name}' update failed; reverted to the previous version.`,
                );
            } else if (outcome === "unchanged") {
                context.sessionContext.notify(
                    AppAgentEvent.Inline,
                    `Agent '${name}' is already up to date.`,
                );
            }
        });
        // The barrier swap settles asynchronously, so print the "started"
        // acknowledgement — unless the source already settled inline (an
        // already-current no-op, or a non-active agent added with no barrier),
        // in which case the inline outcome / fan-out is the whole story and a
        // "will reload shortly" line would be misleading.
        if (!settledSynchronously) {
            displayResult(
                `Agent '${name}' update started; it will reload in each session shortly.`,
                context,
            );
        }
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                completions.push({
                    name,
                    completions: managedAgentNames(context),
                });
            }
        }
        return { groups: completions };
    }
}

/**
 * The `@package` app agent's manifest. Command-only (no schema):
 * the host contributes this as its own agent so `@package …` runs with the
 * host-owned {@link PackageAgentContext}, never the dispatcher's
 * `CommandHandlerContext`.
 */
export const packageManifest: AppAgentManifest = {
    emojiChar: "📦",
    description: "Manage installed agents and their install sources",
    commandDefaultEnabled: true,
};

/**
 * The dispatcher agent name the `@package` command set registers under.
 */
export const PACKAGE_AGENT_NAME = "package";

/**
 * Build the full `@package` command table: install / uninstall /
 * update / list, plus the host's source command table nested under `source`.
 * @internal Exported for focused command-table tests; runtime callers should
 * use {@link createPackageAppAgentProvider}.
 */
export function buildPackageCommandTable(
    sourceCommands: CommandHandlerTable,
): CommandHandlerTable {
    return {
        description: "Manage installed agents and their install sources",
        defaultSubCommand: "list",
        commands: {
            list: new ListInstalledCommandHandler(),
            available: new ListAvailableCommandHandler(),
            install: new InstallCommandHandler(),
            update: new UpdateCommandHandler(),
            uninstall: new UninstallCommandHandler(),
            source: sourceCommands,
        },
    };
}

/**
 * Build an in-memory {@link AppAgentProvider} that vends the single command-only
 * `@package` agent bound to the given host-owned context. One is
 * created per connected dispatcher (its `agentContext` carries that session's
 * {@link AppAgentHost}).
 */
export function createPackageAppAgentProvider(
    ctx: PackageAgentContext,
): AppAgentProvider {
    const table = buildPackageCommandTable(ctx.source.sourceCommands());
    const appAgent: AppAgent = {
        initializeAgentContext: async () => ctx,
        ...getCommandInterface(table),
    };
    return {
        getAppAgentNames: () => [PACKAGE_AGENT_NAME],
        getAppAgentManifest: async (name: string) => {
            if (name !== PACKAGE_AGENT_NAME) {
                throw new Error(`Unknown agent '${name}'`);
            }
            return packageManifest;
        },
        loadAppAgent: async (name: string) => {
            if (name !== PACKAGE_AGENT_NAME) {
                throw new Error(`Unknown agent '${name}'`);
            }
            return appAgent;
        },
        unloadAppAgent: async () => {},
    };
}
