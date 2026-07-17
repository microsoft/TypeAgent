// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getToggleCommandHandlers,
    getToggleHandlerTable,
} from "../../../helpers/command.js";
import {
    CommandHandlerContext,
    changeContextConfig,
    getRequestId,
} from "../../commandHandlerContext.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";
import { getActionContext } from "../../../execute/actionContext.js";
import { emitActionResult } from "../../../execute/actionHandlers.js";

import { simpleStarRegex } from "@typeagent/common-utils";
import {
    openai as ai,
    getChatModelNames,
    getCopilotClient,
    getActiveModelProvider,
    setActiveModelProvider,
    setEgressSecretRedactionEnabled,
    getRuntimeConfig,
    PROVIDER_MODES,
    type ProviderMode,
} from "@typeagent/aiclient";
import { SessionOptions } from "../../session.js";
import chalk from "chalk";
import {
    ActionContext,
    CompletionGroup,
    CompletionGroups,
    ParameterDefinitions,
    ParsedCommandParams,
    PartialParsedCommandParams,
    ReadinessReport,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { alwaysEnabledAgents } from "../../appAgentManager.js";
import { getCacheFactory } from "../../../utils/cacheFactory.js";
import { resolveCommand } from "../../../command/command.js";
import { toggleActivityContext } from "../../../execute/activityContext.js";
import registerDebug from "debug";
const debugReasoning = registerDebug("typeagent:dispatcher:reasoning:config");

const enum AgentToggle {
    Schema,
    Action,
    Command,
    Agent,
}

const AgentToggleDescription = [
    "agent schemas",
    "agent actions",
    "agent commands",
    "agents",
] as const;

function getAgentToggleOptions(
    toggle: AgentToggle,
    options: Record<string, boolean | null>,
    schemaNames: string[],
): SessionOptions {
    switch (toggle) {
        case AgentToggle.Schema:
            for (const name of alwaysEnabledAgents.schemas) {
                delete options[name];
            }
            return { schemas: options };
        case AgentToggle.Action:
            for (const name of alwaysEnabledAgents.actions) {
                delete options[name];
            }
            return { actions: options };
        case AgentToggle.Command:
            for (const name of alwaysEnabledAgents.commands) {
                delete options[name];
            }
            return { commands: options };
        case AgentToggle.Agent:
            const schemaOptions = Object.fromEntries(
                schemaNames.map((name) => [
                    name,
                    options[getAppAgentName(name)],
                ]),
            );
            const actionOptions = { ...schemaOptions };
            for (const name of alwaysEnabledAgents.schemas) {
                delete schemaOptions[name];
            }
            for (const name of alwaysEnabledAgents.actions) {
                delete actionOptions[name];
            }
            for (const name of alwaysEnabledAgents.commands) {
                delete options[name];
            }
            return {
                schemas: schemaOptions,
                actions: actionOptions,
                commands: options,
            };
    }
}

function setAgentToggleOption(
    existingNames: string[],
    existingNameType: "agent" | "schema",
    options: any,
    nameOrPattern: string[],
    enable: boolean,
    allowOverride: boolean = false,
) {
    for (const name of nameOrPattern) {
        if (name.includes("*")) {
            const regExp = simpleStarRegex(name);
            const matchedNames = existingNames.filter((name) =>
                regExp.test(name),
            );
            if (matchedNames.length === 0) {
                throw new Error(
                    `Invalid ${existingNameType} name pattern '${name}'`,
                );
            }
            for (const name of matchedNames) {
                if (options[name] === !enable) {
                    throw new Error(
                        `Conflicting setting for ${existingNameType} name '${name}'`,
                    );
                }
                options[name] = enable;
            }
        } else {
            if (!existingNames.includes(name)) {
                throw new Error(`Invalid ${existingNameType} name '${name}'`);
            }
            if (options[name] === !enable && !allowOverride) {
                throw new Error(
                    `Conflicting setting for ${existingNameType} name '${name}'`,
                );
            }
            options[name] = enable;
        }
    }
}

type StatusRecords = Record<
    string,
    { schemas?: string; actions?: string; commands?: string }
>;

type ChangedAgent = {
    schemas?: Record<string, boolean | undefined | null> | undefined | null;
    actions?: Record<string, boolean | undefined | null> | undefined | null;
    commands?: Record<string, boolean | undefined | null> | undefined | null;
};

function getDefaultStr(
    changes: ChangedAgent | undefined,
    kind: keyof ChangedAgent,
    name: string,
) {
    if (changes === undefined) {
        return "";
    }
    const change = changes[kind]?.[name];
    if (change === undefined) {
        return undefined;
    }
    return change === null ? " (default)" : "";
}

function setStatus(
    status: StatusRecords,
    kind: keyof ChangedAgent,
    name: string,
    enable: boolean | undefined | null,
    active: boolean,
    changes?: ChangedAgent,
) {
    if (enable === null) {
        return;
    }
    const defaultStr = getDefaultStr(changes, kind, name);
    if (defaultStr === undefined) {
        return;
    }
    if (status[name] === undefined) {
        status[name] = {};
        const appAgentName = getAppAgentName(name);
        if (appAgentName !== name && status[appAgentName] === undefined) {
            // Make sure we have a row for the app agent name even if it doesn't have any status for grouping
            status[appAgentName] = {};
        }
    }

    const statusChar =
        enable === undefined ? "❔" : enable ? (active ? "✅" : "💤") : "❌";
    status[name][kind] = `${statusChar}${defaultStr}`;
}

// HTML-escape a readiness message for safe inclusion in a `title` attribute.
function escapeAttr(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// code-complexity-allow: builds agent-status HTML table; many per-column format branches
function buildAgentStatusHtml(
    entries: [string, StatusRecords[string]][],
    agents: {
        getAppAgentEmoji(name: string): string;
        getReadiness(name: string): ReadinessReport;
        hasUnknownReadiness(name: string): boolean;
        getLoadError(name: string): Error | undefined;
    },
    showSchema: boolean,
    showAction: boolean,
    showCommand: boolean,
): string {
    // Color tokens use `var(--vscode-*, <fallback>)` so the VS Code chat
    // webview picks up the user's theme (light / dark / high-contrast),
    // while other clients (Electron shell, browser UI) — where the
    // --vscode-* CSS variables are undefined — render the original
    // hardcoded slate palette unchanged via the comma-fallback.
    const C_HEADER = "var(--vscode-descriptionForeground,#64748b)";
    const C_HEADER_BORDER = "var(--vscode-panel-border,#e2e8f0)";
    const C_ROW_BORDER = "var(--vscode-panel-border,#f1f5f9)";
    const C_AGENT = "var(--vscode-foreground,#1e293b)";
    const C_SUB = "var(--vscode-descriptionForeground,#475569)";
    const C_ERR = "var(--vscode-errorForeground,#dc2626)";
    const C_UNKNOWN = "var(--vscode-descriptionForeground,#64748b)";
    const C_WARN = "var(--vscode-editorWarning-foreground,#b45309)";

    const thStyle = `text-align:center;padding:4px 8px;font-weight:600;font-size:13px;color:${C_HEADER};border-bottom:2px solid ${C_HEADER_BORDER}`;
    const headerCols = [
        `<th style="text-align:left;padding:4px 12px 4px 8px;font-weight:600;font-size:13px;color:${C_HEADER};border-bottom:2px solid ${C_HEADER_BORDER}">Agent</th>`,
    ];
    if (showSchema) headerCols.push(`<th style="${thStyle}">Schemas</th>`);
    if (showAction) headerCols.push(`<th style="${thStyle}">Actions</th>`);
    if (showCommand) headerCols.push(`<th style="${thStyle}">Commands</th>`);

    const rows: string[] = [];
    for (const [name, { schemas, actions, commands }] of entries) {
        const isAppAgent = getAppAgentName(name) === name;
        const emoji = isAppAgent ? agents.getAppAgentEmoji(name) : "";
        const displayName = isAppAgent ? name : name.replace(/^[^.]+\./, "");
        const indent = isAppAgent ? "0" : "20px";
        const fontWeight = isAppAgent ? "600" : "400";
        const color = isAppAgent ? C_AGENT : C_SUB;
        const bb = isAppAgent ? `1px solid ${C_ROW_BORDER}` : "none";
        const tdStyle = `text-align:center;padding:3px 8px;border-bottom:${bb}`;

        // Per-agent badges (app-agent rows only): load failure first, then
        // readiness warning (or unknown indicator). Distinct icons + colors
        // so they don't get conflated with the disabled-state ❌ in the
        // status columns.
        let warning = "";
        if (isAppAgent) {
            const loadError = agents.getLoadError(name);
            if (loadError !== undefined) {
                const tip = `Failed to load: ${loadError.message ?? String(loadError)}`;
                warning += ` <span title="${escapeAttr(tip)}" style="color:${C_ERR};cursor:help" aria-label="${escapeAttr(tip)}">⛔</span>`;
            }
            if (agents.hasUnknownReadiness(name)) {
                // Agent is known to implement checkReadiness but hasn't
                // been probed this session (typically: currently
                // disabled). We can't probe it without spinning up its
                // session context, so surface the uncertainty instead
                // of implicitly claiming it's ready.
                const tip =
                    "Readiness state unknown — agent is not currently loaded. Enable it (or run `@config agent refresh <name>` after enabling) to re-probe its setup state.";
                warning += ` <span title="${escapeAttr(tip)}" style="color:${C_UNKNOWN};cursor:help" aria-label="${escapeAttr(tip)}">❓</span>`;
            } else {
                const report = agents.getReadiness(name);
                if (report.state !== "ready") {
                    const tip = report.message
                        ? `${report.state}: ${report.message}`
                        : report.state;
                    warning += ` <span title="${escapeAttr(tip)}" style="color:${C_WARN};cursor:help" aria-label="${escapeAttr(tip)}">⚠</span>`;
                }
            }
        }

        const cols = [
            `<td style="padding:3px 12px 3px 8px;padding-left:${indent};font-weight:${fontWeight};color:${color};border-bottom:${bb};white-space:nowrap">${emoji ? emoji + " " : ""}${displayName}${warning}</td>`,
        ];
        if (showSchema)
            cols.push(`<td style="${tdStyle}">${schemas ?? ""}</td>`);
        if (showAction)
            cols.push(`<td style="${tdStyle}">${actions ?? ""}</td>`);
        if (showCommand)
            cols.push(`<td style="${tdStyle}">${commands ?? ""}</td>`);
        rows.push(`<tr>${cols.join("")}</tr>`);
    }

    return `<table style="border-collapse:collapse;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.4"><thead><tr>${headerCols.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// code-complexity-allow: agent enable/disable status handler; many state branches
async function showAgentStatus(
    toggle: AgentToggle,
    context: ActionContext<CommandHandlerContext>,
    changes?: ChangedAgent,
) {
    const systemContext = context.sessionContext.agentContext;
    const agents = systemContext.agents;

    // Bring readiness state up to date for any loaded agent before we
    // render, so the table reflects current reality (env vars, files,
    // etc. may have changed since the agent's last probe). For agents
    // that are disabled (no session context), refreshReadiness is a
    // no-op — only agents known to implement checkReadiness but not
    // currently loaded get a ❓ badge via hasUnknownReadiness.
    await Promise.all(
        agents.getAppAgentNames().map((name) => agents.refreshReadiness(name)),
    );

    const status: StatusRecords = {};

    const showSchema =
        toggle === AgentToggle.Schema || toggle === AgentToggle.Agent;
    const showAction =
        toggle === AgentToggle.Action || toggle === AgentToggle.Agent;
    const showCommand =
        toggle === AgentToggle.Command || toggle === AgentToggle.Agent;

    if (showSchema || showAction) {
        for (const name of agents.getSchemaNames()) {
            const loading = agents.isSchemaLoading(name);
            if (showSchema) {
                const state = agents.isSchemaEnabled(name);
                const active = agents.isSchemaActive(name);
                setStatus(status, "schemas", name, state, active, changes);
                if (loading && status[name] !== undefined) {
                    status[name]["schemas"] = "⏳";
                }
            }

            if (showAction) {
                const state = agents.isActionEnabled(name);
                const active = agents.isActionActive(name);
                setStatus(status, "actions", name, state, active, changes);
                if (loading && status[name] !== undefined) {
                    status[name]["actions"] = "⏳";
                }
            }
        }
    }

    if (showCommand) {
        for (const name of agents.getAppAgentNames()) {
            const state = agents.getCommandEnabledState(name);
            setStatus(status, "commands", name, state, true, changes);
        }
    }

    const entries = Object.entries(status).sort(([a], [b]) =>
        a.localeCompare(b),
    );
    if (entries.length === 0) {
        displayWarn(changes ? "No changes" : "No agents", context);
        return;
    }

    // Build text table (primary — used by CLI and console)
    // Use fixed-width chalk-colored text instead of emoji for reliable alignment
    const textStatus = (s?: string): string => {
        if (!s) return "";
        return s
            .replace("✅", chalk.green("on "))
            .replace("💤", chalk.yellow("zzz"))
            .replace("❌", chalk.red("off"))
            .replace("❔", chalk.gray(" ? "));
    };

    const getTextRow = (
        displayName: string,
        schemas?: string,
        actions?: string,
        commands?: string,
    ) => {
        const displayEntry = [displayName];
        if (showSchema) displayEntry.push(schemas ?? "");
        if (showAction) displayEntry.push(actions ?? "");
        if (showCommand) displayEntry.push(commands ?? "");
        return displayEntry;
    };

    const table: string[][] = [
        getTextRow("Agent", "Schemas", "Actions", "Commands"),
    ];

    for (const [name, { schemas, actions, commands }] of entries) {
        const isAppAgentName = getAppAgentName(name) === name;
        let displayName = isAppAgentName ? name : `  ${name}`;
        if (isAppAgentName) {
            // Plain marker glyphs so they render in CLI/console without
            // needing emoji/glyph fonts. Hover detail lives in the HTML.
            // "(err)" — load failure (provider load / context init / etc.).
            // "(!)"   — agent loaded but reports setup-required / unsupported.
            if (agents.getLoadError(name) !== undefined) {
                displayName = `${displayName} ${chalk.red("(err)")}`;
            }
            if (agents.hasUnknownReadiness(name)) {
                // Implements checkReadiness but not currently loaded.
                // Distinct "(?)" marker so users don't read silence as
                // "this agent is fine" when it actually has a probe.
                displayName = `${displayName} ${chalk.gray("(?)")}`;
            } else {
                const report = agents.getReadiness(name);
                if (report.state !== "ready") {
                    displayName = `${displayName} ${chalk.yellow("(!)")}`;
                }
            }
        }
        table.push(
            getTextRow(
                displayName,
                textStatus(schemas),
                textStatus(actions),
                textStatus(commands),
            ),
        );
    }

    // Build HTML alternate (used by shell and browser UIs)
    const html = buildAgentStatusHtml(
        entries,
        agents,
        showSchema,
        showAction,
        showCommand,
    );

    context.actionIO.appendDisplay({
        type: "text",
        content: table,
        alternates: [{ type: "html", content: html }],
    });
}

class AgentToggleCommandHandler implements CommandHandler {
    public readonly description = `Toggle ${AgentToggleDescription[this.toggle]}`;
    public readonly parameters = {
        flags: {
            reset: {
                description: "reset to default",
                char: "r",
                type: "boolean",
                default: false,
            },
            off: {
                description: "disable pattern",
                multiple: true,
                char: "x",
            },
            priority: {
                description: "priority pattern",
                multiple: true,
                char: "f",
            },
        },
        args: {
            agentNames: {
                description: "enable pattern",
                multiple: true,
                optional: true,
            },
        },
    } as const;
    constructor(private toggle: AgentToggle) {}

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const agents = systemContext.agents;

        const options: Record<string, boolean | null> = {};
        const schemaNames = agents.getSchemaNames();
        let existingNames: string[];
        let existingNameType: "agent" | "schema";
        if (
            this.toggle == AgentToggle.Command ||
            this.toggle === AgentToggle.Agent
        ) {
            existingNames = agents.getAppAgentNames();
            existingNameType = "agent";
        } else {
            existingNames = schemaNames;
            existingNameType = "schema";
        }

        // reset specified agents
        let hasParams = false;
        if (params.flags.reset) {
            hasParams = true;
            for (const name of existingNames) {
                options[name] = null; // default value
            }
        }

        // if priority mode is requested we need to turn off all agents
        // and then enable just the one that we are supposed to prioritize
        if (params.flags.priority) {
            hasParams = true;

            // TODO: implement in agent config/manifests
            const priorityAgents = [
                "dispatcher",
                "system",
                "shell",
                "chat",
                "greeting",
            ];
            const priorityExclusionAgents = existingNames.filter(
                (name) => !priorityAgents.includes(name),
            );

            // disable all agents except system agents
            setAgentToggleOption(
                priorityExclusionAgents,
                existingNameType,
                options,
                ["*"],
                false,
            );

            // enable flagged agent
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.flags.priority,
                true,
                true,
            );
        }

        // turn off the agents specified by the off parameter
        if (params.flags.off) {
            hasParams = true;
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.flags.off,
                false,
            );
        }

        // turn on supplied agents by name
        if (params.args.agentNames) {
            hasParams = true;
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.args.agentNames,
                true,
            );
        }

        // report modified agent status
        if (!hasParams) {
            await showAgentStatus(this.toggle, context);
            return;
        }

        const changed = await changeContextConfig(
            getAgentToggleOptions(this.toggle, options, schemaNames),
            context,
        );

        if (changed === undefined) {
            displayWarn("No change", context);
        } else {
            await showAgentStatus(this.toggle, context, changed);
        }
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];

        for (const name of names) {
            if (name === "agentNames" || name === "--off") {
                const existingNames =
                    this.toggle === AgentToggle.Command ||
                    this.toggle === AgentToggle.Agent
                        ? context.agentContext.agents.getAppAgentNames()
                        : context.agentContext.agents.getSchemaNames();
                completions.push({
                    name,
                    completions: existingNames,
                });
            }
        }

        return { groups: completions };
    }
}

// Validates that `name` is a known agent name and returns its readiness
// report. Throws (caught by executeCommand → displayError) on unknown name.
function getAgentReadinessOrThrow(
    name: string,
    systemContext: CommandHandlerContext,
) {
    const allNames = systemContext.agents.getAppAgentNames();
    if (!allNames.includes(name)) {
        throw new Error(
            `Unknown agent '${name}'. Known agents: ${allNames.join(", ")}`,
        );
    }
    return systemContext.agents.getReadiness(name);
}

class AgentSetupCommandHandler implements CommandHandler {
    public readonly description =
        "Run setup for an agent that needs configuration before use";
    public readonly parameters = {
        args: {
            agentName: {
                description:
                    "agent to set up (omit to list agents that need setup)",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const agents = systemContext.agents;
        const name = params.args.agentName;

        if (name === undefined) {
            const notReady = agents.getNotReadyAgents();
            if (notReady.length === 0) {
                displayResult("All agents are ready.", context);
                return;
            }
            const lines = [
                "Agents that need setup:",
                ...notReady.map(
                    ({ name, report }) =>
                        `  ${name} — ${report.state}${report.message ? `: ${report.message}` : ""}`,
                ),
                "",
                "Run `@config agent setup <name>` to configure one.",
            ];
            displayResult(lines.join("\n"), context);
            return;
        }

        const report = getAgentReadinessOrThrow(name, systemContext);
        if (report.state === "ready") {
            displayResult(`Agent '${name}' is already ready.`, context);
            return;
        }
        if (report.state === "unsupported") {
            displayWarn(
                `Agent '${name}' is not supported in this environment${report.message ? `: ${report.message}` : ""}`,
                context,
            );
            return;
        }
        // setup-required — invoke the agent's setup hook (if any).
        // The setup hook expects an actionContext bound to the target
        // agent's sessionContext (so `actionContext.sessionContext.agentContext`
        // resolves to the agent's own state, not this @config command's
        // CommandHandlerContext). The action-execution path already does
        // this via getActionContext when running NL/action invocations;
        // we mirror it here so `@config agent setup <name>` and the
        // setupOnFirstUse pre-flight path are wired identically.
        //
        // We then emit the result manually via emitActionResult under the
        // TARGET agent's name. If we returned the result for executeCommand
        // to auto-emit, the pendingChoice route would key on the system
        // agent (the one that owns @config), and the user's Yes/No click
        // would be routed to the wrong agent's handleChoice — the
        // registered callback in the target agent's ChoiceManager would
        // never fire, leaving the card silently unactionable.
        const requestId = getRequestId(systemContext);
        const { actionContext: agentActionContext, closeActionContext } =
            getActionContext(name, systemContext, requestId);
        let result;
        try {
            result = await agents.runSetup(
                name,
                agentActionContext,
                systemContext,
            );
            if (result !== undefined) {
                emitActionResult(
                    result,
                    agentActionContext,
                    systemContext,
                    requestId,
                    name,
                    0,
                    name,
                );
            }
        } finally {
            closeActionContext();
        }
        if (result === undefined) {
            // Agent reports setup-required but doesn't implement a setup
            // hook — typically a manual-config case (env vars, files
            // outside the agent's reach). Show the readiness message as
            // the primary content and point at @config agent refresh so
            // the user can re-check after fixing the underlying issue.
            const lines = [
                `Agent '${name}' needs configuration before it can be used.`,
            ];
            if (report.message) lines.push("", report.message);
            if (report.details) lines.push("", report.details);
            lines.push(
                "",
                `This agent does not have an in-chat setup flow. After fixing the underlying issue, run \`@config agent refresh ${name}\` to re-check.`,
            );
            displayWarn(lines.join("\n"), context);
            return;
        }
        // emitActionResult above already rendered the display content and
        // wired pendingChoice to the target agent. Returning undefined
        // here keeps executeCommand from re-emitting under the system
        // agent's name (which would mis-route the choice click).
        return;
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "agentName") {
                completions.push({
                    name,
                    completions: context.agentContext.agents
                        .getNotReadyAgents()
                        .map((e) => e.name),
                });
            }
        }
        return { groups: completions };
    }
}

