// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Helpers for discovering the actions a dispatcher session currently exposes
// and for running one of them directly through the `@action` command, which
// validates and executes a typed action without natural language translation.
//
// Shared by the MCP servers that front the dispatcher (command-executor and
// the Copilot CLI plugin) so both build the same command and read the same
// discovery data the same way.

import type {
    ActionInfo,
    AgentSchemaInfo,
    AgentSubSchemaInfo,
    DispatcherStatus,
} from "../dispatcher.js";

/** A typed action to run without translation. */
export type DirectActionRequest = {
    /** Exact sub-schema name from discovery, e.g. "desktop.desktop-taskbar". */
    schemaName: string;
    actionName: string;
    parameters?: Record<string, unknown> | undefined;
    /**
     * The user's phrasing of this exact request, when there is one. The
     * dispatcher stores it as a translation for this action, so a later
     * request phrased the same way resolves without an LLM call. It does not
     * change what this call runs, but a phrase that does not match the action
     * mis-translates future requests - omit it rather than guess.
     */
    naturalLanguage?: string | undefined;
};

// Schema and action names are identifiers; sub-schema names add a dot (and
// occasionally a dash). Anything else could add tokens to the command line.
const namePattern = /^[A-Za-z0-9_.-]+$/;

/**
 * The dispatcher's command tokenizer reads a quoted token up to the next
 * matching quote and strips only the outer quotes - it does not unescape
 * anything inside. So a value is safe to quote with a quote character the
 * value itself does not contain, and cannot be quoted at all when it contains
 * both.
 */
function quoteCommandValue(value: string): string | undefined {
    if (!value.includes("'")) {
        return `'${value}'`;
    }
    if (!value.includes('"')) {
        return `"${value}"`;
    }
    return undefined;
}

function checkName(kind: string, name: string): void {
    if (!namePattern.test(name)) {
        throw new Error(`Invalid ${kind} '${name}'`);
    }
}

/**
 * Build the `@action <schemaName> <actionName>` command that dispatches a
 * typed action directly. Throws when a name could not appear in a real
 * schema, so a caller-supplied name can never inject extra command tokens.
 */
export function buildActionCommand(request: DirectActionRequest): string {
    checkName("schema name", request.schemaName);
    checkName("action name", request.actionName);

    const parts = ["@action", request.schemaName, request.actionName];
    const parameters = request.parameters;
    if (parameters !== undefined && Object.keys(parameters).length > 0) {
        // \u0027 is a legal JSON escape for an apostrophe, so replacing it
        // keeps the value parseable and leaves no quote that would end the
        // token early.
        const json = JSON.stringify(parameters).replaceAll("'", "\\u0027");
        parts.push("--parameters", `'${json}'`);
    }

    const naturalLanguage = request.naturalLanguage?.trim();
    if (naturalLanguage) {
        const quoted = quoteCommandValue(naturalLanguage);
        // A phrase containing both quote characters cannot survive the
        // tokenizer intact. Seeding the cache with a mangled phrase is worse
        // than not seeding it, so drop the flag instead.
        if (quoted !== undefined) {
            parts.push("--naturalLanguage", quoted);
        }
    }
    return parts.join(" ");
}

/**
 * Drop the sub-schemas whose actions this session cannot execute, plus any
 * agent left with nothing callable. `getAgentSchemas` reports every installed
 * schema; only `getStatus` says which ones are enabled, keyed by the same
 * sub-schema name. A sub-schema missing from the status is kept - unknown is
 * not disabled.
 *
 * Uses `actionActive`, which mirrors the check `@action` itself makes.
 * `active` is not usable here: it is also true when only the agent's commands
 * are enabled, which would list actions that then refuse to run. Older agent
 * servers do not report `actionActive`, so fall back to `active` there.
 */
export function filterActiveAgentSchemas(
    schemas: AgentSchemaInfo[],
    status: DispatcherStatus,
): AgentSchemaInfo[] {
    const activeBySchemaName = new Map<string, boolean>();
    for (const agent of status.agents) {
        activeBySchemaName.set(
            agent.name.toLowerCase(),
            agent.actionActive ?? agent.active,
        );
    }

    const result: AgentSchemaInfo[] = [];
    for (const agent of schemas) {
        const subSchemas = agent.subSchemas.filter(
            (subSchema) =>
                activeBySchemaName.get(subSchema.schemaName.toLowerCase()) !==
                false,
        );
        if (subSchemas.length === 0) {
            continue;
        }
        result.push({ ...agent, subSchemas });
    }
    return result;
}

export type ActionLookup = {
    subSchema: AgentSubSchemaInfo;
    action: ActionInfo;
};

/** Find the sub-schema that declares `actionName`, ignoring case. */
export function findActionSubSchema(
    agent: AgentSchemaInfo,
    actionName: string,
): ActionLookup | undefined {
    const needle = actionName.toLowerCase();
    for (const subSchema of agent.subSchemas) {
        const action = subSchema.actions.find(
            (candidate) => candidate.name.toLowerCase() === needle,
        );
        if (action !== undefined) {
            return { subSchema, action };
        }
    }
    return undefined;
}

/** Every action name the agent exposes, for "did you mean" style messages. */
export function getAgentActionNames(agent: AgentSchemaInfo): string[] {
    return agent.subSchemas.flatMap((subSchema) =>
        subSchema.actions.map((action) => action.name),
    );
}
