// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { KnowProContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import path from "path";
import { ensureDir, isFilePath, readJsonFile } from "typeagent";
import {
    createIndexingEventHandler,
    loadEmailMemory,
    memoryNameToIndexPath,
} from "./knowproCommon.js";
import chalk from "chalk";

export type KnowProEmailContext = {
    printer: KnowProPrinter;
    email?: cm.EmailMemory | undefined;
    basePath: string;
};

export async function createKnowproEmailCommands(
    kpContext: KnowProContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowProEmailContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "email"),
    };
    await ensureDir(context.basePath);

    commands.kpEmailAdd = emailAdd;
    commands.kpEmailsLoad = emailsLoad;
    commands.kpEmailsBuildIndex = emailsBuildIndex;
    commands.kpEmailNameAlias = emailNameAlias;
    commands.kpEmailsClose = emailsClose;

    function emailAddDef(): CommandMetadata {
        return {
            description:
                "Add a new email or emails to the current email memory",
            args: {
                filePath: arg("Email file or folder to add"),
            },
            options: {
                updateIndex: argBool("Automatically update index", true),
            },
        };
    }
    commands.kpEmailAdd.metadata = emailAddDef();
    async function emailAdd(args: string[]) {
        const emailMemory = ensureMemoryLoaded();
        if (!emailMemory) {
            return;
        }
        const namedArgs = parseNamedArguments(args, emailAddDef());
        let emailsToAdd: cm.EmailMessage[] = [];
        if (isFilePath(namedArgs.filePath)) {
            const emailMessage = cm.loadEmailMessageFromFile(
                namedArgs.filePath,
            );
            if (emailMessage) {
                emailsToAdd.push(emailMessage);
            }
        } else {
            emailsToAdd = cm.loadEmailMessagesFromDir(namedArgs.filePath);
        }
        if (emailsToAdd.length === 0) {
            context.printer.writeError(
                `No loadable emails found in ${namedArgs.filePath}`,
            );
            return;
        }
        context.printer.writeLine(`Adding ${emailsToAdd.length} messages`);
        let progress = new ProgressBar(context.printer, 1);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            emailsToAdd.length,
        );
        const result = await emailMemory.addMessages(
            emailsToAdd,
            namedArgs.updateIndex,
            eventHandler,
        );
        progress.complete();
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
    }

    function emailsBuildIndexDef(): CommandMetadata {
        return {
            description: "Update the email index with any pending items",
            options: {
                knowledge: argBool("Extract knowledge", true),
            },
        };
    }
    commands.kpEmailsBuildIndex.metadata = emailsBuildIndexDef();
    async function emailsBuildIndex(args: string[] | NamedArgs): Promise<void> {
        const emailMemory = ensureMemoryLoaded();
        if (!emailMemory) {
            return;
        }
        const namedArgs = parseNamedArguments(args, emailsBuildIndexDef());
        context.printer.writeLine(`Building email index`);
        const ordinalStartAt = emailMemory.indexingState.lastMessageOrdinal;
        const countToIndex = emailMemory.messages.length - ordinalStartAt;
        context.printer.writeLine(
            `OrdinalStartAt: ${ordinalStartAt + 1} / ${countToIndex}`,
        );

        let progress = new ProgressBar(context.printer, countToIndex);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            1,
        );
        const indexSettings =
            emailMemory.settings.conversationSettings.semanticRefIndexSettings;
        const autoIndex = indexSettings.autoExtractKnowledge;
        indexSettings.autoExtractKnowledge = namedArgs.knowledge;
        try {
            const clock = new StopWatch();
            clock.start();
            const result = await emailMemory.buildIndex(eventHandler);
            clock.stop();
            progress.complete();
            context.printer.writeTiming(chalk.gray, clock, "Build index");
            if (!result.success) {
                context.printer.writeError(result.message);
                return;
            }
        } finally {
            indexSettings.autoExtractKnowledge = autoIndex;
        }
    }

    function loadEmailsDef(): CommandMetadata {
        return {
            description: "Load or Create Email Memory",
            options: {
                //filePath: argDestFile("Path to email index"),
                name: arg("Name of email memory"),
                createNew: argBool("Create new", false),
            },
        };
    }
    commands.kpEmailsLoad.metadata = loadEmailsDef();
    async function emailsLoad(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadEmailsDef());
        let emailIndexPath = namedArgs.filePath;
        emailIndexPath ??= namedArgs.name
            ? memoryNameToIndexPath(context.basePath, namedArgs.name)
            : undefined;
        if (!emailIndexPath) {
            context.printer.writeError("No memory name or path provided");
            return;
        }
        closeEmail();
        context.email = await loadEmailMemory(
            emailIndexPath,
            namedArgs.createNew,
        );
        if (!context.email) {
            // Memory not found. Create a new one
            context.email = await loadEmailMemory(emailIndexPath, true);
            if (!context.email) {
                context.printer.writeError("Could not create new email memory");
                return;
            }
        }
        // Load a user profile if one is found
        const userProfile = await readJsonFile<cm.EmailUserProfile>(
            path.join(context.basePath, "emailUserProfile.json"),
        );
        context.email.settings.userProfile = userProfile;
        kpContext.conversation = context.email;
    }

    function emailNameAliasDef(): CommandMetadata {
        return {
            description: "Add an alias for a person's name",
            options: {
                name: arg("Person's name"),
                alias: arg("Alias"),
            },
        };
    }
    commands.kpEmailNameAlias.metadata = emailNameAliasDef();
    async function emailNameAlias(args: string[]): Promise<void> {
        const emailMemory = ensureMemoryLoaded();
        if (!emailMemory) {
            return;
        }

        const namedArgs = parseNamedArguments(args, emailNameAliasDef());
        const aliases =
            context.email!.secondaryIndexes.termToRelatedTermsIndex.aliases;
        if (namedArgs.name && namedArgs.alias) {
            aliases.addRelatedTerm(namedArgs.alias, namedArgs.name);
            await context.email!.writeToFile();
        } else if (namedArgs.alias) {
            const names = aliases.lookupTerm(namedArgs.alias);
            if (names) {
                context.printer.writeTerms(names);
            }
        }
    }

    async function emailsClose() {
        closeEmail();
    }

    function ensureMemoryLoaded() {
        if (context.email) {
            return context.email;
        }
        context.printer.writeError("No email memory loaded");
        return undefined;
    }

    function closeEmail() {
        if (context.email) {
            context.email.close();
            context.email = undefined;
        }
    }
    return;
}
