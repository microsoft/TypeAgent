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
    AppAgentProvider,
    AppAgentProviderSetController,
} from "agent-dispatcher";
import type { McpServerSourceApi } from "../mcp/mcpAppAgentSource.js";
import type {
    EnvValue,
    NormalizedMcpServerConfig,
} from "../mcp/mcpServerConfig.js";
import chalk from "chalk";
import { enforceMcpPolicy } from "../mcp/mcpPolicy.js";
import {
    ExtensionKind,
    InstallMatchKind,
    InstallPreview,
    InstallResult,
    McpInstallCandidate,
    deriveMatchKind,
    SourceStatus,
    UninstallOutcomeStatus,
    UpdateOutcomeStatus,
    UpdateResult,
} from "./config.js";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications").
const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A host-rendered summary of one installed agent for `@package list`. */
export interface InstalledAgentInfo {
    name: string;
    // Feed specifier, package name, or path. Omitted when none is recorded.
    ref?: string;
}

/** One install target advertised by a source. */
export interface AvailableAgentInfo {
    readonly ref: string;
    readonly defaultAgentName?: string | undefined;
    readonly packageName?: string | undefined;
    readonly description?: string | undefined;
    // Which kind of extension this row installs; absent means "agent". Threaded
    // from the source's `AvailableInstallRow` so `@package available --type`
    // can filter native agents from MCP servers.
    readonly extensionKind?: ExtensionKind | undefined;
}

/** Agent information grouped under one configured install source. */
export interface AgentSourceGroup<T> {
    readonly source: string;
    readonly sourceKind?: string | undefined;
    readonly agents: T[];
}

/**
 * The record-store / registry API the `@package` handlers use, supplied by
 * the host's `AppAgentSource`. All `agents.json` access, source resolution, and
 * the cross-session fan-out live behind this, so the handlers never touch the
 * dispatcher's internals. Each mutating op takes the `issuingController` (the session
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
        issuingController: AppAgentProviderSetController,
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
    // Resolve normalized MCP artifacts without native materialization. The
    // full match set lets the command reject source ambiguity.
    resolveMcp(
        ref: string,
        sourceName?: string,
        onStatus?: SourceStatus,
    ): Promise<McpInstallCandidate[]>;
    materializeMcp?(
        candidate: McpInstallCandidate,
        abortSignal?: AbortSignal,
    ): Promise<NormalizedMcpServerConfig>;
    cleanupMcp?(config: NormalizedMcpServerConfig): void;
    // Refresh cache-backed source metadata (feed descriptor caches) before an
    // install/preview/listing. When `sourceName` is given, only that source is
    // refreshed. A fetch failure throws so the `--refresh` command fails rather
    // than acting on stale data.
    refresh(sourceName?: string): Promise<void>;
    // Drop the record (commit), then fan out `removeProvider` to every session —
    // including the issuing one — through its idle-gated applicator, each
    // notified. The teardown is coordinated by the same
    // barrier as `update`, so a straggler that won't idle rolls back (the agent
    // stays installed); `onOutcome` reports that final
    // status (uninstalled / reverted). Returns as soon as the teardown starts;
    // the unload lands at each session's next idle.
    uninstall(
        name: string,
        issuingController: AppAgentProviderSetController,
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
    // it. Returns the immediate disposition: `unchanged`, or `started` with
    // package version details when available. `onOutcome` reports the later
    // barrier status: `updated` (committed) or `reverted` (rolled back).
    update(
        name: string,
        range: string | undefined,
        issuingController: AppAgentProviderSetController,
        onOutcome?: (status: UpdateOutcomeStatus) => void,
    ): Promise<UpdateResult>;
    // Host-rendered summaries of installed agents, grouped in source order.
    listInstalled(): AgentSourceGroup<InstalledAgentInfo>[];
    // Source names in resolution order (for `@package install --source`).
    listSources(): string[];
    // Enumerable install targets grouped in source order. Optional source
    // filter narrows results to one source; optional `type` filter narrows to
    // one extension kind ("agent" / "mcp").
    listAvailableAgents(opts?: {
        sourceName?: string;
        type?: ExtensionKind;
    }): Promise<AgentSourceGroup<AvailableAgentInfo>[]>;
    // The host-owned source command table, nested under `@package source`.
    sourceCommands(): CommandHandlerTable;
}

/**
 * The host-owned `agentContext` of the `@package` app agent. It is not the
 * dispatcher's `CommandHandlerContext`: the only dispatcher access it exposes
 * is the narrow {@link AppAgentProviderSetController} (to register/tear down agents in
 * the issuing session), plus the host's own {@link InstalledAgentSourceApi}
 * closures. So a handler can never reach back into dispatcher internals.
 */
