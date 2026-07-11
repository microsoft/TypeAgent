// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic markdown generator for docs/overview/command-reference.md.
//
// Walks every enabled agent's command descriptor tables (the same tables
// `@help --all` renders via printAllCommandsWithUsage) and emits markdown
// that mirrors getUsage() in commandHelp.ts — Usage / Arguments / Flags.
//
// The command descriptors are the single source of truth: run the generator
// (via `docs-autogen --command-reference`) after changing a command's
// description or parameters to regenerate the reference. Extended prose for a
// command belongs in the README next to the code that implements it, not here.

import {
    CommandDescriptor,
    CommandDescriptorTable,
    CommandDescriptors,
} from "@typeagent/agent-sdk";
import {
    getFlagType,
    isCommandDescriptorTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { getDefaultSubCommandDescriptor } from "./command.js";

import registerDebug from "debug";
const debug = registerDebug("typeagent:command:reference");
const debugError = registerDebug("typeagent:command:reference:error");

// Escape the angle brackets used to denote parameter names so they survive
// markdown/HTML rendering. Used only in the Arguments/Flags bullet lists;
// the Usage line is a code span (backticks) and needs no escaping.
function escapeAngles(text: string): string {
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render a single command descriptor to a markdown section. Mirrors the
// mechanical parts of getUsage() (commandHelp.ts) so the reference stays in
// lockstep with interactive `@help`.
function renderCommand(command: string, descriptor: CommandDescriptor): string {
    // Usage tokens (flags first, unshifted in reverse like getUsage; then args).
    const usageParams: string[] = [];
    const argLines: string[] = [];
    const flagLines: string[] = [];

    const parameters = descriptor.parameters;
    if (parameters !== undefined) {
        if (parameters.args) {
            for (const [name, def] of Object.entries(parameters.args)) {
                const usage = `<${name}>${def.multiple === true ? "..." : ""}`;
                usageParams.push(def.optional ? `[${usage}]` : usage);
                argLines.push(
                    `- ${escapeAngles(`<${name}>`)} - ${
                        def.optional ? "(optional) " : ""
                    }${def.description} (type: ${def.type ?? "string"})`,
                );
            }
        }
        if (parameters.flags) {
            for (const [name, def] of Object.entries(parameters.flags)) {
                const type = getFlagType(def);
                const typeStr = type === "boolean" ? "" : ` <${type}>`;
                usageParams.unshift(
                    `[${def.char ? `-${def.char}|` : ""}--${name}${typeStr}]`,
                );
                const charStr = def.char !== undefined ? ` -${def.char}` : "";
                const escapedType =
                    type === "boolean" ? "" : ` ${escapeAngles(`<${type}>`)}`;
                const defaultStr =
                    def.default !== undefined
                        ? ` (default: ${def.default})`
                        : "";
                flagLines.push(
                    `- --${name}${charStr}${escapedType} : ${def.description}${defaultStr}`,
                );
            }
        }
    }

    const usage = `@${command}${
        usageParams.length !== 0 ? ` ${usageParams.join(" ")}` : ""
    }`;

    const out: string[] = [];
    out.push(`## @${command} - ${descriptor.description}`);
    out.push("");
    out.push(`Usage: \`${usage}\``);
    if (argLines.length !== 0) {
        out.push("");
        out.push("### Arguments:");
        out.push("");
        out.push(...argLines);
    }
    if (flagLines.length !== 0) {
        out.push("");
        out.push("### Flags:");
        out.push("");
        out.push(...flagLines);
    }
    return out.join("\n");
}

// Depth-first walk of a command table, emitting one markdown section per leaf
// command. A table's default subcommand is rendered at the parent path only
// when it is an inline descriptor (e.g. `@clear`); string-referenced defaults
// are skipped here because the referenced subcommand is rendered by the loop.
function walkTable(
    table: CommandDescriptorTable,
    commandPrefix: string,
    sections: string[],
): void {
    if (typeof table.defaultSubCommand !== "string" && commandPrefix !== "") {
        const defaultDescriptor = getDefaultSubCommandDescriptor(table);
        if (defaultDescriptor !== undefined) {
            sections.push(renderCommand(commandPrefix, defaultDescriptor));
        }
    }

    for (const [name, handler] of Object.entries(table.commands)) {
        const command = commandPrefix ? `${commandPrefix} ${name}` : name;
        if (isCommandDescriptorTable(handler)) {
            walkTable(handler, command, sections);
        } else {
            sections.push(renderCommand(command, handler));
        }
    }
}

// Order agents so the reference is stable and readable: `system` (the default,
// prefix-less agent) first, then `dispatcher`, then every other agent
// alphabetically.
function orderAgentNames(names: string[]): string[] {
    const rank = (name: string): number =>
        name === "system" ? 0 : name === "dispatcher" ? 1 : 2;
    return [...names].sort((a, b) => {
        const r = rank(a) - rank(b);
        return r !== 0 ? r : a.localeCompare(b);
    });
}

// Emit the markdown body (one `##` section per command) for every enabled
// agent's commands. The caller supplies the file's intro/header. Agents that
// are not command-enabled (e.g. failed to initialize headlessly) are skipped
// with a debug note, so the output reflects whatever agents booted.
export async function collectCommandReferenceMarkdown(
    context: CommandHandlerContext,
): Promise<string> {
    const sections: string[] = [];
    const agents = context.agents;

    for (const agentName of orderAgentNames(agents.getAppAgentNames())) {
        let commands: CommandDescriptors;
        try {
            if (!agents.isCommandEnabled(agentName)) {
                debug(`Skipping '${agentName}': commands not enabled`);
                continue;
            }
            const appAgent = agents.getAppAgent(agentName);
            if (appAgent.getCommands === undefined) {
                continue;
            }
            const sessionContext = agents.getSessionContext(agentName);
            commands = await appAgent.getCommands(sessionContext);
        } catch (e) {
            debugError(`Failed to get commands for '${agentName}': ${e}`);
            continue;
        }

        // `system` is the default agent — its commands are invoked without an
        // agent prefix (`@action`). Every other agent prefixes its commands
        // with the agent name (`@dispatcher request`).
        const commandPrefix = agentName === "system" ? "" : agentName;
        if (isCommandDescriptorTable(commands)) {
            walkTable(commands, commandPrefix, sections);
        } else if (commandPrefix !== "") {
            // Agent exposes a single `@<agentName>` command.
            sections.push(renderCommand(commandPrefix, commands));
        }
    }

    return sections.join("\n\n");
}
