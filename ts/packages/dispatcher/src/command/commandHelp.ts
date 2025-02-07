// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import chalk from "chalk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    getFlagType,
    isCommandDescriptorTable,
} from "@typeagent/agent-sdk/helpers/command";
import { getDefaultSubCommandDescriptor } from "./command.js";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";

export function getUsage(command: string, descriptor: CommandDescriptor) {
    if (descriptor.help) {
        return descriptor.help;
    }

    const paramUsage: string[] = [];
    const paramUsageFull: string[] = [];
    if (descriptor.parameters !== undefined) {
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
                    const typeStr = `${type === "boolean" ? "" : ` <${type}>`}`;
                    const usage = `[${def.char ? `-${def.char}|` : ""}--${name}${typeStr}]`;
                    paramUsage.unshift(usage);
                    paramUsageFull.push(
                        `  ${`--${name}`.padStart(maxNameLength)} ${def.char !== undefined ? `-${def.char}` : "  "}${typeStr.padEnd(8)} : ${def.description}${def.default !== undefined ? ` (default: ${def.default})` : ""}`,
                    );
                }
            }
        }
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
    if (command) {
        const defaultSubCommand = getDefaultSubCommandDescriptor(table);
        if (defaultSubCommand !== undefined) {
            output.push(`${chalk.bold(chalk.underline("Command"))}`);
            output.push(getUsage(command, defaultSubCommand));
            output.push("");
        }
        output.push(
            `${chalk.bold(chalk.underline(`Subcommands: ${table.description}`))}`,
        );
        output.push("");
        output.push(`${chalk.bold("Usage")}: @${command} <subcommand> ...`);
        output.push();
        output.push(`${chalk.bold("<subcommand>:")}`);
    } else {
        output.push(`${chalk.bold(chalk.underline(table.description))}`);
        output.push("");
        output.push(`${chalk.bold("Usage")}: @[<agentName>] <subcommand> ...`);
        output.push("");
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
        output.push("");
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

export function printStructuredHandlerTableUsage(
    table: CommandDescriptorTable,
    command: string | undefined,
    context: ActionContext<CommandHandlerContext>,
) {
    let index: number = 0;
    const commands: string[][] = [];

    if (command) {
        const defaultSubCommand = getDefaultSubCommandDescriptor(table);
        if (defaultSubCommand !== undefined) {
            displayResult(`${chalk.bold(chalk.underline("Command"))}`, context);
            displayResult(getUsage(command, defaultSubCommand), context);
            displayResult("\n", context);
        }

        if (Object.keys(table.commands).length == 0) {
            return;
        }

        displayResult(
            `${chalk.bold(chalk.underline(`Subcommands: ${table.description}`))}`,
            context,
        );
        displayResult("\n", context);
        displayResult(
            `${chalk.bold("Usage")}: @${command} <subcommand> ...`,
            context,
        );
        displayResult("\n", context);
    } else {
        displayResult(
            `${chalk.bold(chalk.underline(table.description))}`,
            context,
        );
        displayResult("\n", context);
        displayResult(
            `${chalk.bold("Usage")}: @[<agentName>] <subcommand> ...`,
            context,
        );
        displayResult("\n", context);

        commands[index] = ["Agent Name (* default agent)", "Description"];
        index++;

        const systemContext = context.sessionContext.agentContext;
        for (const name of systemContext.agents.getAppAgentNames()) {
            if (systemContext.agents.isCommandEnabled(name)) {
                commands[index] = [];

                if (name == "system") {
                    commands[index].push(`${name} *`);
                } else {
                    commands[index].push(name);
                }

                commands[index].push(
                    systemContext.agents.getAppAgentDescription(name),
                );

                index++;
            }
        }

        displayResult(commands, context);
        displayResult("\n", context);
    }

    const subCommands: string[][] = [];
    index = 0;

    subCommands[index] = ["Sub commands", "Description"];
    index++;

    for (const name in table.commands) {
        const handler = table.commands[name];
        const subcommand = isCommandDescriptorTable(handler)
            ? `${name} <subcommand>`
            : name;

        subCommands[index] = [];
        subCommands[index].push(subcommand);
        subCommands[index].push(handler.description);
        index++;
    }

    displayResult(subCommands, context);
}