class AgentRefreshCommandHandler implements CommandHandler {
    public readonly description =
        "Re-check an agent's readiness state (or all agents)";
    public readonly parameters = {
        args: {
            agentName: {
                description: "agent to refresh (omit for all enabled agents)",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const agents = systemContext.agents;
        const name = params.args.agentName;

        if (name !== undefined) {
            getAgentReadinessOrThrow(name, systemContext); // validate name
            const report = await agents.refreshReadiness(name);
            displayResult(
                `${name}: ${report.state}${report.message ? ` — ${report.message}` : ""}`,
                context,
            );
            return;
        }
        const lines: string[] = [];
        for (const agentName of agents.getAppAgentNames()) {
            const report = await agents.refreshReadiness(agentName);
            if (report.state !== "ready") {
                lines.push(
                    `${agentName}: ${report.state}${report.message ? ` — ${report.message}` : ""}`,
                );
            }
        }
        displayResult(
            lines.length === 0 ? "All agents are ready." : lines.join("\n"),
            context,
        );
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "agentName") {
                completions.push({
                    name,
                    completions: context.agentContext.agents.getAppAgentNames(),
                });
            }
        }
        return { groups: completions };
    }
}

class ExplainerCommandHandler implements CommandHandler {
    public readonly description = "Set explainer";
    public readonly parameters = {
        args: {
            explainerName: {
                description: "name of the explainer",
            },
        },
    };
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const current =
            context.sessionContext.agentContext.session.getConfig().explainer
                .name;
        if (current === params.args.explainerName) {
            displayWarn(
                `Explainer is already set to ${params.args.explainerName}`,
                context,
            );
            return;
        }
        const changed = await changeContextConfig(
            { explainer: { name: params.args.explainerName } },
            context,
        );
        if (changed?.explainer?.name === params.args.explainerName) {
            displayResult(
                `Explainer is set to ${params.args.explainerName}`,
                context,
            );
        } else {
            displayWarn(`Explainer is unchanged`, context);
        }
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "explainerName") {
                completions.push({
                    name,
                    completions: getCacheFactory().getExplainerNames(),
                });
            }
        }
        return { groups: completions };
    }
}