export interface PackageAgentContext {
    readonly appAgentProviderSetController: AppAgentProviderSetController;
    readonly source: InstalledAgentSourceApi;
    readonly mcpSource?: McpServerSourceApi;
}

type PackageActionContext = ActionContext<PackageAgentContext>;
type PackageSessionContext = SessionContext<PackageAgentContext>;
type PackageType = ExtensionKind | "all";

function parsePackageType(
    value: string | undefined,
    defaultValue: PackageType,
): PackageType {
    const type = value ?? defaultValue;
    if (type !== "agent" && type !== "mcp" && type !== "all") {
        throw new Error(
            `Invalid --type '${type}'. Expected 'agent', 'mcp', or 'all'.`,
        );
    }
    return type;
}

function requireMcpSource(context: PackageSessionContext): McpServerSourceApi {
    const source = context.agentContext.mcpSource;
    if (source === undefined) {
        throw new Error("MCP server management is not available on this host.");
    }
    return source;
}

function mcpServerNames(context: PackageSessionContext): string[] {
    return (
        context.agentContext.mcpSource
            ?.listServers()
            .map((config) => config.name)
            .sort((a, b) => a.localeCompare(b)) ?? []
    );
}

function findMcpServer(
    mcpSource: McpServerSourceApi,
    nameOrId: string,
    sourceName?: string,
): NormalizedMcpServerConfig | undefined {
    return mcpSource
        .listServers()
        .find(
            (config) =>
                (config.id === nameOrId || config.name === nameOrId) &&
                (sourceName === undefined ||
                    config.provenance.source === sourceName),
        );
}

function materializeMcp(
    source: InstalledAgentSourceApi,
    candidate: McpInstallCandidate,
    signal?: AbortSignal,
): Promise<NormalizedMcpServerConfig> {
    return (
        source.materializeMcp?.(candidate, signal) ??
        candidate.materialize?.(signal) ??
        Promise.resolve(candidate.config)
    );
}

function cleanupMcp(
    source: InstalledAgentSourceApi,
    config: NormalizedMcpServerConfig,
): void {
    source.cleanupMcp?.(config);
}

function describeEnvValue(value: EnvValue): string {
    return typeof value === "string"
        ? "<literal>"
        : "kind" in value
          ? `<credential ${value.kind}:${value.name}>`
          : "<template>";
}

function describeMcpConfig(config: NormalizedMcpServerConfig): string {
    const lines = [
        `MCP server '${config.name}' (${config.id})`,
        `Source: ${config.provenance.source}${config.provenance.ref === undefined ? "" : ` / ${config.provenance.ref}`}`,
        `State: ${config.trust}, ${config.enabled ? "enabled" : "disabled"}`,
    ];
    if (config.transport.kind === "stdio") {
        lines.push(
            `Command: ${[config.transport.command, ...(config.transport.args ?? [])].join(" ")}`,
        );
        if (config.transport.cwd !== undefined) {
            lines.push(`Cwd: ${config.transport.cwd}`);
        }
        const env = config.transport.env;
        if (env !== undefined) {
            lines.push(
                `Environment: ${Object.entries(env)
                    .map(
                        ([name, value]) => `${name}=${describeEnvValue(value)}`,
                    )
                    .join(", ")}`,
            );
        }
    } else {
        lines.push(`URL: ${config.transport.url}`);
        if (config.transport.headers !== undefined) {
            lines.push(
                `Headers: ${Object.entries(config.transport.headers)
                    .map(
                        ([name, value]) => `${name}=${describeEnvValue(value)}`,
                    )
                    .join(", ")}`,
            );
        }
    }
    lines.push(
        `Tools: ${config.enabledTools?.join(", ") ?? "all advertised tools"}`,
    );
    return lines.join("\n");
}

function describeMcpChanges(
    current: NormalizedMcpServerConfig,
    next: NormalizedMcpServerConfig,
): string {
    const changes: string[] = [];
    if (JSON.stringify(current.transport) !== JSON.stringify(next.transport)) {
        changes.push("transport");
    }
    if (current.description !== next.description) {
        changes.push("description");
    }
    if (
        JSON.stringify(current.enabledTools) !==
        JSON.stringify(next.enabledTools)
    ) {
        changes.push("enabled tools");
    }
    return changes.length === 0
        ? "No configuration changes."
        : changes.join(", ");
}

