// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    StopWatch,
    ProgressBar,
} from "interactive-app";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import chalk from "chalk";
import fs from "fs";
import path from "path";

import { KnowproContext } from "./knowproMemory.js";
import { parseFreeAndNamedArguments } from "../common.js";
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
 *  - kpSessionLoad      : load a previously saved session index by name
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
    commands.kpSessionLoad = sessionLoad;

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
            append: argBool(
                "Merge into the currently loaded session memory instead of replacing it",
                false,
            ),
            maxMessages: argNum(
                "Stop after importing this many messages (default: all)",
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
            options: {
                ...commonImportOptions(),
                recurse: argBool(
                    "Recurse into subdirectories (e.g. all Claude projects)",
                    false,
                ),
                maxFiles: argNum(
                    "Stop after importing this many transcript files (default: all)",
                ),
            },
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
            recurse: namedArgs.recurse,
            maxMessages: namedArgs.maxMessages,
            maxFiles: namedArgs.maxFiles,
        };
    }

    // Splits a command line into free (positional) args + named options.
    // The required `args` entry (filePath/dirPath/name) is supplied positionally,
    // so only the option defs are bound here. Programmatic NamedArgs pass through.
    function splitImportArgs(
        args: string[] | NamedArgs,
        def: CommandMetadata,
    ): [string[], NamedArgs] {
        if (typeof args === "object" && !Array.isArray(args)) {
            return [[], args];
        }
        const optionsOnly: CommandMetadata = {
            description: def.description ?? "",
            ...(def.options ? { options: def.options } : {}),
        };
        return parseFreeAndNamedArguments(args, optionsOnly);
    }

    // Expand environment variables in a path string.
    // Supports both %VAR% (Windows) and $VAR (Unix) syntax.
    function expandEnvVars(pathStr: string): string {
        return pathStr.replace(/\$\{?(\w+)\}?|%(\w+)%/g, (match, unixVar, winVar) => {
            const varName = unixVar || winVar;
            return process.env[varName] ?? match;
        });
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

    function sessionLoadDef(): CommandMetadata {
        return {
            description:
                "Load a previously saved AI session index (by name) into conversation memory",
            args: {
                name: arg("Name of the saved session index"),
            },
            options: {
                indexFilePath: arg(
                    "Directory containing the saved index (defaults to the sessions folder)",
                ),
            },
        };
    }
    commands.kpSessionLoad.metadata = sessionLoadDef();
    async function sessionLoad(args: string[] | NamedArgs): Promise<void> {
        const [freeArgs, namedArgs] = splitImportArgs(args, sessionLoadDef());
        const name: string = freeArgs[0] ?? namedArgs.name;
        if (!name) {
            context.printer.writeError("No session name provided");
            return;
        }
        let dirPath: string = namedArgs.indexFilePath ?? context.basePath;
        dirPath = expandEnvVars(dirPath);
        const clock = new StopWatch();
        clock.start();
        const memory = await cm.ConversationMemory.readFromFile(dirPath, name);
        clock.stop();
        if (!memory) {
            context.printer.writeError(
                `Could not load session index "${name}" from ${dirPath}`,
            );
            return;
        }
        context.sessionMemory = memory;
        kpContext.conversation = memory;
        context.printer.writeTiming(clock, "Load");
        context.printer.writeLine(`Loaded session "${name}"`);
        context.printer.writeConversationInfo(memory);
    }

    async function importFile(
        source: SessionSource,
        args: string[] | NamedArgs,
    ): Promise<void> {
        const [freeArgs, namedArgs] = splitImportArgs(
            args,
            sessionImportFileDef(source),
        );
        let filePath: string = freeArgs[0] ?? namedArgs.filePath;
        if (!filePath) {
            context.printer.writeError("No transcript file path provided");
            return;
        }
        filePath = expandEnvVars(filePath);
        if (!fs.existsSync(filePath)) {
            context.printer.writeError(`${filePath} not found`);
            return;
        }
        const name: string = namedArgs.name ?? getFileName(filePath);

        // Track indexing progress
        let indexProgress: ProgressBar | undefined;
        const indexProgressCallback = (current: number, total: number) => {
            if (!indexProgress) {
                context.printer.writeLine(
                    `Extracting knowledge and building index (${total} message(s))...`,
                );
                indexProgress = new ProgressBar(context.printer, total);
            }
            indexProgress.advance();
        };

        // Track messages whose knowledge extraction failed; the import keeps
        // going and adds them without extracted knowledge.
        let skipped = 0;
        const indexErrorCallback = (
            current: number,
            total: number,
            error: string,
        ) => {
            skipped++;
            context.printer.writeLineInColor(
                chalk.yellow,
                `  Skipped knowledge extraction for message ${current}/${total}: ${error}`,
            );
        };

        await applyImport(source, name, namedArgs, (options) =>
            source === "claude"
                ? cm.importClaudeSession(filePath, {
                      ...options,
                      onIndexProgress: indexProgressCallback,
                      onIndexError: indexErrorCallback,
                  })
                : cm.importCopilotSession(filePath, {
                      ...options,
                      onIndexProgress: indexProgressCallback,
                      onIndexError: indexErrorCallback,
                  }),
        );

        if (indexProgress) {
            indexProgress.complete();
        }
        if (skipped > 0) {
            context.printer.writeLineInColor(
                chalk.yellow,
                `${skipped} message(s) imported without extracted knowledge.`,
            );
        }
    }

    async function importDir(
        source: SessionSource,
        args: string[] | NamedArgs,
    ): Promise<void> {
        const [freeArgs, namedArgs] = splitImportArgs(
            args,
            sessionImportDirDef(source),
        );
        let dirPath: string = freeArgs[0] ?? namedArgs.dirPath;
        if (!dirPath) {
            context.printer.writeError("No directory path provided");
            return;
        }
        dirPath = expandEnvVars(dirPath);
        if (!fs.existsSync(dirPath)) {
            context.printer.writeError(`${dirPath} not found`);
            return;
        }
        const recurse: boolean = namedArgs.recurse === true;
        const fileCount = countJsonl(dirPath, recurse);
        if (fileCount === 0) {
            context.printer.writeError(`No *.jsonl transcripts in ${dirPath}`);
            return;
        }
        const name: string = namedArgs.name ?? path.basename(dirPath);
        const maxMessages: number | undefined =
            typeof namedArgs.maxMessages === "number"
                ? namedArgs.maxMessages
                : undefined;
        const maxFiles: number | undefined =
            typeof namedArgs.maxFiles === "number"
                ? namedArgs.maxFiles
                : undefined;
        const effectiveFileCount =
            maxFiles !== undefined ? Math.min(maxFiles, fileCount) : fileCount;
        context.printer.writeLine(
            `Importing ${effectiveFileCount} of ${fileCount} ${SOURCE_LABEL[source]} transcript(s) from ${dirPath}${
                recurse ? " (recursive)" : ""
            }${maxMessages !== undefined ? ` (stopping at ${maxMessages} message(s))` : ""}`,
        );

        // Create progress bar for tracking file processing
        const fileProgress = new ProgressBar(context.printer, effectiveFileCount);
        const fileProgressCallback = (
            current: number,
            total: number,
            filePath: string,
        ) => {
            fileProgress.advance();
            const shortPath = path.basename(filePath);
            context.printer.writeLine(`  [${current}/${total}] ${shortPath}`);
        };

        // Track if we need to show indexing status
        let indexProgress: ProgressBar | undefined;
        const indexProgressCallback = (current: number, total: number) => {
            if (!indexProgress) {
                context.printer.writeLine(
                    `Extracting knowledge and building index (${total} message(s))...`,
                );
                indexProgress = new ProgressBar(context.printer, total);
            }
            indexProgress.advance();
        };

        // Track messages whose knowledge extraction failed; the import keeps
        // going and adds them without extracted knowledge.
        let skipped = 0;
        const indexErrorCallback = (
            current: number,
            total: number,
            error: string,
        ) => {
            skipped++;
            context.printer.writeLineInColor(
                chalk.yellow,
                `  Skipped knowledge extraction for message ${current}/${total}: ${error}`,
            );
        };

        await applyImport(
            source,
            name,
            namedArgs,
            (options) => {
                // Add progress callbacks to options
                return source === "claude"
                    ? cm.importClaudeSessionsFromDir(dirPath, {
                          ...options,
                          onProgress: fileProgressCallback,
                          onIndexProgress: indexProgressCallback,
                          onIndexError: indexErrorCallback,
                      })
                    : cm.importCopilotSessionsFromDir(dirPath, {
                          ...options,
                          onProgress: fileProgressCallback,
                          onIndexProgress: indexProgressCallback,
                          onIndexError: indexErrorCallback,
                      });
            },
        );

        fileProgress.complete();
        if (indexProgress) {
            indexProgress.complete();
        }
        if (skipped > 0) {
            context.printer.writeLineInColor(
                chalk.yellow,
                `${skipped} message(s) imported without extracted knowledge.`,
            );
        }
    }

    // Runs an import and either replaces the active session memory or, when
    // --append is set and a memory is already loaded, merges (and indexes) the
    // newly parsed messages into it so you can query across multiple sessions.
    async function applyImport(
        source: SessionSource,
        name: string,
        namedArgs: NamedArgs,
        produce: (
            options: cm.SessionImportOptions,
        ) => Promise<cm.ConversationMemory>,
    ): Promise<void> {
        const append =
            namedArgs.append === true && context.sessionMemory !== undefined;
        const options = importOptionsFromArgs(namedArgs);
        // When appending, build the freshly parsed memory without its own index;
        // the messages are indexed as they are added to the target memory.
        const produceOptions: cm.SessionImportOptions = append
            ? { ...options, buildIndex: false }
            : options;

        const clock = new StopWatch();
        clock.start();
        const fresh = await produce(produceOptions);
        let memory = fresh;
        let targetName = name;
        if (append) {
            const target = context.sessionMemory!;
            for (const message of fresh.messages.getAll()) {
                const result = await target.addMessage(message, true, true);
                if (!result.success) {
                    context.printer.writeError(
                        `Failed to merge a message: ${result.message}`,
                    );
                }
            }
            memory = target;
            targetName = target.nameTag;
            context.printer.writeLine(
                `Merged ${fresh.messages.length} message(s) into "${targetName}"`,
            );
        }
        clock.stop();

        // Appended merges are always indexed, so force the indexed save/label
        // path regardless of the per-import buildIndex flag.
        const finishOptions: cm.SessionImportOptions = append
            ? { ...options, buildIndex: true }
            : options;
        await finishImport(
            source,
            targetName,
            memory,
            finishOptions,
            clock,
            namedArgs,
        );
    }

    // Counts *.jsonl transcripts in a directory, honoring the recurse flag.
    function countJsonl(dir: string, recurse: boolean): number {
        let count = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (recurse) {
                    count += countJsonl(path.join(dir, entry.name), recurse);
                }
            } else if (entry.name.toLowerCase().endsWith(".jsonl")) {
                count++;
            }
        }
        return count;
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
