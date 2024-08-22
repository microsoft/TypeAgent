// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

import chalk from "chalk";
import {
    CommandHandler,
    HandlerTable,
    getToggleHandlerTable,
} from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    changeContextConfig,
} from "./common/commandHandlerContext.js";
import { readTestData } from "../utils/test/testData.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { ConstructionStore, printImportConstructionResult } from "agent-cache";
import { getSessionCacheDirPath } from "../explorer.js";
import { getDispatcherAgentName } from "../translation/agentTranslators.js";
import { RequestIO } from "./common/interactiveIO.js";
import { parseRequestArgs } from "../utils/args.js";
import { glob } from "glob";
import { getDispatcherConfig } from "../utils/config.js";

async function checkRecreateStore(
    constructionStore: ConstructionStore,
    requestIO: RequestIO,
) {
    if (!constructionStore.isModified()) {
        return;
    }
    const message =
        "Construction store has been modified.  All data will be lost!!! Continue?";
    if (!(await requestIO.askYesNo(message, true))) {
        throw new Error("Aborted!");
    }
}

async function checkOverwriteFile(
    filePath: string | undefined,
    requestIO: RequestIO,
) {
    if (filePath === undefined || !fs.existsSync(filePath)) {
        return;
    }
    const message = `File '${filePath}' exists.  Overwrite?`;
    if (!(await requestIO.askYesNo(message, true))) {
        throw new Error("Aborted!");
    }
}

function resolvePathWithSession(
    request: string,
    sessionDir: string | undefined,
    exists: boolean = false,
) {
    if (request === "") {
        return undefined;
    }
    // Try the session cache dir first
    if (
        sessionDir !== undefined &&
        !path.isAbsolute(request) &&
        !request.startsWith(".")
    ) {
        const sessionConstructionPath = path.join(
            getSessionCacheDirPath(sessionDir),
            request,
        );
        if (!exists || fs.existsSync(sessionConstructionPath)) {
            return sessionConstructionPath;
        }
    }

    return path.resolve(request);
}

class ConstructionNewCommandHandler implements CommandHandler {
    public readonly description = "Create a new construction store";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionStore = context.agentCache.constructionStore;
        await checkRecreateStore(constructionStore, context.requestIO);
        const constructionPath = resolvePathWithSession(
            request,
            context.session.dir,
        );
        await checkOverwriteFile(constructionPath, context.requestIO);

        await changeContextConfig({ cache: false }, context);
        if (constructionPath) {
            await fs.promises.writeFile(constructionPath, "");
        }
        context.session.setCacheDataFilePath(constructionPath);
        await changeContextConfig({ cache: true }, context);
        const filePath = constructionStore.getFilePath();
        context.requestIO.success(
            `Construction store initialized ${filePath ?? ""}`,
        );
    }
}

class ConstructionLoadCommandHandler implements CommandHandler {
    public readonly description = "Load a construction store from disk";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionStore = context.agentCache.constructionStore;
        await checkRecreateStore(constructionStore, context.requestIO);
        const constructionPath =
            resolvePathWithSession(request, context.session.dir, true) ??
            context.session.getCacheDataFilePath();
        if (constructionPath === undefined) {
            throw new Error(
                `No construction file specified and no existing construction file in session to load.`,
            );
        }

        if (!fs.existsSync(constructionPath)) {
            throw new Error(`File not found: ${constructionPath}`);
        }

        await changeContextConfig({ cache: false }, context);
        context.session.setCacheDataFilePath(constructionPath);
        await changeContextConfig({ cache: true }, context);

        context.requestIO.success(`Construction loaded: ${constructionPath}`);
    }
}

class ConstructionSaveCommandHandler implements CommandHandler {
    public readonly description = "Save construction store to disk";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionStore = context.agentCache.constructionStore;
        const constructionPath = resolvePathWithSession(
            request,
            context.session.dir,
        );
        await checkOverwriteFile(constructionPath, context.requestIO);
        if (await constructionStore.save(constructionPath)) {
            const filePath = constructionStore.getFilePath()!;
            context.session.setCacheDataFilePath(filePath);
            context.requestIO.success(`Construction saved: ${filePath}`);
        } else {
            context.requestIO.warn(
                `Construction not modified. Nothing written.`,
            );
        }
    }
}

class ConstructionInfoCommandHandler implements CommandHandler {
    public readonly description = "Show current construction store info";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionStore = context.agentCache.constructionStore;
        const info = constructionStore.getInfo();
        if (info === undefined) {
            context.requestIO.error("Construction is disabled.");
            return;
        }
        context.requestIO.result((log) => {
            log(`User constructions:`);
            if (info.filePath) {
                log(`  File: ${info.filePath}${info.modified ? "*" : ""}`);
            }
            log(`  # of consts: ${info.constructionCount}`);
            log();
            if (info.builtInConstructionCount !== undefined) {
                log(`Built-in constructions:`);
                log(`  File: ${info.builtInCacheFilePath}`);
                log(`  # of consts: ${info.builtInConstructionCount}`);
                log();
            }
            log(`Settings:`);
            for (const [key, value] of Object.entries(info.config)) {
                log(`${key.padStart(20)}: ${value}`);
            }
        });
    }
}

