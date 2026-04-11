// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import {
    getCacheFactory,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getTraceId, getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    toPartitions,
    isModeAtLevel,
} from "agent-dispatcher/helpers/completion";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getDefaultAppAgentInstaller,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import inspector from "node:inspector";
import { getChatModelNames } from "aiclient";
import {
    getEnhancedConsolePrompt,
    processCommandsEnhanced,
    withEnhancedConsoleClientIO,
} from "../enhancedConsole.js";
import { isSlashCommand, getSlashCompletions } from "../slashCommands.js";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { getFsStorageProvider } from "dispatcher-node-providers";

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);

/**
 * Get completions for the current input line using dispatcher's command completion API
 */
// Return completion data including where filtering starts
type CompletionData = {
    allCompletions: string[]; // All available completions (just the completion text)
    filterStartIndex: number; // Where user typing should filter (after the space/trigger)
    prefix: string; // Fixed prefix before completions
};

// Architecture: docs/architecture/completion.md — §CLI integration
async function getCompletionsData(
    line: string,
    dispatcher: Dispatcher,
): Promise<CompletionData | null> {
    try {
        // Handle slash command completions
        if (isSlashCommand(line)) {
            const completions = getSlashCompletions(line);
            if (completions.length === 0) return null;
            return {
                allCompletions: completions,
                filterStartIndex: 0,
                prefix: "",
            };
        }
        // Send the full input to the backend; the grammar matcher reports
        // how much it consumed (matchedPrefixLength → startIndex) so the
        // CLI need not split on spaces to find token boundaries.
        // CLI tab-completion is always a forward action.
        const direction = "forward" as const;
        const result = await dispatcher.getCommandCompletion(line, direction);
        if (result.completions.length === 0) {
            return null;
        }

        // Use shared partition logic to properly resolve separatorMode
        // (including autoSpacePunctuation per-item resolution).  Collect
        // all completion strings from level-1 (space-separated) items
        // first, falling back to level-0 when no level-1 items exist.
        const partitions = toPartitions(
            result.completions,
            line,
            result.startIndex,
        );

        const allCompletions: string[] = [];
        for (const p of partitions) {
            for (const item of p.items) {
                allCompletions.push(item.matchText);
            }
        }

        const filterStartIndex = result.startIndex;
        const prefix = line.substring(0, filterStartIndex);

        // Use the shared isModeAtLevel to determine whether any partition
        // requires a separator at level 1 (space) — this is more accurate
        // than the previous heuristic that only checked raw group modes.
        const needsSep = partitions.some(
            (p) => isModeAtLevel(p.mode, 1) && !isModeAtLevel(p.mode, 0),
        );
        const separator = needsSep ? " " : "";

        return {
            allCompletions,
            filterStartIndex,
            prefix: prefix + separator,
        };
    } catch (e) {
        return null;
    }
}

export default class Interactive extends Command {
    static description = "Interactive mode";
    static flags = {
        agent: Flags.string({
            description: "Schema names",
            options: schemaNames,
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
        debug: Flags.boolean({
            description: "Enable debug mode",
            default: false,
        }),
        memory: Flags.boolean({
            description: "In memory session",
            default: false,
        }),
        exit: Flags.boolean({
            description: "Exit after processing input file",
            default: true,
            allowNo: true,
        }),
        verbose: Flags.string({
            description:
                "Enable verbose debug output (optional: comma-separated debug namespaces, default: typeagent:*)",
            required: false,
        }),
    };
    static args = {
        input: Args.file({
            description:
                "A text input file containing one interactive command per line",
            exists: true,
        }),
    };
    async run(): Promise<void> {
        const { args, flags } = await this.parse(Interactive);

        if (flags.debug) {
            inspector.open(undefined, undefined, true);
        }

        if (flags.verbose !== undefined) {
            const { default: registerDebug } = await import("debug");
            const namespaces = flags.verbose || "typeagent:*";
            registerDebug.enable(namespaces);
            process.env.DEBUG = namespaces;
            // Also set internal verbose state for prompt indicator
            const { enableVerboseFromFlag } = await import(
                "../slashCommands.js"
            );
            enableVerboseFromFlag(namespaces);
        }

        // Install debug interceptor so all stderr debug output
        // (whether from /verbose, --verbose, or DEBUG env var)
        // renders in the indented panel.
        const { installDebugInterceptor } = await import(
            "../debugInterceptor.js"
        );
        installDebugInterceptor();

        // Clear screen and move cursor to top for a clean full-height start
        if (process.stdout.isTTY) {
            process.stdout.write("\x1b[2J\x1b[H");
        }

        await withEnhancedConsoleClientIO(async (clientIO, bindDispatcher) => {
            const persistDir = !flags.memory ? instanceDir : undefined;
            const indexingServiceRegistry =
                await getIndexingServiceRegistry(persistDir);
            const dispatcher = await createDispatcher("cli interactive", {
                appAgentProviders: defaultAppAgentProviders,
                agentInstaller: getDefaultAppAgentInstaller(instanceDir),
                agents: flags.agent,
                translation: { model: flags.model },
                explainer: { name: flags.explainer },
                persistSession: !flags.memory,
                persistDir,
                storageProvider:
                    persistDir !== undefined
                        ? getFsStorageProvider()
                        : undefined,
                clientIO,
                dblogging: true,
                indexingServiceRegistry,
                traceId: getTraceId(),
                constructionProvider: getDefaultConstructionProvider(),
            });
            bindDispatcher(dispatcher);

            try {
                if (args.input) {
                    await dispatcher.processCommand(`@run ${args.input}`);
                    if (flags.exit) {
                        return;
                    }
                }

                await processCommandsEnhanced(
                    async (dispatcher: Dispatcher) =>
                        getEnhancedConsolePrompt(
                            getStatusSummary(await dispatcher.getStatus(), {
                                showPrimaryName: false,
                            }),
                        ),
                    (command: string, dispatcher: Dispatcher) =>
                        dispatcher.processCommand(command),
                    dispatcher,
                    undefined, // inputs
                    (line: string) => getCompletionsData(line, dispatcher),
                    dispatcher,
                );
            } finally {
                await dispatcher.close();
            }
        });

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