// Names of agents that can be uninstalled/updated.
function managedAgentNames(context: PackageSessionContext): string[] {
    return context.agentContext.source
        .listInstalled()
        .flatMap((group) => group.agents.map((info) => info.name));
}

function displaySourceTables<T>(
    context: PackageActionContext,
    groups: AgentSourceGroup<T>[],
    columns: string[],
    compareRows: (a: T, b: T) => number,
    formatRow: (row: T) => string[],
): void {
    groups.forEach((group, index) => {
        const sourceKind = group.sourceKind;
        const sourceHeading =
            sourceKind !== undefined
                ? `${group.source} (${sourceKind})`
                : group.source;
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: chalk.yellow(
                    `${index === 0 ? "" : "\n"}${sourceHeading}\n`,
                ),
            },
            "block",
        );
        const text: string[][] = [columns];
        group.agents.sort(compareRows);
        for (const row of group.agents) {
            text.push(formatRow(row));
        }
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: text,
            },
            "block",
        );
    });
}

class ListInstalledCommandHandler implements CommandHandler {
    public readonly description = "List installed agents and MCP servers";
    public readonly parameters = {
        flags: {
            type: {
                description: "List 'agent', 'mcp', or 'all'",
                char: "t",
                type: "string",
                default: "agent",
            },
        },
    } as const;
    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const type = parsePackageType(params.flags?.type, "agent");
        const { source, mcpSource } = context.sessionContext.agentContext;
        // `@package list` shows mutable installed records only.
        const groups = source.listInstalled();
        const servers = mcpSource?.listServers() ?? [];
        if (
            (type === "agent" && groups.length === 0) ||
            (type === "mcp" && servers.length === 0) ||
            (type === "all" && groups.length === 0 && servers.length === 0)
        ) {
            if (type === "mcp") {
                displayResult("No installed MCP servers found.", context);
                return;
            }
            displayResult("No installed agents found.", context);
            return;
        }