function getConfigModel(kind: string, model: string) {
    const settings = ai.getChatModelSettings(model);
    return `Current ${chalk.cyan(kind)} model: ${model ? model : "(default)"}\nURL:${settings.endpoint}`;
}

class ConfigModelSetCommandHandler implements CommandHandler {
    public readonly description = "Set model";
    public readonly parameters = {
        flags: {
            reset: {
                description: "Reset to default model",
                char: "r",
                type: "boolean",
                default: false,
            },
        },
        args: {
            model: {
                description: "Model name",
                optional: true,
            },
        },
    } as const;
    public constructor(private readonly kind: "translation" | "explainer") {}
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const reset = params.flags.reset;
        const model = params.args.model;
        if (reset || model === "") {
            if (model !== undefined && model !== "") {
                throw new Error("Model name is not allowed with reset option");
            }
            const config: SessionOptions = {};
            config[this.kind] = { model: "" };
            await changeContextConfig(config, context);
            displayResult(`Reset to default model for ${this.kind}`, context);
            return;
        }
        if (model === undefined) {
            const config =
                context.sessionContext.agentContext.session.getConfig();
            displayResult(
                getConfigModel(this.kind, config[this.kind].model),
                context,
            );
            return;
        }
        const modelNames = await getChatModelNames();
        if (!modelNames.includes(model)) {
            throw new Error(
                `Invalid model name: ${model}\nValid model names: ${modelNames.join(", ")}`,
            );
        } else {
            displayResult(`Model for ${this.kind} is set to ${model}`, context);
        }
        const config: SessionOptions = {};
        config[this.kind] = { model };
        await changeContextConfig(config, context);
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<CompletionGroups> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "model") {
                completions.push({
                    name,
                    completions: await getChatModelNames(),
                });
            }
        }

        return { groups: completions };
    }
}

