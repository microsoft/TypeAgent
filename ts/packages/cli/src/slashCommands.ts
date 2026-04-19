// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import chalk from "chalk";
import type { ConversationCommandContext } from "./conversationCommands.js";
import { handleConversationCommand } from "./conversationCommands.js";

export type SlashCommandHandler = (
    args: string,
    processCommand: (command: string) => Promise<any>,
) => Promise<any>;

interface SlashCommand {
    name: string;
    description: string;
    handler: SlashCommandHandler;
}

// Verbose mode state
let verboseEnabled = false;
let activeNamespaces = "";

export function isVerboseEnabled(): boolean {
    return verboseEnabled;
}

export function enableVerboseFromFlag(namespaces: string): void {
    verboseEnabled = true;
    activeNamespaces = namespaces;
}

// Late-binding context for conversation commands.
// Set from connect.ts after the AgentServerConnection is established.
let conversationContext: ConversationCommandContext | undefined;

export function setConversationCommandContext(
    ctx: ConversationCommandContext,
): void {
    conversationContext = ctx;
}

export function getConversationCommandContext():
    | ConversationCommandContext
    | undefined {
    return conversationContext;
}

export function getVerboseIndicator(): string {
    if (!verboseEnabled) return "";
    if (activeNamespaces === "typeagent:*")
        return chalk.yellow("[verbose]") + " ";
    const parts = activeNamespaces.split(",");
    if (parts.length === 1) {
        const short = parts[0].replace(/^typeagent:/, "").replace(/:\*$/, "");
        return chalk.yellow(`[verbose:${short}]`) + " ";
    }
    return chalk.yellow(`[verbose:${parts.length} scopes]`) + " ";
}

function handleVerbose(args: string): void {
    if (args === "off" || (args === "" && verboseEnabled)) {
        registerDebug.disable();
        verboseEnabled = false;
        activeNamespaces = "";
        console.log(chalk.dim("Verbose mode disabled."));
    } else {
        const namespaces = args || "typeagent:*";
        registerDebug.enable(namespaces);
        process.env.DEBUG = namespaces;
        verboseEnabled = true;
        activeNamespaces = namespaces;
        console.log(chalk.dim(`Verbose mode enabled: ${namespaces}`));
    }
}

const slashCommands: SlashCommand[] = [
    {
        name: "help",
        description: "Show available commands",
        handler: async (_args, processCommand) => {
            // Print slash commands first, then delegate to @system help
            console.log(chalk.bold("\nSlash Commands:"));
            for (const cmd of slashCommands) {
                console.log(
                    `  ${chalk.cyanBright("/" + cmd.name.padEnd(16))} ${chalk.dim(cmd.description)}`,
                );
            }
            console.log("");
            return processCommand("@system help");
        },
    },
    {
        name: "clear",
        description: "Clear the terminal screen",
        handler: async () => {
            process.stdout.write("\x1b[2J\x1b[H");
        },
    },
    {
        name: "verbose",
        description: "Toggle verbose debug output",
        handler: async (args) => {
            handleVerbose(args);
        },
    },
    {
        name: "trace",
        description: "Manage debug trace namespaces",
        handler: async (args, processCommand) => {
            return processCommand(`@system trace ${args}`);
        },
    },
    {
        name: "history",
        description: "Show conversation history",
        handler: async (args, processCommand) => {
            return processCommand(`@system history ${args}`);
        },
    },
    {
        name: "session",
        description: "Session management",
        handler: async (args, processCommand) => {
            return processCommand(`@system session ${args}`);
        },
    },
    {
        name: "config",
        description: "View or edit configuration",
        handler: async (args, processCommand) => {
            return processCommand(`@system config ${args}`);
        },
    },
    {
        name: "agents",
        description: "List available agents",
        handler: async (_args, processCommand) => {
            return processCommand("@system config agents");
        },
    },
    {
        name: "conversation",
        description: "Manage conversations (new, switch, list, rename, delete)",
        handler: async (args) => {
            if (conversationContext === undefined) {
                console.log(
                    chalk.red(
                        "Conversation commands are not available (no server connection).",
                    ),
                );
                return;
            }
            return handleConversationCommand(conversationContext, args);
        },
    },
    {
        name: "exit",
        description: "Exit the CLI",
        handler: async () => {
            // Return a sentinel value that the main loop recognizes
            return { exit: true };
        },
    },
];

const commandMap = new Map<string, SlashCommand>();
for (const cmd of slashCommands) {
    commandMap.set(cmd.name, cmd);
}

export function isSlashCommand(input: string): boolean {
    return (
        input.startsWith("/") ||
        input.startsWith("@conversation ") ||
        input === "@conversation"
    );
}

const conversationSubcommands = ["new", "switch", "list", "rename", "delete"];

export function getSlashCompletions(input: string): string[] {
    // Handle @conversation <partial-subcommand> completions
    if (input.startsWith("@conversation")) {
        const after = input.slice("@conversation".length);
        // "@conversation" with no space yet — offer all subcommands
        if (after === "") {
            return conversationSubcommands.map((s) => `@conversation ${s}`);
        }
        if (after.startsWith(" ")) {
            const partial = after.slice(1).toLowerCase();
            return conversationSubcommands
                .filter((s) => s.startsWith(partial))
                .map((s) => `@conversation ${s}`);
        }
        return [];
    }
    const prefix = input.substring(1).toLowerCase();
    return slashCommands
        .filter((cmd) => cmd.name.startsWith(prefix))
        .map((cmd) => "/" + cmd.name);
}

export interface SlashCommandResult {
    handled: boolean;
    exit?: boolean;
    result?: any;
}

export async function handleSlashCommand(
    input: string,
    processCommand: (command: string) => Promise<any>,
): Promise<SlashCommandResult> {
    // Rewrite @conversation to /conversation so it routes through the
    // slash command system (avoids the spinner path in processCommandsEnhanced)
    let normalized = input;
    if (input.startsWith("@conversation")) {
        normalized = "/conversation" + input.substring("@conversation".length);
    }

    const trimmed = normalized.substring(1).trim();
    const spaceIdx = trimmed.indexOf(" ");
    const name =
        spaceIdx === -1
            ? trimmed.toLowerCase()
            : trimmed.substring(0, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? "" : trimmed.substring(spaceIdx + 1).trim();

    const cmd = commandMap.get(name);
    if (!cmd) {
        console.log(chalk.yellow(`Unknown command: ${input}`));
        console.log(chalk.dim("Type /help to see available commands."));
        return { handled: true };
    }

    const result = await cmd.handler(args, processCommand);
    if (result?.exit) {
        return { handled: true, exit: true };
    }
    return { handled: true, result };
}