        if (type !== "mcp") {
            // Preserve source order, matching `@package available`. Sort agents
            // within each source and render each heading and table as a block.
            displaySourceTables(
                context,
                groups,
                ["Name", "Reference"],
                (a, b) => a.name.localeCompare(b.name),
                (record) => [
                    chalk.cyanBright(record.name),
                    record.ref !== undefined
                        ? chalk.gray(record.ref)
                        : chalk.gray("—"),
                ],
            );

            context.actionIO.appendDisplay(
                {
                    type: "text",
                    content: chalk.gray(
                        "\nShowing installable installed agents only. Use '@config agent' to see all available agents and their status.",
                    ),
                },
                "block",
            );
        }
        if (type !== "agent" && servers.length > 0) {
            displaySourceTables(
                context,
                [
                    {
                        source: "MCP servers",
                        agents: servers,
                    },
                ],
                ["Name", "Transport", "Trust", "Enabled", "Source"],
                (a, b) => a.name.localeCompare(b.name),
                (config) => [
                    chalk.cyanBright(config.name),
                    config.transport.kind === "stdio"
                        ? config.transport.command
                        : config.transport.url,
                    config.trust,
                    config.enabled ? "yes" : "no",
                    config.provenance.source,
                ],
            );
        }
    }

    public async getCompletion(
        _context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        return {
            groups: names
                .filter((name) => name === "--type")
                .map((name) => ({
                    name,
                    completions: ["agent", "mcp", "all"],
                })),
        };
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
            type: {
                description:
                    "Filter by extension kind: 'agent', 'mcp', or 'all'",
                char: "t",
                type: "string",
                default: "all",
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
        const typeFlag = params.flags?.type ?? "all";
        if (typeFlag !== "all" && typeFlag !== "agent" && typeFlag !== "mcp") {
            throw new Error(
                `Invalid --type '${typeFlag}'. Expected 'agent', 'mcp', or 'all'.`,
            );
        }
        const type =
            typeFlag === "all" ? undefined : (typeFlag as ExtensionKind);
        if (params.flags?.refresh) {
            displayStatus("Refreshing source metadata...", context);
            await source.refresh(sourceName);
        }
        const groups = await source.listAvailableAgents({
            ...(sourceName !== undefined ? { sourceName } : {}),
            ...(type !== undefined ? { type } : {}),
        });
        if (groups.length === 0) {
            displayResult("No installable agents found.", context);
            return;
        }

        // Show only what can be typed into `@package install`: the default agent
        // name and the package name. The internal catalog key / durable ref is
        // never displayed. Keep unrelated catalogs and feeds in separate tables.
        displaySourceTables(
            context,
            groups,
            ["Name", "Package", "Description"],
            (a, b) =>
                (a.defaultAgentName ?? a.packageName ?? "").localeCompare(
                    b.defaultAgentName ?? b.packageName ?? "",
                ),
            (row) => [
                chalk.cyanBright(row.defaultAgentName ?? "—"),
                row.packageName ? chalk.gray(row.packageName) : chalk.gray("—"),
                row.description ? row.description : chalk.gray("—"),
            ],
        );
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
            if (name === "--type") {
                completions.push({
                    name,
                    completions: ["agent", "mcp", "all"],
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
            type: {
                description: "Install an 'agent', 'mcp', or infer with 'all'",
                char: "t",
                type: "string",
                default: "all",
            },
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

    private async runMcpInstall(
        context: PackageActionContext,
        candidate: McpInstallCandidate,
        installedName: string,
        dryRun: boolean,
    ): Promise<void> {
        const mcpSource = requireMcpSource(context.sessionContext);
        const existing = mcpSource
            .listServers()
            .find(
                (config) =>
                    config.id === candidate.config.id ||
                    config.name === installedName,
            );
        if (existing !== undefined && !dryRun) {
            throw new Error(
                `MCP server '${existing.name}' is already installed. Use '@package update ${existing.name} --type mcp'.`,
            );
        }
        const previewConfig: NormalizedMcpServerConfig = {
            ...candidate.config,
            name: installedName,
            enabled: false,
            trust: "untrusted",
        };
        const policy = mcpSource.getPolicy?.();
        if (policy !== undefined) {
            enforceMcpPolicy(policy, "install", previewConfig);
        }
        displayResult(describeMcpConfig(previewConfig), context);
        if (dryRun) {
            displayResult(
                `MCP server '${installedName}' would be installed disabled and untrusted.`,
                context,
            );
            return;
        }
        const choice = await context.sessionContext.popupQuestion(
            `Install MCP server '${installedName}' from ${candidate.sourceKind} source '${candidate.source}'? It will remain disabled and untrusted.`,
            ["Install", "Cancel"],
            1,
        );
        if (choice !== 0) {
            displayResult("MCP installation cancelled.", context);
            return;
        }
        const source = context.sessionContext.agentContext.source;
        const materialized = await materializeMcp(
            source,
            candidate,
            context.abortSignal,
        );
        const config: NormalizedMcpServerConfig = {
            ...materialized,
            name: installedName,
            enabled: false,
            trust: "untrusted",
        };
        try {
            if (policy !== undefined) {
                enforceMcpPolicy(policy, "install", config);
            }
            await mcpSource.addServer(
                config,
                context.sessionContext.agentContext
                    .appAgentProviderSetController,
            );
        } catch (error) {
            cleanupMcp(source, config);
            throw error;
        }
        displayResult(
            `MCP server '${installedName}' installed disabled and untrusted via ${candidate.sourceKind} source '${candidate.source}'.`,
            context,
        );
    }

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const {
            appAgentProviderSetController: appAgentProviderSetController,
            source,
        } = context.sessionContext.agentContext;
        const { args, flags } = params;
        const { target, name } = args;
        const sourceName = flags.source ?? undefined;
        const explicit = name !== undefined;
        const type = parsePackageType(flags.type, "all");

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

        let nativePreview: InstallPreview | undefined;
        if (type !== "agent") {
            const mcpMatches = await source.resolveMcp(
                target,
                sourceName,
                type === "mcp"
                    ? (message) => displayStatus(message, context)
                    : undefined,
            );
            if (mcpMatches.length > 1) {
                throw new Error(
                    `Multiple MCP sources resolve '${target}': ${mcpMatches
                        .map((match) => match.source)
                        .join(", ")}. Use --source to choose one.`,
                );
            }
            if (type === "all" && mcpMatches.length > 0) {
                nativePreview = await source.preview(
                    nameOrTarget,
                    ref,
                    sourceName,
                    (message) => displayStatus(message, context),
                );
                if (nativePreview !== undefined) {
                    throw new Error(
                        `'${target}' matches both a native agent and an MCP server. Use --type agent|mcp or --source.`,
                    );
                }
            }
            if (mcpMatches.length === 1) {
                await this.runMcpInstall(
                    context,
                    mcpMatches[0],
                    name ?? mcpMatches[0].config.name,
                    flags["dry-run"],
                );
                return;
            }
            if (type === "mcp") {
                throw new Error(
                    sourceName === undefined
                        ? `No MCP source could resolve '${target}'.`
                        : `'${target}' not found in MCP source '${sourceName}'.`,
                );
            }
        }

        if (flags["dry-run"]) {
            const preview =
                nativePreview ??
                (await source.preview(
                    nameOrTarget,
                    ref,
                    sourceName,
                    (message) => displayStatus(message, context),
                ));
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
            appAgentProviderSetController,
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
                const type = parsePackageType(
                    params.flags?.type as string | undefined,
                    "all",
                );
                const groups = await source.listAvailableAgents({
                    ...(sourceName === undefined ? {} : { sourceName }),
                    ...(type === "all" ? {} : { type }),
                });
                const values = new Set<string>();
                for (const group of groups) {
                    for (const agent of group.agents) {
                        if (agent.defaultAgentName !== undefined) {
                            values.add(agent.defaultAgentName);
                        }
                        if (agent.packageName !== undefined) {
                            values.add(agent.packageName);
                        }
                    }
                }
                completions.push({ name, completions: [...values] });
            } else if (name === "--source") {
                completions.push({
                    name,
                    completions: source.listSources(),
                });
            } else if (name === "--type") {
                completions.push({
                    name,
                    completions: ["agent", "mcp", "all"],
                });
            }
        }
        return { groups: completions };
    }
}

class UninstallCommandHandler implements CommandHandler {
    public readonly description = "Uninstall an agent or MCP server";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent",
                type: "string",
            },
        },
        flags: {
            type: {
                description: "Uninstall an 'agent', 'mcp', or infer with 'all'",
                char: "t",
                type: "string",
                default: "all",
            },
            source: {
                description: "Require the installed entry to use this source",
                char: "s",
                type: "string",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const {
            appAgentProviderSetController: appAgentProviderSetController,
            source,
            mcpSource,
        } = context.sessionContext.agentContext;
        const name = params.args.name;
        const type = parsePackageType(params.flags?.type, "all");
        const sourceName = params.flags?.source ?? undefined;
        const agentMatch = source
            .listInstalled()
            .some(
                (group) =>
                    (sourceName === undefined || group.source === sourceName) &&
                    group.agents.some((record) => record.name === name),
            );
        const mcpMatch =
            mcpSource === undefined
                ? undefined
                : findMcpServer(mcpSource, name, sourceName);
        if (type === "all" && agentMatch && mcpMatch !== undefined) {
            throw new Error(
                `'${name}' names both an installed agent and MCP server. Use --type agent|mcp or --source.`,
            );
        }
        if (type === "mcp" || (type === "all" && mcpMatch !== undefined)) {
            const api = requireMcpSource(context.sessionContext);
            const config = mcpMatch ?? findMcpServer(api, name, sourceName);
            if (config === undefined) {
                throw new Error(`MCP server '${name}' not found`);
            }
            if (
                !(await api.removeServer(
                    config.id,
                    appAgentProviderSetController,
                ))
            ) {
                throw new Error(`MCP server '${name}' not found`);
            }
            cleanupMcp(source, config);
            displayResult(`MCP server '${config.name}' uninstalled.`, context);
            return;
        }
        if (sourceName !== undefined && !agentMatch) {
            throw new Error(
                `Agent '${name}' is not installed from source '${sourceName}'.`,
            );
        }
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
        await source.uninstall(
            name,
            appAgentProviderSetController,
            (outcome) => {
                if (outcome === "reverted") {
                    context.sessionContext.notify(
                        AppAgentEvent.Inline,
                        `Agent '${name}' uninstall reverted; the agent is still installed.`,
                    );
                }
            },
        );
        // A successful return means the asynchronous barrier was armed. Its
        // terminal outcome cannot arrive in the issuing session until this
        // command releases that session's command lock.
        displayResult(
            `Agent '${name}' uninstall started; it will unload from each session shortly.`,
            context,
        );
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                const type = parsePackageType(
                    _params.flags?.type as string | undefined,
                    "all",
                );
                completions.push({
                    name,
                    completions: [
                        ...(type === "mcp" ? [] : managedAgentNames(context)),
                        ...(type === "agent" ? [] : mcpServerNames(context)),
                    ],
                });
            } else if (name === "--type") {
                completions.push({
                    name,
                    completions: ["agent", "mcp", "all"],
                });
            } else if (name === "--source") {
                completions.push({
                    name,
                    completions: context.agentContext.source.listSources(),
                });
            }
        }
        return { groups: completions };
    }
}

