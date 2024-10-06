// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import chalk from "chalk";
import { CommandHandlerContext } from "../internal.js";
import {
    getFlagType,
    isCommandDescriptorTable,
} from "@typeagent/agent-sdk/helpers/command";

export function getUsage(command: string, descriptor: CommandDescriptor) {
    if (descriptor.help) {
        return descriptor.help;
    }

    const paramUsage: string[] = [];
    const paramUsageFull: string[] = [];
    if (typeof descriptor.parameters === "object") {
        if (descriptor.parameters.args) {
            const args = Object.entries(descriptor.parameters.args);
            if (args.length !== 0) {
                paramUsageFull.push(chalk.bold(`Arguments:`));
                const maxNameLength = Math.max(
                    ...args.map(([name]) => name.length),
                );
                for (const [name, def] of args) {
                    const usage = `<${name}>${def.multiple === true ? "..." : ""}`;
                    paramUsage.push(def.optional ? `[${usage}]` : usage);
                    paramUsageFull.push(
                        `  ${`<${name}>`.padStart(maxNameLength)} - ${def.optional ? "(optional) " : ""}${def.description} (type: ${def.type ?? "string"})`,
                    );
                }
            }
        }
        if (descriptor.parameters.flags) {
            const flags = Object.entries(descriptor.parameters.flags);
            if (flags.length !== 0) {
                paramUsageFull.push(chalk.bold(`Flags:`));
                const maxNameLength = Math.max(
                    ...flags.map(([name]) => name.length),
                );
                for (const [name, def] of flags) {
                    const type = getFlagType(def);
                    const usage = `[${def.char ? `-${def.char}|` : ""}--${name}${type === "boolean" ? "" : ` <${type}>`}]`;
                    paramUsage.unshift(usage);
                    paramUsageFull.push(
                        `  ${`--${name}`.padStart(maxNameLength)} ${def.char !== undefined ? `-${def.char}` : "  "} : ${def.description}${def.default !== undefined ? ` (default: ${def.default})` : ""}`,
                    );
                }
            }
        }
    } else if (descriptor.parameters === true) {
        paramUsage.push("<parameters> ...");
    }
    const output: string[] = [];

    output.push(`@${chalk.bold(command)} - ${descriptor.description}`);
    output.push();
    output.push(`${chalk.bold("Usage")}: @${command} ${paramUsage.join(" ")}`);
    if (paramUsageFull.length !== 0) {
        output.push();
        output.push(...paramUsageFull);
    }
    return output.join("\n");
}

export function getHandlerTableUsage(
    table: CommandDescriptorTable,
    command: string | undefined,
    systemContext: CommandHandlerContext,
) {
    const output: string[] = [];
    output.push(`${chalk.bold(chalk.underline(table.description))}`);
    output.push();
    if (command) {
        output.push(`${chalk.bold("Usage")}: @${command} <subcommand> ...`);
        output.push();
        output.push(`${chalk.bold("<subcommand>:")}`);
    } else {
        output.push(`${chalk.bold("Usage")}: @[<agentName>] <subcommand> ...`);
        output.push();
        output.push(`${chalk.bold("<agentNames>:")} (default to 'system')`);
        const names = systemContext.agents.getAppAgentNames();
        const maxNameLength = Math.max(...names.map((name) => name.length));
        for (const name of systemContext.agents.getAppAgentNames()) {
            if (systemContext.agents.isCommandEnabled(name)) {
                output.push(
                    `  ${name.padEnd(maxNameLength)} : ${systemContext.agents.getAppAgentDescription(name)}`,
                );
            }
        }
        output.push();
        output.push(`${chalk.bold("<subcommand>")} ('system')`);
    }

    for (const name in table.commands) {
        const handler = table.commands[name];
        const subcommand = isCommandDescriptorTable(handler)
            ? `${name} <subcommand>`
            : name;
        output.push(`  ${subcommand.padEnd(20)}: ${handler.description}`);
    }
    return output.join("\n");
}