class ConstructionAutoCommandHandler implements CommandHandler {
    public readonly description = "Toggle construction auto save";
    public async run(request: string, context: CommandHandlerContext) {
        const state = request === "" || request === "on";
        await changeContextConfig({ autoSave: state }, context);
        context.requestIO.success(
            `Construction auto save ${state ? "on" : "off"}`,
        );
    }
}

class ConstructionOffCommandHandler implements CommandHandler {
    public readonly description = "Disable construction store";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionStore = context.agentCache.constructionStore;
        await checkRecreateStore(constructionStore, context.requestIO);
        await changeContextConfig({ cache: false }, context);
        context.requestIO.success("Construction store disabled.");
    }
}

class ConstructionListCommandHandler implements CommandHandler {
    public readonly description = "List constructions";
    public async run(request: string, context: CommandHandlerContext) {
        const constructionStore = context.agentCache.constructionStore;
        const { flags } = parseRequestArgs(
            request,
            {
                verbose: { char: "v", default: false },
                all: { char: "a", default: false },
                builtin: { char: "b", default: false },
                match: { char: "m", multiple: true },
                part: { char: "p", multiple: true },
                id: { multiple: true, type: "number" },
            },
            true,
        );
        constructionStore.print(flags);
    }
}

async function getImportTranslationFiles(
    context: CommandHandlerContext,
    test: boolean,
) {
    const config = getDispatcherConfig();
    let files: string[];
    if (test) {
        files = config.tests;
    } else {
        const infos = config.agents;
        const enabledAgents = new Set(
            Object.entries(context.session.getConfig().translators)
                .filter(([name, enabled]) => enabled)
                .map(([name]) => getDispatcherAgentName(name)),
        );

        files = Object.entries(infos).flatMap(([name, info]) =>
            enabledAgents.has(name) && info.imports ? info.imports : [],
        );
    }
    return await glob(files.map((f) => getPackageFilePath(f)));
}

async function expandPaths(paths: string[]) {
    const expanded = await glob(paths.map((p) => path.resolve(p)));
    // Resolve symlink and return unique paths.
    return Array.from(
        new Set(
            await Promise.all(expanded.map((p) => fs.promises.realpath(p))),
        ),
    );
}

class ConstructionImportCommandHandler implements CommandHandler {
    public readonly description = "Import constructions from test data";
    public async run(request: string, context: CommandHandlerContext) {
        const { args, flags } = parseRequestArgs(request, {
            test: { char: "t", default: false },
        });

        const inputs =
            args.length !== 0
                ? await expandPaths(args)
                : await getImportTranslationFiles(context, flags.test);

        if (inputs.length === 0) {
            if (args.length === 0) {
                throw new Error(`No input file specified.`);
            }
            throw new Error(`No input file found from '${args.join("', '")}'`);
        }

        // Sort by file name to make the result deterministic.
        inputs.sort();

        const data = await Promise.all(
            inputs.map(async (input) => {
                return { file: input, data: await readTestData(input) };
            }),
        );

        const matched = data.filter(
            (d) => d.data.explainerName === context.agentCache.explainerName,
        );

        if (matched.length === 0) {
            throw new Error(
                `No matching data found for explainer ${context.agentCache.explainerName}`,
            );
        }
        console.log(chalk.gray(`Importing from:`));
        matched.forEach((f) => {
            console.log(chalk.grey(`  ${f.file}`));
        });
        const result = await context.agentCache.import(
            matched.map((d) => d.data),
        );

        printImportConstructionResult(result);
    }
}

class ConstructionDeleteCommandHandler implements CommandHandler {
    public readonly description = "Delete a construction by id";

    public async run(request: string, context: CommandHandlerContext) {
        const { args } = parseRequestArgs(request);
        if (args.length !== 2) {
            throw new Error(
                "Invalid arguments. '@const delete <namespace> <id>' expected.",
            );
        }

        const id = parseInt(args[1]);
        if (id.toString() !== args[1]) {
            throw new Error(`Invalid construction id: ${args[1]}`);
        }
        const constructionStore = context.agentCache.constructionStore;
        await constructionStore.delete(args[0], id);
    }
}

export function getConstructionCommandHandlers(): HandlerTable {
    return {
        description: "Command to manage the construction store",
        defaultSubCommand: undefined,
        commands: {
            new: new ConstructionNewCommandHandler(),
            load: new ConstructionLoadCommandHandler(),
            save: new ConstructionSaveCommandHandler(),
            auto: new ConstructionAutoCommandHandler(),
            off: new ConstructionOffCommandHandler(),
            info: new ConstructionInfoCommandHandler(),
            list: new ConstructionListCommandHandler(),
            import: new ConstructionImportCommandHandler(),
            delete: new ConstructionDeleteCommandHandler(),
            merge: getToggleHandlerTable(
                "construction merge",
                async (context: CommandHandlerContext, enable: boolean) => {
                    await changeContextConfig(
                        { mergeMatchSets: enable },
                        context,
                    );
                },
            ),
            wildcard: getToggleHandlerTable(
                "wildcard matching",
                async (context: CommandHandlerContext, enable: boolean) => {
                    await changeContextConfig(
                        { matchWildcard: enable },
                        context,
                    );
                },
            ),
        },
    };
}