class UpdateCommandHandler implements CommandHandler {
    public readonly description = "Update an installed agent or MCP server";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the agent to update",
                type: "string",
            },
            range: {
                description:
                    "Optional version range for feed agents, or exact server version for registry MCP servers.",
                type: "string",
                optional: true,
            },
        },
        flags: {
            type: {
                description: "Update an 'agent', 'mcp', or infer with 'all'",
                char: "t",
                type: "string",
                default: "all",
            },
            source: {
                description: "Require the installed entry to use this source",
                char: "s",
                type: "string",
                optional: true,
            },
            "dry-run": {
                description: "Preview the update without replacing the entry",
                char: "n",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const {
            appAgentProviderSetController: appAgentProviderSetController,
            source,
            mcpSource,
        } = context.sessionContext.agentContext;
        const { name, range } = params.args;
        const type = parsePackageType(params.flags?.type, "all");
        const sourceName = params.flags?.source ?? undefined;
        const agentMatch = source
            .listInstalled()
            .some(
                (group) =>
                    (sourceName === undefined || group.source === sourceName) &&
                    group.agents.some((record) => record.name === name),
            );
        const mcpMatch =
            mcpSource === undefined
                ? undefined
                : findMcpServer(mcpSource, name, sourceName);
        if (type === "all" && agentMatch && mcpMatch !== undefined) {
            throw new Error(
                `'${name}' names both an installed agent and MCP server. Use --type agent|mcp or --source.`,
            );
        }

        if (type === "mcp" || (type === "all" && mcpMatch !== undefined)) {
            const api = requireMcpSource(context.sessionContext);
            const current = mcpMatch ?? findMcpServer(api, name, sourceName);
            if (current === undefined) {
                throw new Error(`MCP server '${name}' not found`);
            }
            const sourceKind = current.provenance.sourceKind;
            if (
                (sourceKind !== "mcp-config" && sourceKind !== "registry") ||
                current.provenance.ref === undefined
            ) {
                throw new Error(
                    `MCP server '${current.name}' was installed from unsupported source kind '${sourceKind ?? "unknown"}'.`,
                );
            }
            if (sourceKind === "mcp-config" && range !== undefined) {
                throw new Error(
                    "A version is not supported for mcp-config updates.",
                );
            }
            const updateRef =
                sourceKind === "registry"
                    ? `${current.provenance.canonicalServerName ?? current.provenance.ref.split("@")[0]}@${range ?? "latest"}`
                    : current.provenance.ref;
            const matches = await source.resolveMcp(
                updateRef,
                current.provenance.source,
                (message) => displayStatus(message, context),
            );
            if (matches.length !== 1) {
                throw new Error(
                    `MCP server '${current.name}' can no longer be resolved from source '${current.provenance.source}' using ref '${updateRef}'.`,
                );
            }
            const previewNext: NormalizedMcpServerConfig = {
                ...matches[0].config,
                id: current.id,
                name: current.name,
                trust: current.trust,
                enabled: current.enabled,
                scope: current.scope,
            };
            const descriptorChanged =
                current.provenance.digest !== undefined &&
                previewNext.provenance.digest !== undefined &&
                current.provenance.digest !== previewNext.provenance.digest;
            const describedChanges = describeMcpChanges(current, previewNext);
            const changes = descriptorChanged
                ? describedChanges === "No configuration changes."
                    ? "registry descriptor"
                    : `${describedChanges}, registry descriptor`
                : describedChanges;
            displayResult(
                `${describeMcpConfig(previewNext)}\nChanges: ${changes}`,
                context,
            );
            if (changes === "No configuration changes.") {
                displayResult(
                    `MCP server '${current.name}' is already up to date.`,
                    context,
                );
                return;
            }
            if (params.flags?.["dry-run"]) {
                return;
            }
            const choice = await context.sessionContext.popupQuestion(
                `Replace MCP server '${current.name}' with the resolved config changes (${changes})?`,
                ["Update", "Cancel"],
                1,
            );
            if (choice !== 0) {
                displayResult("MCP update cancelled.", context);
                return;
            }
            const materialized = await materializeMcp(
                source,
                matches[0],
                context.abortSignal,
            );
            const next: NormalizedMcpServerConfig = {
                ...materialized,
                id: current.id,
                name: current.name,
                trust: current.trust,
                enabled: current.enabled,
                scope: current.scope,
            };
            try {
                await api.addServer(next, appAgentProviderSetController);
            } catch (error) {
                cleanupMcp(source, next);
                throw error;
            }
            cleanupMcp(source, current);
            displayResult(`MCP server '${current.name}' updated.`, context);
            return;
        }
        if (sourceName !== undefined && !agentMatch) {
            throw new Error(
                `Agent '${name}' is not installed from source '${sourceName}'.`,
            );
        }

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
        // own. A rollback is surfaced through the session's notification
        // channel, which survives command completion. An unchanged no-op is
        // returned immediately and displayed as part of this command.
        const result = await source.update(
            name,
            range,
            appAgentProviderSetController,
            (outcome) => {
                if (outcome === "reverted") {
                    context.sessionContext.notify(
                        AppAgentEvent.Inline,
                        `Agent '${name}' update failed; reverted to the previous version.`,
                    );
                }
            },
        );
        if (result.status === "unchanged") {
            displayResult(`Agent '${name}' is already up to date.`, context);
            return;
        }
        const versionChange =
            result.packageName !== undefined &&
            result.oldVersion !== undefined &&
            result.newVersion !== undefined
                ? ` for package '${result.packageName}' (${result.oldVersion} -> ${result.newVersion})`
                : "";
        displayResult(
            `Agent '${name}' update${versionChange} started; it will reload in each session shortly.`,
            context,
        );
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "name") {
                const type = parsePackageType(
                    _params.flags?.type as string | undefined,
                    "all",
                );
                completions.push({
                    name,
                    completions: [
                        ...(type === "mcp" ? [] : managedAgentNames(context)),
                        ...(type === "agent" ? [] : mcpServerNames(context)),
                    ],
                });
            } else if (name === "--type") {
                completions.push({
                    name,
                    completions: ["agent", "mcp", "all"],
                });
            } else if (name === "--source") {
                completions.push({
                    name,
                    completions: context.agentContext.source.listSources(),
                });
            }
        }
        return { groups: completions };
    }
}