class ConfigTranslationNumberOfInitialActionsCommandHandler
    implements CommandHandler
{
    public readonly description =
        "Set number of actions to use for initial translation";
    public readonly parameters = {
        args: {
            count: {
                description: "Number of actions",
                type: "number",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const count = params.args.count;
        if (count < 0) {
            throw new Error("Count must be positive integer");
        }
        await changeContextConfig(
            {
                translation: {
                    schema: {
                        optimize: {
                            numInitialActions: count,
                        },
                    },
                },
            },
            context,
        );
        displayResult(
            `Number of actions to use for initial translation is set to ${count}`,
            context,
        );
    }
}

class FixedSchemaCommandHandler implements CommandHandler {
    public readonly description = "Set a fixed schema disable switching";
    public readonly parameters = {
        args: {
            schemaName: {
                description: "name of the schema",
            },
        },
    };
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const schemaName = params.args.schemaName;
        const systemContext = context.sessionContext.agentContext;
        if (!systemContext.agents.isActionActive(schemaName)) {
            throw new Error(`Schema '${schemaName}' is not active.`);
        }
        await changeContextConfig(
            {
                translation: {
                    switch: {
                        embedding: false,
                        inline: false,
                        search: false,
                    },
                },
            },
            context,
        );
        context.sessionContext.agentContext.lastActionSchemaName = schemaName;
        displayResult(
            `Switching schema disabled. Schema is fixed set to '${schemaName}'`,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<CompletionGroups> {
        const completions: CompletionGroup[] = [];
        const systemContext = context.agentContext;
        for (const name of names) {
            if (name === "schemaName") {
                completions.push({
                    name,
                    completions: systemContext.agents.getActiveSchemas(),
                });
            }
        }
        return { groups: completions };
    }
}

class HistoryLimitCommandHandler implements CommandHandler {
    public readonly description =
        "Set the limit of chat history usage in translation";
    public readonly parameters = {
        args: {
            limit: {
                description: "Number of actions",
                type: "number",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const limit = params.args.limit;
        if (limit < 0) {
            throw new Error("Limit must be positive integer");
        }
        await changeContextConfig(
            {
                translation: {
                    history: {
                        limit: limit,
                    },
                },
            },
            context,
        );
        displayResult(
            `Chat history used in translation limit is set to ${limit}`,
            context,
        );
    }
}

class GrammarSystemCommandHandler implements CommandHandler {
    public readonly description = "Set grammar system (completionBased or nfa)";
    public readonly parameters = {
        args: {
            system: {
                description: "Grammar system to use",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const system = params.args.system;
        if (system !== "completionBased" && system !== "nfa") {
            displayWarn(
                `Invalid grammar system '${system}'. Must be 'completionBased' or 'nfa'.`,
                context,
            );
            return;
        }
        await changeContextConfig(
            { cache: { grammarSystem: system } },
            context,
        );
        displayResult(`Grammar system set to '${system}'.`, context);
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "system") {
                completions.push({
                    name,
                    completions: ["completionBased", "nfa"],
                });
            }
        }
        return { groups: completions };
    }
}
class GrammarUseDFACommandHandler implements CommandHandler {
    public readonly description =
        "Enable or disable DFA matching within the NFA grammar system (faster; requires grammarSystem=nfa)";
    public readonly parameters = {
        args: {
            enabled: {
                description: "true or false",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const value = params.args.enabled;
        if (value !== "true" && value !== "false") {
            displayWarn(
                `Invalid value '${value}'. Must be 'true' or 'false'.`,
                context,
            );
            return;
        }
        const useDFA = value === "true";
        await changeContextConfig({ cache: { useDFA } }, context);
        displayResult(
            `DFA matching ${useDFA ? "enabled" : "disabled"}.`,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "enabled") {
                completions.push({ name, completions: ["true", "false"] });
            }
        }
        return { groups: completions };
    }
}

const configTranslationCommandHandlers: CommandHandlerTable = {
    description: "Translation configuration",
    defaultSubCommand: "on",
    commands: {
        ...getToggleCommandHandlers("translation", async (context, enable) => {
            await changeContextConfig(
                { translation: { enabled: enable } },
                context,
            );
        }),
        model: new ConfigModelSetCommandHandler("translation"),
        multi: {
            description: "multiple actions",
            commands: {
                ...getToggleCommandHandlers(
                    "multiple action translation",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { multiple: { enabled: enable } } },
                            context,
                        );
                    },
                ),
                result: getToggleHandlerTable(
                    "result id in multiple action",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { multiple: { result: enable } } },
                            context,
                        );
                    },
                ),
                pending: getToggleHandlerTable(
                    "pending request in multiple action",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { multiple: { pending: enable } } },
                            context,
                        );
                    },
                ),
            },
        },
        switch: {
            description: "auto switch schemas",
            commands: {
                ...getToggleCommandHandlers(
                    "switch schema",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    switch: {
                                        embedding: enable,
                                        inline: enable,
                                        search: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
                fix: new FixedSchemaCommandHandler(),
                inline: getToggleHandlerTable(
                    "inject inline switch",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    switch: {
                                        inline: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
                search: getToggleHandlerTable(
                    "search switch",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    switch: {
                                        search: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
                embedding: getToggleHandlerTable(
                    "Use embedding for initial pick of schema",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    switch: {
                                        embedding: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
            },
        },
        history: {
            description: "Configure chat history usage in translation",
            commands: {
                ...getToggleCommandHandlers(
                    "history",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { history: { enabled: enable } } },
                            context,
                        );
                    },
                ),
                limit: new HistoryLimitCommandHandler(),
            },
        },

        stream: getToggleHandlerTable(
            "streaming translation",
            async (context, enable: boolean) => {
                await changeContextConfig(
                    { translation: { stream: enable } },
                    context,
                );
            },
        ),
        schema: {
            description: "Action schema configuration",
            commands: {
                generation: {
                    description: "Generated action schema",
                    commands: {
                        ...getToggleCommandHandlers(
                            "generated action schema",
                            async (context, enable: boolean) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                generation: {
                                                    enabled: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        json: getToggleHandlerTable(
                            "use generate json schema if model supports it",
                            async (context, enable: boolean) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                generation: {
                                                    jsonSchema: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        jsonFunc: getToggleHandlerTable(
                            "use generate json schema function if model supports it",
                            async (context, enable: boolean) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                generation: {
                                                    jsonSchemaFunction: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                    },
                },
                optimize: {
                    description: "Optimize schema",
                    commands: {
                        ...getToggleCommandHandlers(
                            "schema optimization",
                            async (context, enable) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                optimize: {
                                                    enabled: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        actions:
                            new ConfigTranslationNumberOfInitialActionsCommandHandler(),
                    },
                },
            },
        },
        entity: {
            description: "Entity translation configuration",
            commands: {
                resolve: getToggleHandlerTable(
                    "entity resolution",
                    async (context, enable) => {
                        await changeContextConfig(
                            { translation: { entity: { resolve: enable } } },
                            context,
                        );
                    },
                ),
                filter: getToggleHandlerTable(
                    "entity filter using LLM",
                    async (context, enable) => {
                        await changeContextConfig(
                            { translation: { entity: { filter: enable } } },
                            context,
                        );
                    },
                ),
                clarify: getToggleHandlerTable(
                    "entity clarification",
                    async (context, enable) => {
                        await changeContextConfig(
                            { translation: { entity: { clarify: enable } } },
                            context,
                        );
                    },
                ),
            },
        },
    },
};

async function checkRequestHandler(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    throwIfFailed: boolean = true,
) {
    const result = await resolveCommand(
        `${appAgentName} request`,
        systemContext,
    );
    if (result.descriptor === undefined) {
        if (throwIfFailed) {
            throw new Error(
                `AppAgent '${appAgentName}' doesn't have request command handler`,
            );
        }
        return false;
    }

    const args = result.descriptor.parameters?.args;
    if (args === undefined) {
        if (throwIfFailed) {
            throw new Error(
                `AppAgent '${appAgentName}' request command handler doesn't accept any parameter for natural language requests`,
            );
        }
        return false;
    }

    const entries = Object.entries(args);
    if (entries.length !== 1 || entries[0][1].implicitQuotes !== true) {
        if (throwIfFailed) {
            throw new Error(
                `AppAgent '${appAgentName}' request command handler doesn't accept parameters resembling natural language requests`,
            );
        }
        return false;
    }
    return true;
}

class ConfigRequestCommandHandler implements CommandHandler {
    public readonly description =
        "Set the agent that handle natural language requests";
    public readonly parameters = {
        args: {
            appAgentName: {
                description: "name of the agent",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const appAgentName = params.args.appAgentName;
        const systemContext = context.sessionContext.agentContext;
        const current = systemContext.session.getConfig().request;
        if (current === appAgentName) {
            displayWarn(
                `Natural langue request handling agent is already set to '${appAgentName}'`,
                context,
            );
            return;
        }

        await checkRequestHandler(appAgentName, systemContext);
        await changeContextConfig({ request: appAgentName }, context);

        displayResult(
            `Natural langue request handling agent is set to '${appAgentName}'`,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<CompletionGroups> {
        const completions: CompletionGroup[] = [];
        const systemContext = context.agentContext;
        for (const name of names) {
            if (name === "appAgentName") {
                const appAgentNames: string[] = [];
                for (const appAgentName of systemContext.agents.getAppAgentNames()) {
                    if (
                        await checkRequestHandler(
                            appAgentName,
                            systemContext,
                            false,
                        )
                    ) {
                        appAgentNames.push(appAgentName);
                    }
                }
                if (appAgentNames.length !== 0) {
                    completions.push({
                        name,
                        completions: appAgentNames,
                    });
                }
            }
        }
        return { groups: completions };
    }
}

const configExplainerCommandHandlers: CommandHandlerTable = {
    description: "Explainer configuration",
    defaultSubCommand: "on",
    commands: {
        ...getToggleCommandHandlers("explanation", async (context, enable) => {
            await changeContextConfig(
                { explainer: { enabled: enable } },
                context,
            );
        }),
        async: getToggleHandlerTable(
            "asynchronous explanation",
            async (context, enable) => {
                context.sessionContext.agentContext.explanationAsynchronousMode =
                    enable;
            },
        ),
        name: new ExplainerCommandHandler(),
        model: new ConfigModelSetCommandHandler("explainer"),
        filter: {
            description: "Toggle explanation filter",
            defaultSubCommand: "on",
            commands: {
                ...getToggleCommandHandlers(
                    "all explanation filters",
                    async (context, enable) => {
                        await changeContextConfig(
                            {
                                explainer: {
                                    filter: {
                                        multiple: enable,
                                        reference: {
                                            value: enable,
                                            list: enable,
                                            translate: enable,
                                        },
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
                multiple: getToggleHandlerTable(
                    "explanation filter multiple actions",
                    async (context, enable) => {
                        await changeContextConfig(
                            {
                                explainer: {
                                    filter: {
                                        multiple: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
                reference: {
                    description: "Toggle reference filter",
                    defaultSubCommand: "on",
                    commands: {
                        ...getToggleCommandHandlers(
                            "all explanation reference filters",
                            async (context, enable) => {
                                await changeContextConfig(
                                    {
                                        explainer: {
                                            filter: {
                                                reference: {
                                                    value: enable,
                                                    list: enable,
                                                    translate: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        value: getToggleHandlerTable(
                            "explainer filter reference by value in the request",
                            async (context, enable) => {
                                await changeContextConfig(
                                    {
                                        explainer: {
                                            filter: {
                                                reference: {
                                                    value: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        list: getToggleHandlerTable(
                            "explainer filter reference using word lists",
                            async (context, enable) => {
                                await changeContextConfig(
                                    {
                                        explainer: {
                                            filter: {
                                                reference: {
                                                    list: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        translate: getToggleHandlerTable(
                            "explainer filter reference by translate without context",
                            async (context, enable) => {
                                await changeContextConfig(
                                    {
                                        explainer: {
                                            filter: {
                                                reference: {
                                                    translate: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                    },
                },
            },
        },
    },
};

class ConfigExecutionReasoningCommandHandler implements CommandHandler {
    public readonly description = "Set reasoning engine";
    public readonly parameters = {
        args: {
            engine: {
                description:
                    "Reasoning engine to use (claude, copilot, or none). Omit to show the current engine.",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const engine = params.args.engine;
        if (engine === undefined) {
            displayResult(
                `Reasoning engine is '${context.sessionContext.agentContext.session.getConfig().execution.reasoning}'`,
                context,
            );
            return;
        }
        if (engine === "claude" || engine === "copilot" || engine === "none") {
            const systemContext = context.sessionContext.agentContext;
            const strategy =
                systemContext.session.getConfig().execution.conversationAnswer;
            // Turning reasoning off while the answer strategy relies on it
            // ("reasoning-only" disables the conversation-lookup action) would
            // leave conversation questions unanswerable — re-enable the lookup
            // action in that case.
            const agentToggle: Record<string, boolean> = {
                "dispatcher.reasoning": engine !== "none",
            };
            if (engine === "none" && strategy === "reasoning-only") {
                agentToggle["dispatcher.lookup"] = true;
            }
            await changeContextConfig(
                {
                    translation: { multiple: { enabled: engine === "none" } },
                    execution: { reasoning: engine },
                    schemas: agentToggle,
                    actions: agentToggle,
                },
                context,
            );
            displayResult(`Reasoning engine is set to '${engine}'`, context);
            debugReasoning(
                `Reasoning engine changed to '${engine}' by user command`,
            );
        } else {
            debugReasoning(
                `Invalid reasoning engine '${engine}' provided by user command`,
            );

            throw new Error(
                `Invalid reasoning engine: ${engine}\nValid options: claude, copilot, none`,
            );
        }
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<CompletionGroups> {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "engine") {
                completions.push({
                    name,
                    completions: ["claude", "copilot", "none"],
                });
            }
        }
        return { groups: completions };
    }
}

class ConfigExecutionReasoningModelCommandHandler implements CommandHandler {
    public readonly description =
        "Set the Copilot reasoning model (e.g. claude-opus-4.8). Omit to show the current value.";
    public readonly parameters = {
        args: {
            model: {
                description:
                    "Model identifier for Copilot reasoning. Omit to show the current value.",
                optional: true,
            },
        },
    } as const;
    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const model = params.args.model;
        const current =
            context.sessionContext.agentContext.session.getConfig().execution
                .reasoningModel;
        if (model === undefined) {
            return displayResult(
                current
                    ? `Reasoning model is '${current}'`
                    : "Reasoning model is not overridden (using the configured default)",
                context,
            );
        }
        await changeContextConfig(
            { execution: { reasoningModel: model } },
            context,
        );
        return displayResult(`Reasoning model is set to '${model}'`, context);
    }
}

class ConfigExecutionReasoningEffortCommandHandler implements CommandHandler {
    public readonly description =
        "Set the Copilot reasoning effort (low, medium, high, xhigh). Only applies to models that support it. Omit to show the current value.";
    public readonly parameters = {
        args: {
            effort: {
                description:
                    "'low', 'medium', 'high', or 'xhigh'. Omit to show the current value.",
                type: "string" as const,
                enum: ["low", "medium", "high", "xhigh"],
                optional: true,
            },
        },
    } as const;
    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const effort = params.args.effort as
            | "low"
            | "medium"
            | "high"
            | "xhigh"
            | undefined;
        const current =
            context.sessionContext.agentContext.session.getConfig().execution
                .reasoningEffort;
        if (effort === undefined) {
            return displayResult(
                current
                    ? `Reasoning effort is '${current}'`
                    : "Reasoning effort is not overridden (using the configured default)",
                context,
            );
        }
        await changeContextConfig(
            { execution: { reasoningEffort: effort } },
            context,
        );
        return displayResult(`Reasoning effort is set to '${effort}'`, context);
    }
}

class ConfigExecutionPlanReuseCommandHandler implements CommandHandler {
    public readonly description =
        "Enable or disable workflow plan reuse for reasoning actions";
    public readonly parameters = {
        args: {
            mode: {
                description:
                    "Plan reuse mode: 'enabled' to cache and reuse workflow plans, 'disabled' for standard reasoning. Omit to show the current value.",
                type: "string" as const,
                enum: ["enabled", "disabled"],
                optional: true,
            },
        },
    } as const;

    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const mode = params.args.mode as "enabled" | "disabled" | undefined;
        if (mode === undefined) {
            return displayResult(
                `Plan reuse is '${context.sessionContext.agentContext.session.getConfig().execution.planReuse}'`,
                context,
            );
        }

        await changeContextConfig({ execution: { planReuse: mode } }, context);

        return displayResult(`Plan reuse ${mode}`, context);
    }
}

class ConfigExecutionScriptReuseCommandHandler implements CommandHandler {
    public readonly description =
        "Enable or disable PowerShell script reuse for reasoning actions";
    public readonly parameters = {
        args: {
            mode: {
                description:
                    "Script reuse mode: 'enabled' to capture and reuse PowerShell scripts, 'disabled' for standard reasoning. Omit to show the current value.",
                type: "string" as const,
                enum: ["enabled", "disabled"],
                optional: true,
            },
        },
    } as const;

    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const mode = params.args.mode as "enabled" | "disabled" | undefined;
        if (mode === undefined) {
            return displayResult(
                `Script reuse is '${context.sessionContext.agentContext.session.getConfig().execution.scriptReuse}'`,
                context,
            );
        }

        await changeContextConfig(
            { execution: { scriptReuse: mode } },
            context,
        );

        return displayResult(`Script reuse ${mode}`, context);
    }
}

class ConfigExecutionConversationAnswerCommandHandler
    implements CommandHandler
{
    public readonly description =
        "How conversation questions are answered: 'lookup' (conversation-memory lookup, reasoning as fallback), 'reasoning-first' (reasoning agent primary, lookup as fallback), or 'reasoning-only' (remove the lookup action; reasoning handles conversation Q&A)";
    public readonly parameters = {
        args: {
            strategy: {
                description:
                    "'lookup' (default), 'reasoning-first', or 'reasoning-only'. Omit to show the current strategy.",
                type: "string" as const,
                enum: ["lookup", "reasoning-first", "reasoning-only"],
                optional: true,
            },
        },
    } as const;

    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const strategy = params.args.strategy as
            | "lookup"
            | "reasoning-first"
            | "reasoning-only"
            | undefined;
        if (strategy === undefined) {
            return displayResult(
                `Conversation answer strategy is '${systemContext.session.getConfig().execution.conversationAnswer}'`,
                context,
            );
        }
        const engine = systemContext.session.getConfig().execution.reasoning;

        // "reasoning-only" removes the conversation-lookup action from
        // translation — but only when a reasoning engine is actually available,
        // otherwise the user would have no way to answer conversation
        // questions. In that case the lookup action stays enabled.
        const disableLookup =
            strategy === "reasoning-only" && engine !== "none";
        const agentToggle = {
            "dispatcher.lookup": !disableLookup,
        } as const;

        await changeContextConfig(
            {
                execution: { conversationAnswer: strategy },
                schemas: agentToggle,
                actions: agentToggle,
            },
            context,
        );

        let message = `Conversation answer strategy is set to '${strategy}'`;
        if (strategy !== "lookup" && engine === "none") {
            message +=
                "\nNote: reasoning engine is 'none' — set one with '@config execution reasoning claude|copilot' for this to take effect. Conversation lookup remains enabled until then.";
        }
        return displayResult(message, context);
    }
}

class ConfigExecutionReasoningHistoryCommandHandler implements CommandHandler {
    public readonly description =
        "Number of recent conversation turns included as context in the reasoning prompt";
    public readonly parameters = {
        args: {
            turns: {
                description:
                    "Number of recent conversation turns to include (e.g. 4). 0 disables history. Omit to show the current value.",
                type: "number" as const,
                optional: true,
            },
        },
    } as const;

    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const turns = params.args.turns;
        if (turns === undefined) {
            return displayResult(
                `Reasoning history turns is ${context.sessionContext.agentContext.session.getConfig().execution.reasoningHistoryTurns}`,
                context,
            );
        }
        if (!Number.isInteger(turns) || turns < 0) {
            throw new Error(
                `Invalid number of turns: ${turns}. Must be a non-negative integer.`,
            );
        }
        await changeContextConfig(
            { execution: { reasoningHistoryTurns: turns } },
            context,
        );
        return displayResult(
            `Reasoning history turns is set to ${turns}`,
            context,
        );
    }
}

class ConfigExecutionEntityPromptShapeCommandHandler implements CommandHandler {
    public readonly description =
        "Shape used when serializing Entity objects into LLM prompts";
    public readonly parameters = {
        args: {
            shape: {
                description:
                    "'facets' (default, name+value array), 'flat' (collapse facets into a properties object), or 'facets-with-schema' (facets + append the Entity TS type to the reasoning system prompt). Omit to show the current value.",
                type: "string" as const,
                enum: ["facets", "flat", "facets-with-schema"],
                optional: true,
            },
        },
    } as const;

    async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const shape = params.args.shape as
            | "facets"
            | "flat"
            | "facets-with-schema"
            | undefined;
        if (shape === undefined) {
            return displayResult(
                `Entity prompt shape is '${context.sessionContext.agentContext.session.getConfig().execution.entityPromptShape}'`,
                context,
            );
        }

        await changeContextConfig(
            { execution: { entityPromptShape: shape } },
            context,
        );

        return displayResult(`Entity prompt shape: ${shape}`, context);
    }
}

const configExecutionCommandHandlers: CommandHandlerTable = {
    description: "Execution configuration",
    commands: {
        activity: getToggleHandlerTable(
            "activity context",
            async (context, enable) => {
                toggleActivityContext(
                    context.sessionContext.agentContext,
                    enable,
                );
            },
        ),
        reasoning: new ConfigExecutionReasoningCommandHandler(),
        reasoningModel: new ConfigExecutionReasoningModelCommandHandler(),
        reasoningEffort: new ConfigExecutionReasoningEffortCommandHandler(),
        conversationAnswer:
            new ConfigExecutionConversationAnswerCommandHandler(),
        reasoningHistory: new ConfigExecutionReasoningHistoryCommandHandler(),
        recordUserMessages: getToggleHandlerTable(
            "record the user's own messages in the conversation transcript (chat history)",
            async (context, enable) => {
                await changeContextConfig(
                    { execution: { recordUserMessages: enable } },
                    context,
                );
            },
        ),
        planReuse: new ConfigExecutionPlanReuseCommandHandler(),
        scriptReuse: new ConfigExecutionScriptReuseCommandHandler(),
        entityPromptShape: new ConfigExecutionEntityPromptShapeCommandHandler(),
        setupOnFirstUse: getToggleHandlerTable(
            "auto-run agent setup on first use (otherwise emit a hint to run @config agent setup)",
            async (context, enable) => {
                await changeContextConfig(
                    { execution: { setupOnFirstUse: enable } },
                    context,
                );
            },
        ),
    },
};

function isProviderMode(s: string): s is ProviderMode {
    return (PROVIDER_MODES as readonly string[]).includes(s);
}

function effectiveProvider(): ProviderMode {
    return getActiveModelProvider() ?? "azure";
}

// code-complexity-allow: per-provider model enumeration; one branch per provider
async function listModelsForProvider(
    provider: ProviderMode,
    context: ActionContext<CommandHandlerContext>,
): Promise<void> {
    const names = await getChatModelNames();
    const matched: string[] = [];
    switch (provider) {
        case "azure":
            // Azure entries in getChatModelNames have no prefix.
            for (const n of names) {
                if (
                    !n.startsWith("openai:") &&
                    !n.startsWith("ollama:") &&
                    !n.startsWith("copilot:")
                ) {
                    matched.push(n);
                }
            }
            break;
        case "openai":
            for (const n of names) if (n.startsWith("openai:")) matched.push(n);
            break;
        case "ollama":
            for (const n of names) if (n.startsWith("ollama:")) matched.push(n);
            break;
        case "copilot":
            for (const n of names)
                if (n.startsWith("copilot:")) matched.push(n);
            break;
    }

    const lines = [`Models available under '${provider}':`];
    if (matched.length === 0) {
        lines.push("  (none configured)");
    } else {
        for (const m of matched) lines.push(`  ${m}`);
    }

    // For copilot, also surface auth status so users can debug "why
    // does the list look short?" without a second command.
    if (provider === "copilot") {
        try {
            const client = await getCopilotClient();
            const status = await client.getAuthStatus();
            lines.push("");
            lines.push(
                `Copilot CLI: ${status.isAuthenticated ? "authenticated" : "NOT authenticated"}` +
                    (status.login ? ` (${status.login})` : ""),
            );
            if (!status.isAuthenticated) {
                lines.push(
                    "Run 'copilot auth login' or 'gh auth login --scopes copilot' to sign in.",
                );
            }
        } catch (e) {
            lines.push("");
            lines.push(
                `Copilot CLI unavailable: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
    displayResult(lines.join("\n"), context);
}

class ConfigModelProviderCommandHandler implements CommandHandler {
    public readonly description =
        "Show or set the active model provider (azure | openai | ollama | copilot)";
    public readonly parameters = {
        args: {
            name: {
                description:
                    "Provider to activate (azure | openai | ollama | copilot)",
                optional: true,
            },
            action: {
                description: "Optional 'list' to list provider's models",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const name = params.args.name;
        const action = params.args.action;

        // Bare: show available providers, mark current.
        if (name === undefined) {
            const current = effectiveProvider();
            const yamlConfigured = getRuntimeConfig().modelProvider;
            const lines = ["Available model providers:"];
            for (const m of PROVIDER_MODES) {
                const marker = m === current ? " (current)" : "";
                lines.push(`  ${m}${marker}`);
            }
            if (yamlConfigured === undefined) {
                lines.push("");
                lines.push(
                    "No override is active by default — resolution falls back to Azure.",
                );
            }
            displayResult(lines.join("\n"), context);
            return;
        }

        if (!isProviderMode(name)) {
            throw new Error(
                `Invalid provider '${name}'. Valid providers: ${PROVIDER_MODES.join(", ")}`,
            );
        }

        // <name> list: list provider's models.
        if (action !== undefined) {
            if (action !== "list") {
                throw new Error(
                    `Invalid action '${action}'. Only 'list' is supported.`,
                );
            }
            await listModelsForProvider(name, context);
            return;
        }

        // <name>: set active provider.
        const previous = getActiveModelProvider();
        setActiveModelProvider(name);
        // Clear cached translators so the next translation picks up the
        // new provider mapping.
        context.sessionContext.agentContext.translatorCache.clear();

        const previousLabel = previous ?? "azure (default)";
        displayResult(`Model provider: ${previousLabel} → ${name}`, context);
    }

    public async getCompletion(
        _context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<CompletionGroups> {
        const completions: CompletionGroup[] = [];
        for (const n of names) {
            if (n === "name") {
                completions.push({
                    name: n,
                    completions: [...PROVIDER_MODES],
                });
            } else if (n === "action") {
                completions.push({
                    name: n,
                    completions: ["list"],
                });
            }
        }
        return { groups: completions };
    }
}

// ---------------------------------------------------------------------------
// `@config collision …` — runtime config surface for action-collision detection.
//
// Why this exists: the collision detection subsystem ships off-by-default,
// and the soft-rollout plan (`docs/architecture/collision/collision-rollout.md`)
// requires testers to opt in per detection point without hand-editing the
// session JSON.  This handler is the M1 milestone: the shell-level toggle
// that drives every Phase 1/2 experiment.  All flips route through
// `changeContextConfig`, which calls `session.updateSettings` — that
// already persists to `data.json` and re-applies in-memory, so settings
// survive shell restart.
//
// Coverage scope: detect on/off, strategy, priorityOrder, telemetry
// emit/debugLog.  Calibration knobs (classifier, topN, threshold, scorer,
// similarityThreshold) are intentionally not exposed here — they're
// long-tail tuning, not opt-in toggles, and the same JSON file accepts
// hand edits.  We can add focused subcommands for those if a phase-2
// experiment ends up needing repeated changes.
// ---------------------------------------------------------------------------

type CollisionPoint = "static" | "grammarMatch" | "llmSelect" | "fuzzy";

const COLLISION_POINTS: readonly CollisionPoint[] = [
    "static",
    "grammarMatch",
    "llmSelect",
    "fuzzy",
];

// Strategy enums per detection point.  `static` uses warn/error;
// the three runtime points share the four-way `CollisionStrategy` enum.
const STATIC_STRATEGIES = ["warn", "error"] as const;
const RUNTIME_STRATEGIES = [
    "first-match",
    "score-rank",
    "priority",
    "user-clarify",
    "preference-clarify",
] as const;

function strategiesFor(point: CollisionPoint): readonly string[] {
    return point === "static" ? STATIC_STRATEGIES : RUNTIME_STRATEGIES;
}

// ---- HTML rendering helpers for `@config collision` ----
//
// Inline `style="…"` everywhere because the shell sanitizer strips
// <style> blocks (same constraint as the grammar collision renderer in
// grammarCommandHandlers.ts).  Color palette is consistent across both
// reports so badges read the same.

function escapeHtml(s: unknown): string {
    const str = typeof s === "string" ? s : String(s);
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function statusPill(on: boolean, label?: string): string {
    const text = label ?? (on ? "on" : "off");
    const bg = on ? "#dfd" : "#eee";
    const fg = on ? "#070" : "#888";
    return (
        `<span style="display:inline-block;padding:1px 8px;border-radius:10px;` +
        `font-size:11px;font-weight:600;color:${fg};background:${bg};">${escapeHtml(text)}</span>`
    );
}

function strategyPill(
    strategy: string,
    isDefault: boolean,
    risky: boolean,
): string {
    const bg = isDefault ? "#eee" : risky ? "#fee" : "#e8f0ff";
    const fg = isDefault ? "#888" : risky ? "#c44" : "#36c";
    return (
        `<span style="display:inline-block;padding:1px 8px;border-radius:10px;` +
        `font-family:monospace;font-size:11px;font-weight:600;color:${fg};background:${bg};">${escapeHtml(strategy)}</span>`
    );
}

function pointDescription(point: CollisionPoint): string {
    switch (point) {
        case "static":
            return "duplicate actionName at agent registration";
        case "grammarMatch":
            return "multiple validated cache matches at runtime";
        case "llmSelect":
            return "ambiguous embedding-pick during LLM translation";
        case "fuzzy":
            return "semantic action overlap (fuzzy)";
    }
}

function renderCollisionShowHTML(cfg: {
    static: { detect: boolean; strategy: string };
    grammarMatch: {
        detect: boolean;
        strategy: string;
        classifier: string;
    };
    llmSelect: {
        detect: boolean;
        strategy: string;
        topN: number;
        scoreDeltaThreshold: number;
    };
    fuzzy: {
        detect: boolean;
        strategy: string;
        staticEnabled: boolean;
        runtimeEnabled: boolean;
        scorer: string;
        similarityThreshold: number;
    };
    priorityOrder: string;
    multipleActionBehavior: string;
    telemetry: {
        emit: boolean;
        debugLog: boolean;
        experimentId?: string | undefined;
    };
    preference: {
        enabled: boolean;
        ambiguitySource: string;
        registryPath: string;
        registryFirst: boolean;
        remember: string;
    };
    contextSelector: {
        detect: boolean;
        windowTurns: number;
        decay: number;
        minUniqueTokens: number;
        minMass: number;
        margin: number;
        abstainFallback: string;
    };
}): string {
    const C_MUTED = "#777";
    const C_LABEL = "#555";

    const cellStyle = "padding:6px 10px;border-bottom:1px solid #f0f0f0;";
    const headStyle =
        "padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;font-weight:600;color:#555;";
    const monoCell = `${cellStyle}font-family:monospace;font-size:11px;color:${C_MUTED};`;

    const rows: { point: CollisionPoint; row: string }[] = [];

    // Per-point rows
    const staticIsDefault = cfg.static.strategy === "warn";
    const staticRisky = cfg.static.strategy === "error";
    rows.push({
        point: "static",
        row: `
            <td style="${cellStyle}"><b>static</b><div style="color:${C_MUTED};font-size:11px;">${escapeHtml(pointDescription("static"))}</div></td>
            <td style="${cellStyle}">${statusPill(cfg.static.detect)}</td>
            <td style="${cellStyle}">${strategyPill(cfg.static.strategy, staticIsDefault, staticRisky)}</td>
            <td style="${monoCell}"><span style="color:${C_MUTED};">—</span></td>`,
    });

    const gmDefault = cfg.grammarMatch.strategy === "first-match";
    const gmRisky = cfg.grammarMatch.strategy === "user-clarify";
    rows.push({
        point: "grammarMatch",
        row: `
            <td style="${cellStyle}"><b>grammarMatch</b><div style="color:${C_MUTED};font-size:11px;">${escapeHtml(pointDescription("grammarMatch"))}</div></td>
            <td style="${cellStyle}">${statusPill(cfg.grammarMatch.detect)}</td>
            <td style="${cellStyle}">${strategyPill(cfg.grammarMatch.strategy, gmDefault, gmRisky)}</td>
            <td style="${monoCell}">classifier=${escapeHtml(cfg.grammarMatch.classifier)}</td>`,
    });

    const lsDefault = cfg.llmSelect.strategy === "first-match";
    const lsRisky = cfg.llmSelect.strategy === "user-clarify";
    rows.push({
        point: "llmSelect",
        row: `
            <td style="${cellStyle}"><b>llmSelect</b><div style="color:${C_MUTED};font-size:11px;">${escapeHtml(pointDescription("llmSelect"))}</div></td>
            <td style="${cellStyle}">${statusPill(cfg.llmSelect.detect)}</td>
            <td style="${cellStyle}">${strategyPill(cfg.llmSelect.strategy, lsDefault, lsRisky)}</td>
            <td style="${monoCell}">topN=${cfg.llmSelect.topN}, scoreDelta=${cfg.llmSelect.scoreDeltaThreshold}</td>`,
    });

    const fzDefault = cfg.fuzzy.strategy === "first-match";
    const fzRisky = cfg.fuzzy.strategy === "user-clarify";
    const scorerLabel =
        cfg.fuzzy.scorer === "placeholder"
            ? `<span style="color:#c80;" title="returns 0 for all pairs — fuzzy is inert until a real scorer ships">${escapeHtml(cfg.fuzzy.scorer)}</span>`
            : escapeHtml(cfg.fuzzy.scorer);
    rows.push({
        point: "fuzzy",
        row: `
            <td style="${cellStyle}"><b>fuzzy</b><div style="color:${C_MUTED};font-size:11px;">${escapeHtml(pointDescription("fuzzy"))}</div></td>
            <td style="${cellStyle}">${statusPill(cfg.fuzzy.detect)}</td>
            <td style="${cellStyle}">${strategyPill(cfg.fuzzy.strategy, fzDefault, fzRisky)}</td>
            <td style="${monoCell}">scorer=${scorerLabel}, static=${statusPill(cfg.fuzzy.staticEnabled)}, runtime=${statusPill(cfg.fuzzy.runtimeEnabled)}, threshold=${cfg.fuzzy.similarityThreshold}</td>`,
    });

    const tableRows = rows.map((r) => `<tr>${r.row}</tr>`).join("");

    const priorityVal = cfg.priorityOrder
        ? `<code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">"${escapeHtml(cfg.priorityOrder)}"</code>`
        : `<span style="color:#999;font-style:italic;">(empty — falls back to agent registration order)</span>`;

    const mabRisky = cfg.multipleActionBehavior !== "downgrade-to-priority";
    const mabVal = `<code style="background:${mabRisky ? "#fee" : "#f5f5f5"};color:${mabRisky ? "#c44" : "#555"};padding:1px 6px;border-radius:3px;">${escapeHtml(cfg.multipleActionBehavior)}</code>`;

    const settings = `
        <div style="margin-top:14px;font-size:12px;color:${C_LABEL};line-height:1.7;">
            <div><span style="color:${C_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-right:6px;">priorityOrder</span>${priorityVal}</div>
            <div><span style="color:${C_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-right:6px;">multipleActionBehavior</span>${mabVal}</div>
            <div style="margin-top:6px;">
                <span style="color:${C_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-right:6px;">telemetry</span>
                emit ${statusPill(cfg.telemetry.emit)}
                debugLog ${statusPill(cfg.telemetry.debugLog)}
                ${
                    cfg.telemetry.experimentId
                        ? `experimentId <code style="background:#e8f0ff;color:#36c;padding:1px 6px;border-radius:3px;">"${escapeHtml(cfg.telemetry.experimentId)}"</code>`
                        : ""
                }
            </div>
            <div style="margin-top:6px;">
                <span style="color:${C_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-right:6px;">preference</span>
                enabled ${statusPill(cfg.preference.enabled)}
                source <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${escapeHtml(cfg.preference.ambiguitySource)}</code>
                registryFirst ${statusPill(cfg.preference.registryFirst)}
                remember <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${escapeHtml(cfg.preference.remember)}</code>
                ${
                    cfg.preference.registryPath
                        ? `registry <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">"${escapeHtml(cfg.preference.registryPath)}"</code>`
                        : `<span style="color:#999;font-style:italic;">(no registry)</span>`
                }
            </div>
            <div style="margin-top:6px;">
                <span style="color:${C_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-right:6px;">contextSelector</span>
                detect ${statusPill(cfg.contextSelector.detect)}
                window <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${cfg.contextSelector.windowTurns}</code>
                decay <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${cfg.contextSelector.decay}</code>
                minTokens <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${cfg.contextSelector.minUniqueTokens}</code>
                minMass <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${cfg.contextSelector.minMass}</code>
                margin <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${cfg.contextSelector.margin}</code>
                abstain <code style="background:#f5f5f5;padding:1px 6px;border-radius:3px;">${escapeHtml(cfg.contextSelector.abstainFallback)}</code>
            </div>
        </div>`;

    const anyOn =
        cfg.static.detect ||
        cfg.grammarMatch.detect ||
        cfg.llmSelect.detect ||
        cfg.fuzzy.detect ||
        cfg.contextSelector.detect;
    const summary = anyOn
        ? `<div style="font-size:11px;color:${C_MUTED};margin-bottom:10px;">Detection is <b style="color:#070;">active</b> on at least one point. Telemetry is captured when emit=on; remote upload requires <code>@config log db on</code>.</div>`
        : `<div style="font-size:11px;color:${C_MUTED};margin-bottom:10px;">All detection points are <b>off</b> — runtime behavior is byte-identical to legacy first-match. Opt in with <code>@config collision &lt;point&gt; detect on</code>.</div>`;

    return (
        `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:880px;">` +
        `<h3 style="margin:0 0 4px;font-size:14px;">Collision detection config</h3>` +
        summary +
        `<table style="border-collapse:collapse;width:100%;font-size:12px;">` +
        `<thead><tr style="background:#fafafa;">` +
        `<th style="${headStyle}">Detection point</th>` +
        `<th style="${headStyle}">Detect</th>` +
        `<th style="${headStyle}">Strategy</th>` +
        `<th style="${headStyle}">Extras</th>` +
        `</tr></thead><tbody>${tableRows}</tbody></table>` +
        settings +
        `</div>`
    );
}

function renderCollisionShowText(cfg: {
    static: { detect: boolean; strategy: string };
    grammarMatch: {
        detect: boolean;
        strategy: string;
        classifier: string;
    };
    llmSelect: {
        detect: boolean;
        strategy: string;
        topN: number;
        scoreDeltaThreshold: number;
    };
    fuzzy: {
        detect: boolean;
        strategy: string;
        staticEnabled: boolean;
        runtimeEnabled: boolean;
        scorer: string;
        similarityThreshold: number;
    };
    priorityOrder: string;
    multipleActionBehavior: string;
    telemetry: {
        emit: boolean;
        debugLog: boolean;
        experimentId?: string | undefined;
    };
    preference: {
        enabled: boolean;
        ambiguitySource: string;
        registryPath: string;
        registryFirst: boolean;
        remember: string;
    };
    contextSelector: {
        detect: boolean;
        windowTurns: number;
        decay: number;
        minUniqueTokens: number;
        minMass: number;
        margin: number;
        abstainFallback: string;
    };
}): string[] {
    const onOff = (b: boolean) => (b ? "on" : "off");
    const expId = cfg.telemetry.experimentId
        ? ` experimentId="${cfg.telemetry.experimentId}"`
        : "";
    return [
        "collision config:",
        `  static:       detect=${onOff(cfg.static.detect)} strategy=${cfg.static.strategy}`,
        `  grammarMatch: detect=${onOff(cfg.grammarMatch.detect)} strategy=${cfg.grammarMatch.strategy} classifier=${cfg.grammarMatch.classifier}`,
        `  llmSelect:    detect=${onOff(cfg.llmSelect.detect)} strategy=${cfg.llmSelect.strategy} topN=${cfg.llmSelect.topN} scoreDelta=${cfg.llmSelect.scoreDeltaThreshold}`,
        `  fuzzy:        detect=${onOff(cfg.fuzzy.detect)} strategy=${cfg.fuzzy.strategy} static=${onOff(cfg.fuzzy.staticEnabled)} runtime=${onOff(cfg.fuzzy.runtimeEnabled)} scorer=${cfg.fuzzy.scorer} threshold=${cfg.fuzzy.similarityThreshold}`,
        `  priorityOrder: ${cfg.priorityOrder ? `"${cfg.priorityOrder}"` : "(empty)"}`,
        `  multipleActionBehavior: ${cfg.multipleActionBehavior}`,
        `  telemetry: emit=${onOff(cfg.telemetry.emit)} debugLog=${onOff(cfg.telemetry.debugLog)}${expId}`,
        `  preference: enabled=${onOff(cfg.preference.enabled)} source=${cfg.preference.ambiguitySource} registryFirst=${onOff(cfg.preference.registryFirst)} remember=${cfg.preference.remember} registry=${cfg.preference.registryPath ? `"${cfg.preference.registryPath}"` : "(empty)"}`,
        `  contextSelector: detect=${onOff(cfg.contextSelector.detect)} window=${cfg.contextSelector.windowTurns} decay=${cfg.contextSelector.decay} minTokens=${cfg.contextSelector.minUniqueTokens} minMass=${cfg.contextSelector.minMass} margin=${cfg.contextSelector.margin} abstain=${cfg.contextSelector.abstainFallback}`,
    ];
}

class CollisionShowCommandHandler implements CommandHandler {
    public readonly description = "Show the current collision detection config";
    public readonly parameters = {} as const;

    public async run(context: ActionContext<CommandHandlerContext>) {
        const cfg =
            context.sessionContext.agentContext.session.getConfig().collision;
        const html = renderCollisionShowHTML(cfg);
        const text = renderCollisionShowText(cfg);
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

class CollisionStrategyCommandHandler implements CommandHandler {
    public readonly description: string;
    public readonly parameters = {
        args: {
            strategy: {
                description: "strategy name",
                type: "string",
            },
        },
    } as const;

    constructor(
        private point: CollisionPoint,
        private allowed: readonly string[],
    ) {
        this.description = `Set ${point} resolution strategy (one of: ${allowed.join(", ")})`;
    }

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const strategy = params.args.strategy;
        if (!this.allowed.includes(strategy)) {
            displayWarn(
                `Unknown strategy "${strategy}" for ${this.point}. Allowed: ${this.allowed.join(", ")}.`,
                context,
            );
            return;
        }
        // Nested partial works because SessionOptions is DeepPartialUndefinedAndNull.
        const options: SessionOptions = {
            collision: { [this.point]: { strategy } },
        } as SessionOptions;
        await changeContextConfig(options, context);
        displayResult(`${this.point}.strategy = ${strategy}`, context);
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "strategy") {
                completions.push({
                    name,
                    completions: [...this.allowed],
                });
            }
        }
        return { groups: completions };
    }
}

class CollisionExperimentIdCommandHandler implements CommandHandler {
    public readonly description =
        "Set the experimentId tag attached to every emitted collision event. Empty string clears it.";
    public readonly parameters = {
        args: {
            id: {
                description:
                    'Experiment tag, e.g. "E1.2-2026-05-12". Empty string "" clears.',
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const cfg =
            context.sessionContext.agentContext.session.getConfig().collision;
        if (params.args.id === undefined) {
            const cur = cfg.telemetry.experimentId;
            displayResult(
                `experimentId: ${cur ? `"${cur}"` : "(empty)"}`,
                context,
            );
            return;
        }
        const id = params.args.id.trim();
        await changeContextConfig(
            {
                collision: {
                    telemetry: { experimentId: id },
                },
            } as SessionOptions,
            context,
        );
        displayResult(`experimentId = ${id ? `"${id}"` : "(empty)"}`, context);
    }
}

class CollisionPriorityCommandHandler implements CommandHandler {
    public readonly description =
        "Set priorityOrder (comma-separated agent names) used by the `priority` resolution strategy. Empty argument shows the current value.";
    public readonly parameters = {
        args: {
            order: {
                description:
                    'Comma-separated agent names, e.g. "list,player,calendar". Use the empty string "" to clear.',
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const cfg =
            context.sessionContext.agentContext.session.getConfig().collision;
        if (params.args.order === undefined) {
            displayResult(
                `priorityOrder: ${cfg.priorityOrder ? `"${cfg.priorityOrder}"` : "(empty)"}`,
                context,
            );
            return;
        }
        const order = params.args.order.trim();
        await changeContextConfig(
            { collision: { priorityOrder: order } } as SessionOptions,
            context,
        );
        displayResult(
            `priorityOrder = ${order ? `"${order}"` : "(empty)"}`,
            context,
        );
    }
}

const PREFERENCE_SOURCES = ["runtime", "registry", "both"] as const;
const PREFERENCE_REMEMBER = ["prompt", "always", "never"] as const;

class CollisionPreferenceSourceCommandHandler implements CommandHandler {
    public readonly description =
        "Set which ambiguity source feeds the `preference-clarify` strategy. Empty argument shows the current value.";
    public readonly parameters = {
        args: {
            source: {
                description: `One of: ${PREFERENCE_SOURCES.join(", ")}.`,
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const cfg =
            context.sessionContext.agentContext.session.getConfig().collision;
        if (params.args.source === undefined) {
            displayResult(
                `preference.ambiguitySource: "${cfg.preference.ambiguitySource}"`,
                context,
            );
            return;
        }
        const source = params.args.source.trim();
        if (!PREFERENCE_SOURCES.includes(source as any)) {
            displayWarn(
                `Unknown source "${source}". Allowed: ${PREFERENCE_SOURCES.join(", ")}.`,
                context,
            );
            return;
        }
        await changeContextConfig(
            {
                collision: { preference: { ambiguitySource: source } },
            } as SessionOptions,
            context,
        );
        displayResult(`preference.ambiguitySource = "${source}"`, context);
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "source") {
                completions.push({
                    name,
                    completions: [...PREFERENCE_SOURCES],
                });
            }
        }
        return { groups: completions };
    }
}

class CollisionPreferenceRememberCommandHandler implements CommandHandler {
    public readonly description =
        "Set how learned preferences are captured for the `preference-clarify` strategy. Empty argument shows the current value.";
    public readonly parameters = {
        args: {
            mode: {
                description: `One of: ${PREFERENCE_REMEMBER.join(", ")}.`,
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const cfg =
            context.sessionContext.agentContext.session.getConfig().collision;
        if (params.args.mode === undefined) {
            displayResult(
                `preference.remember: "${cfg.preference.remember}"`,
                context,
            );
            return;
        }
        const mode = params.args.mode.trim();
        if (!PREFERENCE_REMEMBER.includes(mode as any)) {
            displayWarn(
                `Unknown mode "${mode}". Allowed: ${PREFERENCE_REMEMBER.join(", ")}.`,
                context,
            );
            return;
        }
        await changeContextConfig(
            {
                collision: { preference: { remember: mode } },
            } as SessionOptions,
            context,
        );
        displayResult(`preference.remember = "${mode}"`, context);
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: CompletionGroup[] = [];
        for (const name of names) {
            if (name === "mode") {
                completions.push({
                    name,
                    completions: [...PREFERENCE_REMEMBER],
                });
            }
        }
        return { groups: completions };
    }
}

class CollisionPreferenceRegistryCommandHandler implements CommandHandler {
    public readonly description =
        "Set the filesystem path to the known-ambiguous neighborhoods registry (neighborhoods.json). Empty string clears it.";
    public readonly parameters = {
        args: {
            path: {
                description:
                    'Absolute path to neighborhoods.json. Use the empty string "" to clear.',
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const cfg =
            context.sessionContext.agentContext.session.getConfig().collision;
        if (params.args.path === undefined) {
            const cur = cfg.preference.registryPath;
            displayResult(
                `preference.registryPath: ${cur ? `"${cur}"` : "(empty)"}`,
                context,
            );
            return;
        }
        const registryPath = params.args.path.trim();
        await changeContextConfig(
            {
                collision: { preference: { registryPath } },
            } as SessionOptions,
            context,
        );
        displayResult(
            `preference.registryPath = ${registryPath ? `"${registryPath}"` : "(empty)"}`,
            context,
        );
    }
}

function getCollisionPointHandlers(point: CollisionPoint): CommandHandlerTable {
    const allowedStrategies = strategiesFor(point);
    return {
        description: `Configure ${point} collision detection`,
        commands: {
            detect: getToggleHandlerTable(
                `${point} collision detection`,
                async (context, enable) => {
                    await changeContextConfig(
                        {
                            collision: {
                                [point]: { detect: enable },
                            },
                        } as SessionOptions,
                        context,
                    );
                },
            ),
            strategy: new CollisionStrategyCommandHandler(
                point,
                allowedStrategies,
            ),
        },
    };
}

// The runtime-tunable numeric knobs of the contextSelector tier (§8/§10). Each
// maps to a `collision.contextSelector.<field>` in the session config; `spec`
// carries the per-field validation (integer/range) so a bad value is rejected
// rather than silently corrupting the decision math.
type ContextSelectorNumericField =
    | "windowTurns"
    | "decay"
    | "minUniqueTokens"
    | "minMass"
    | "margin";

type NumericFieldSpec = {
    description: string;
    integer?: boolean;
    min?: number;
    max?: number;
    // When true, `min` is exclusive (e.g. decay must be strictly > 0).
    minExclusive?: boolean;
};

const CONTEXT_SELECTOR_FIELDS: Record<
    ContextSelectorNumericField,
    NumericFieldSpec
> = {
    windowTurns: {
        description: "ring-buffer look-back N over recent user turns",
        integer: true,
        min: 1,
    },
    decay: {
        description: "per-turn recency decay lambda (0 < lambda <= 1)",
        min: 0,
        minExclusive: true,
        max: 1,
    },
    minUniqueTokens: {
        description:
            "evidence gate: min distinct distinguishing tokens the winner must match",
        integer: true,
        min: 0,
    },
    minMass: {
        description: "evidence gate: min winner matched mass",
        min: 0,
    },
    margin: {
        description:
            "clear-winner margin the winner must beat the runner-up by",
        min: 0,
    },
};

function validateNumericField(
    value: number,
    spec: NumericFieldSpec,
): string | undefined {
    if (!Number.isFinite(value)) {
        return "must be a finite number";
    }
    if (spec.integer && !Number.isInteger(value)) {
        return "must be an integer";
    }
    if (spec.min !== undefined) {
        const bad = spec.minExclusive ? value <= spec.min : value < spec.min;
        if (bad) {
            return `must be ${spec.minExclusive ? ">" : ">="} ${spec.min}`;
        }
    }
    if (spec.max !== undefined && value > spec.max) {
        return `must be <= ${spec.max}`;
    }
    return undefined;
}

// Get/set one contextSelector numeric threshold. Omitting the value shows the
// current setting; a valid value is persisted via changeContextConfig (session
// delta) and takes effect on the next collision — matchContextSelector /
// RingBufferSignalSource read the config fresh each turn.
class ContextSelectorThresholdCommandHandler implements CommandHandler {
    public readonly description: string;
    public readonly parameters = {
        args: {
            value: {
                description: "New value; omit to show the current value.",
                type: "number",
                optional: true,
            },
        },
    } as const;

    constructor(
        private readonly field: ContextSelectorNumericField,
        private readonly spec: NumericFieldSpec,
    ) {
        this.description = `Get/set contextSelector ${field} (${spec.description})`;
    }

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const cs =
            context.sessionContext.agentContext.session.getConfig().collision
                .contextSelector;
        if (params.args.value === undefined) {
            displayResult(`${this.field} = ${cs[this.field]}`, context);
            return;
        }
        const value = params.args.value;
        const err = validateNumericField(value, this.spec);
        if (err !== undefined) {
            displayWarn(`Invalid ${this.field} "${value}": ${err}.`, context);
            return;
        }
        await changeContextConfig(
            {
                collision: {
                    contextSelector: { [this.field]: value },
                },
            } as SessionOptions,
            context,
        );
        displayResult(`${this.field} = ${value}`, context);
    }
}

function getContextSelectorThresholdHandlers(): Record<string, CommandHandler> {
    const handlers: Record<string, CommandHandler> = {};
    for (const [field, spec] of Object.entries(CONTEXT_SELECTOR_FIELDS)) {
        handlers[field] = new ContextSelectorThresholdCommandHandler(
            field as ContextSelectorNumericField,
            spec,
        );
    }
    return handlers;
}

function getCollisionCommandHandlers(): CommandHandlerTable {
    const pointHandlers: Record<string, CommandHandlerTable> = {};
    for (const point of COLLISION_POINTS) {
        pointHandlers[point] = getCollisionPointHandlers(point);
    }
    return {
        description: "Configure action collision detection",
        defaultSubCommand: "show",
        commands: {
            show: new CollisionShowCommandHandler(),
            ...pointHandlers,
            priority: new CollisionPriorityCommandHandler(),
            preference: {
                description:
                    "Configure the preference-clarify strategy (Tier-1 preferences + Tier-2 registry)",
                commands: {
                    enabled: getToggleHandlerTable(
                        "preference-clarify resolution",
                        async (context, enable) => {
                            await changeContextConfig(
                                {
                                    collision: {
                                        preference: { enabled: enable },
                                    },
                                } as SessionOptions,
                                context,
                            );
                        },
                    ),
                    source: new CollisionPreferenceSourceCommandHandler(),
                    remember: new CollisionPreferenceRememberCommandHandler(),
                    registry: new CollisionPreferenceRegistryCommandHandler(),
                    registryFirst: getToggleHandlerTable(
                        "registry-first detection (scan all embedding candidates against the neighborhood registry, independent of the score-delta detector)",
                        async (context, enable) => {
                            await changeContextConfig(
                                {
                                    collision: {
                                        preference: { registryFirst: enable },
                                    },
                                } as SessionOptions,
                                context,
                            );
                        },
                    ),
                },
            },
            telemetry: {
                description: "Configure collision telemetry",
                commands: {
                    emit: getToggleHandlerTable(
                        "collision telemetry ring buffer",
                        async (context, enable) => {
                            await changeContextConfig(
                                {
                                    collision: {
                                        telemetry: { emit: enable },
                                    },
                                } as SessionOptions,
                                context,
                            );
                        },
                    ),
                    debugLog: getToggleHandlerTable(
                        "collision telemetry debug log",
                        async (context, enable) => {
                            await changeContextConfig(
                                {
                                    collision: {
                                        telemetry: { debugLog: enable },
                                    },
                                } as SessionOptions,
                                context,
                            );
                        },
                    ),
                    experimentId: new CollisionExperimentIdCommandHandler(),
                },
            },
            contextSelector: {
                description:
                    "Configure the context-weighted resolution tier (deterministic topical tiebreaker on the grammar path)",
                commands: {
                    detect: getToggleHandlerTable(
                        "context-weighted resolution (contextSelector)",
                        async (context, enable) => {
                            await changeContextConfig(
                                {
                                    collision: {
                                        contextSelector: { detect: enable },
                                    },
                                } as SessionOptions,
                                context,
                            );
                        },
                    ),
                    ...getContextSelectorThresholdHandlers(),
                },
            },
        },
    };
}

/**
 * `@config dev on [--confirm]` — turn on developer mode.
 *
 * Developer mode records conversation + translation data (see DevTrace) and
 * enables dev-only UI affordances (per-message delete). The optional
 * `--confirm` flag additionally turns on per-request action confirmation
 * (confirmTranslation -> clientIO.proposeAction), which is otherwise off so
 * that recording data does not force an interactive Run/Cancel/Edit prompt.
 */
class DevModeOnCommandHandler implements CommandHandler {
    public readonly description =
        "Turn on development mode (records conversation + translation data)";
    public readonly parameters = {
        flags: {
            confirm: {
                description:
                    "Also confirm each translated action via the client before running it",
                char: "c",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const confirm = params.flags.confirm === true;
        systemContext.developerMode = true;
        systemContext.confirmActions = confirm;
        // Notify connected clients so dev-mode UI affordances (e.g. the
        // per-message delete button) can toggle live.
        systemContext.clientIO.notify(
            undefined,
            "developerMode",
            { enabled: true },
            "dispatcher",
        );
        displaySuccess(
            confirm
                ? "development mode is enabled (action confirmation on)."
                : "development mode is enabled.",
            context,
        );
    }
}

export function getConfigCommandHandlers(): CommandHandlerTable {
    return {
        description: "Configuration commands",
        commands: {
            schema: new AgentToggleCommandHandler(AgentToggle.Schema),
            action: new AgentToggleCommandHandler(AgentToggle.Action),
            command: new AgentToggleCommandHandler(AgentToggle.Command),
            agent: {
                description: "Manage agents (enable/disable, setup, refresh)",
                defaultSubCommand: new AgentToggleCommandHandler(
                    AgentToggle.Agent,
                ),
                commands: {
                    setup: new AgentSetupCommandHandler(),
                    refresh: new AgentRefreshCommandHandler(),
                },
            },
            request: new ConfigRequestCommandHandler(),
            scrub: getToggleHandlerTable(
                "outbound secret scrubbing",
                async (_context, enable: boolean) => {
                    setEgressSecretRedactionEnabled(enable);
                },
            ),
            match: {
                description: "Configure match behavior",
                commands: {
                    grammar: getToggleHandlerTable(
                        "grammar cache usage",
                        async (context, enable: boolean) => {
                            await changeContextConfig(
                                { cache: { grammar: enable } },
                                context,
                            );
                        },
                    ),
                },
            },
            cache: {
                description: "Configure cache behavior",
                commands: {
                    grammarSystem: new GrammarSystemCommandHandler(),
                    useDFA: new GrammarUseDFACommandHandler(),
                },
            },
            translation: configTranslationCommandHandlers,
            explainer: configExplainerCommandHandlers,
            execution: configExecutionCommandHandlers,
            modelProvider: new ConfigModelProviderCommandHandler(),
            dev: {
                description: "Toggle development mode",
                defaultSubCommand: "on",
                commands: {
                    on: new DevModeOnCommandHandler(),
                    off: {
                        description: "Turn off development mode",
                        run: async (
                            context: ActionContext<CommandHandlerContext>,
                        ) => {
                            const systemContext =
                                context.sessionContext.agentContext;
                            systemContext.developerMode = false;
                            systemContext.confirmActions = false;
                            systemContext.clientIO.notify(
                                undefined,
                                "developerMode",
                                { enabled: false },
                                "dispatcher",
                            );
                            displaySuccess(
                                "development mode is disabled.",
                                context,
                            );
                        },
                    },
                },
            },
            log: {
                description: "Toggle logging",
                commands: {
                    db: getToggleHandlerTable(
                        "logging",
                        async (context, enable) => {
                            // Honor the toggle: previously hardcoded to
                            // false regardless of `enable`, which made
                            // `@config log db on` a no-op and blocked
                            // every collision-rollout experiment from
                            // uploading to Cosmos.
                            context.sessionContext.agentContext.dblogging =
                                enable;
                        },
                    ),
                },
            },

            collision: getCollisionCommandHandlers(),
        },
    };
}
