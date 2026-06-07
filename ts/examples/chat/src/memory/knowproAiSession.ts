// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import fs from "fs";
import path from "path";

import { KnowproContext } from "./knowproMemory.js";
import { ensureDir, getFileName } from "typeagent";

type SessionSource = "claude" | "copilot";

export type KnowproAiSessionContext = {
    printer: KnowProPrinter;
    sessionMemory?: cm.ConversationMemory | undefined;
    basePath: string;
};

const SOURCE_LABEL: Record<SessionSource, string> = {
    claude: "Claude Code",
    copilot: "GitHub Copilot",
};

/**
 * Registers commands that import AI coding-assistant chat sessions
 * (Claude Code and GitHub Copilot transcripts) into conversation memory.
 *
 * Commands:
 *  - kpClaudeImport     : import a single Claude Code session *.jsonl transcript
 *  - kpCopilotImport    : import a single GitHub Copilot session *.jsonl transcript
 *  - kpClaudeImportDir  : import all Claude Code transcripts in a directory
 *  - kpCopilotImportDir : import all GitHub Copilot transcripts in a directory
 */
export async function createKnowproAiSessionCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowproAiSessionContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "sessions"),
    };
    await ensureDir(context.basePath);

    commands.kpClaudeImport = claudeImport;
    commands.kpCopilotImport = copilotImport;
    commands.kpClaudeImportDir = claudeImportDir;
    commands.kpCopilotImportDir = copilotImportDir;

    function commonImportOptions() {
        return {
            name: arg("Name for the memory (defaults to the file/dir name)"),
            buildIndex: argBool("Extract knowledge and build the index", true),
            save: argBool("Save the indexed memory to a file", true),
            indexFilePath: arg("Output directory for the saved index"),
            includeReasoning: argBool(
                "Include assistant reasoning/thinking in message text",
                false,
            ),
            includeToolCalls: argBool(
                "Include tool call names + arguments in message text",
                false,
            ),
        };
    }

    function sessionImportFileDef(source: SessionSource): CommandMetadata {
        return {
            description: `Import a ${SOURCE_LABEL[source]} session transcript (*.jsonl) as conversation memory`,
            args: {
                filePath: arg("File path to the session .jsonl transcript"),
            },
            options: commonImportOptions(),
        };
    }

    function sessionImportDirDef(source: SessionSource): CommandMetadata {
        return {
            description: `Import all ${SOURCE_LABEL[source]} session transcripts (*.jsonl) in a directory as a single merged conversation memory`,
            args: {
                dirPath: arg(
                    "Directory containing *.jsonl session transcripts",
                ),
            },
            options: commonImportOptions(),
        };
    }

    function importOptionsFromArgs(
        namedArgs: NamedArgs,
    ): cm.SessionImportOptions {
        return {
            name: namedArgs.name,
            buildIndex: namedArgs.buildIndex,
            includeReasoning: namedArgs.includeReasoning,
            includeToolCalls: namedArgs.includeToolCalls,
        };
    }

    commands.kpClaudeImport.metadata = sessionImportFileDef("claude");
    async function claudeImport(args: string[] | NamedArgs): Promise<void> {
        await importFile("claude", args);
    }

    commands.kpCopilotImport.metadata = sessionImportFileDef("copilot");
    async function copilotImport(args: string[] | NamedArgs): Promise<void> {
        await importFile("copilot", args);
    }

    commands.kpClaudeImportDir.metadata = sessionImportDirDef("claude");
    async function claudeImportDir(args: string[] | NamedArgs): Promise<void> {
        await importDir("claude", args);
    }

    commands.kpCopilotImportDir.metadata = sessionImportDirDef("copilot");
    async function copilotImportDir(args: string[] | NamedArgs): Promise<void> {
        await importDir("copilot", args);
    }

    async function importFile(
        source: SessionSource,
        args: string[] | NamedArgs,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(
            args,
            sessionImportFileDef(source),
        );
        const filePath: string = namedArgs.filePath;
        if (!fs.existsSync(filePath)) {
            context.printer.writeError(`${filePath} not found`);
            return;
        }
        const name: string = namedArgs.name ?? getFileName(filePath);
        const options = importOptionsFromArgs(namedArgs);

        const clock = new StopWatch();
        clock.start();
        const memory =
            source === "claude"
                ? await cm.importClaudeSession(filePath, options)
                : await cm.importCopilotSession(filePath, options);
        clock.stop();

        await finishImport(source, name, memory, options, clock, namedArgs);
    }

    async function importDir(
        source: SessionSource,
        args: string[] | NamedArgs,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(
            args,
            sessionImportDirDef(source),
        );
        const dirPath: string = namedArgs.dirPath;
        if (!fs.existsSync(dirPath)) {
            context.printer.writeError(`${dirPath} not found`);
            return;
        }
        const fileCount = fs
            .readdirSync(dirPath)
            .filter((f) => f.toLowerCase().endsWith(".jsonl")).length;
        if (fileCount === 0) {
            context.printer.writeError(`No *.jsonl transcripts in ${dirPath}`);
            return;
        }
        const name: string = namedArgs.name ?? path.basename(dirPath);
        const options = importOptionsFromArgs(namedArgs);

        context.printer.writeLine(
            `Importing ${fileCount} ${SOURCE_LABEL[source]} transcript(s) from ${dirPath}`,
        );
        const clock = new StopWatch();
        clock.start();
        const memory =
            source === "claude"
                ? await cm.importClaudeSessionsFromDir(dirPath, options)
                : await cm.importCopilotSessionsFromDir(dirPath, options);
        clock.stop();

        await finishImport(source, name, memory, options, clock, namedArgs);
    }

    async function finishImport(
        source: SessionSource,
        name: string,
        memory: cm.ConversationMemory,
        options: cm.SessionImportOptions,
        clock: StopWatch,
        namedArgs: NamedArgs,
    ): Promise<void> {
        const buildIndex = options.buildIndex ?? true;
        context.sessionMemory = memory;
        kpContext.conversation = memory;
        context.printer.writeTiming(
            clock,
            buildIndex ? "Import and index" : "Import",
        );
        context.printer.writeLine(
            `Imported ${memory.messages.length} message(s) from ${SOURCE_LABEL[source]} session "${name}"`,
        );
        // Session titles are recorded as conversation tags (Claude Code only).
        const titles = memory.tags.filter(
            (t) => t !== name && t !== "claude-code" && t !== "github-copilot",
        );
        if (titles.length > 0) {
            context.printer.writeLine(`Title(s): ${titles.join("; ")}`);
        }
        context.printer.writeConversationInfo(memory);

        if (!buildIndex || !namedArgs.save) {
            return;
        }
        const dirPath: string = namedArgs.indexFilePath ?? context.basePath;
        await ensureDir(dirPath);
        const saveClock = new StopWatch();
        saveClock.start();
        await memory.writeToFile(dirPath, name);
        saveClock.stop();
        context.printer.writeTiming(saveClock, "Save");
        context.printer.writeLine(path.join(dirPath, name));
    }

    return;
}