class McpStateCommandHandler implements CommandHandler {
    public readonly parameters = {
        args: {
            name: { description: "MCP server name or id", type: "string" },
        },
    } as const;

    public constructor(
        public readonly description: string,
        private readonly operation: "trust" | "untrust" | "enable" | "disable",
    ) {}

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const source = requireMcpSource(context.sessionContext);
        const config = findMcpServer(source, params.args.name);
        if (config === undefined) {
            throw new Error(`MCP server '${params.args.name}' not found`);
        }
        const controller =
            context.sessionContext.agentContext.appAgentProviderSetController;
        const updated =
            this.operation === "trust" || this.operation === "untrust"
                ? await source.setTrust(
                      config.id,
                      this.operation === "trust" ? "trusted" : "untrusted",
                      controller,
                  )
                : await source.setEnabled(
                      config.id,
                      this.operation === "enable",
                      controller,
                  );
        const state =
            this.operation === "trust"
                ? "trusted"
                : this.operation === "untrust"
                  ? "untrusted"
                  : this.operation === "enable"
                    ? "enabled"
                    : "disabled";
        displayResult(`MCP server '${updated.name}' is now ${state}.`, context);
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        return {
            groups: names
                .filter((name) => name === "name")
                .map((name) => ({
                    name,
                    completions: mcpServerNames(context),
                })),
        };
    }
}

class McpInspectCommandHandler implements CommandHandler {
    public readonly description: string = "Inspect an MCP server config";
    public readonly parameters = {
        args: {
            name: { description: "MCP server name or id", type: "string" },
        },
    } as const;

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const source = requireMcpSource(context.sessionContext);
        const config = findMcpServer(source, params.args.name);
        if (config === undefined) {
            throw new Error(`MCP server '${params.args.name}' not found`);
        }
        displayResult(describeMcpConfig(config), context);
    }

    public async getCompletion(
        context: PackageSessionContext,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<{ groups: CompletionGroup[] }> {
        return {
            groups: names
                .filter((name) => name === "name")
                .map((name) => ({
                    name,
                    completions: mcpServerNames(context),
                })),
        };
    }
}

class McpStatusCommandHandler extends McpInspectCommandHandler {
    public readonly description: string =
        "Show MCP trust, enablement, and authentication status";

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const source = requireMcpSource(context.sessionContext);
        const config = findMcpServer(source, params.args.name);
        if (config === undefined) {
            throw new Error(`MCP server '${params.args.name}' not found`);
        }
        const auth = (await source.getAuthState?.(config.id)) ?? "unavailable";
        displayResult(
            `MCP server '${config.name}': ${config.enabled ? "enabled" : "disabled"}, ${config.trust}, auth=${auth}, transport=${config.transport.kind}.`,
            context,
        );
    }
}

class McpCredentialSetCommandHandler implements CommandHandler {
    public readonly description =
        "Set an MCP credential from an environment variable without echoing it";
    public readonly parameters = {
        args: {
            server: { description: "MCP server name or id", type: "string" },
            credential: {
                description: "Credential reference name",
                type: "string",
            },
            environment: {
                description: "Environment variable containing the secret",
                type: "string",
            },
        },
        flags: {
            persist: {
                description: "Require durable host secure storage",
                type: "boolean",
                default: false,
            },
        },
    } as const;

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const source = requireMcpSource(context.sessionContext);
        const config = findMcpServer(source, params.args.server);
        if (config === undefined) {
            throw new Error(`MCP server '${params.args.server}' not found`);
        }
        const value = process.env[params.args.environment];
        if (value === undefined) {
            throw new Error(
                `Environment variable '${params.args.environment}' is not set.`,
            );
        }
        if (source.setCredential === undefined) {
            throw new Error(
                "MCP credential storage is not available on this host.",
            );
        }
        await source.setCredential(
            config.id,
            params.args.credential,
            value,
            params.flags.persist,
        );
        displayResult(
            `Credential '${params.args.credential}' was stored for this host${params.flags.persist ? " durably" : " session"}.`,
            context,
        );
    }
}

class McpPolicyCommandHandler implements CommandHandler {
    public readonly description = "Show the host-enforced MCP policy";
    public readonly parameters = {} as const;

    public async run(context: PackageActionContext): Promise<void> {
        const policy = requireMcpSource(context.sessionContext).getPolicy?.();
        displayResult(
            policy === undefined
                ? "MCP policy details are unavailable on this host."
                : JSON.stringify(policy, null, 2),
            context,
        );
    }
}

class McpTestCommandHandler extends McpInspectCommandHandler {
    public readonly description: string =
        "Connect to an MCP server and list its tools";

    public async run(
        context: PackageActionContext,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const source = requireMcpSource(context.sessionContext);
        const config = findMcpServer(source, params.args.name);
        if (config === undefined) {
            throw new Error(`MCP server '${params.args.name}' not found`);
        }
        let allowUntrusted = false;
        if (config.trust !== "trusted") {
            const choice = await context.sessionContext.popupQuestion(
                `MCP server '${config.name}' is untrusted. Connect once for this test without changing its trust state?`,
                ["Test once", "Cancel"],
                1,
            );
            if (choice !== 0) {
                displayResult("MCP test cancelled.", context);
                return;
            }
            allowUntrusted = true;
        }
        const result = await source.testServer(config.id, allowUntrusted);
        displayResult(
            `MCP server '${config.name}' connected${result.protocolVersion === undefined ? "" : ` using protocol ${result.protocolVersion}`}. Tools: ${result.tools.join(", ") || "none"}.`,
            context,
        );
    }
}

function buildMcpCommandTable(): CommandHandlerTable {
    return {
        description: "Manage installed MCP servers",
        defaultSubCommand: "inspect",
        commands: {
            inspect: new McpInspectCommandHandler(),
            status: new McpStatusCommandHandler(),
            test: new McpTestCommandHandler(),
            auth: new McpTestCommandHandler(),
            policy: new McpPolicyCommandHandler(),
            credentials: {
                description: "Manage MCP credentials",
                defaultSubCommand: "set",
                commands: { set: new McpCredentialSetCommandHandler() },
            },
            trust: new McpStateCommandHandler("Trust an MCP server", "trust"),
            untrust: new McpStateCommandHandler(
                "Mark an MCP server untrusted",
                "untrust",
            ),
            enable: new McpStateCommandHandler(
                "Enable an MCP server",
                "enable",
            ),
            disable: new McpStateCommandHandler(
                "Disable an MCP server",
                "disable",
            ),
        },
    };
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
            mcp: buildMcpCommandTable(),
            source: sourceCommands,
        },
    };
}

/**
 * Build an in-memory {@link AppAgentProvider} that vends the single command-only
 * `@package` agent bound to the given host-owned context. One is
 * created per connected dispatcher (its `agentContext` carries that session's
 * {@link AppAgentProviderSetController}).
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
