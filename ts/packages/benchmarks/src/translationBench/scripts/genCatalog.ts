// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionManifest, AppAgentManifest } from "@typeagent/agent-sdk";
import {
    fromJSONParsedActionSchema,
    parseActionSchemaSource,
    type ParsedActionSchema,
    type SchemaConfig,
} from "@typeagent/action-schema";
import { createRequire } from "node:module";
import {
    createWriteStream,
    existsSync,
    readFileSync,
    renameSync,
    unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finished } from "node:stream/promises";

import { Command } from "commander";

import type { ParamSpec } from "../policy/paramTypes.js";
import {
    renderSchemaType,
    schemaTypeToParamSpec,
    type SchemaFieldNode,
    type SchemaTypeNode,
} from "../policy/schemaTypeConvert.js";

/**
 * Schemas whose actions are omitted from the packaged catalog action list.
 * Root `dispatcher` previously excluded the abstain action (`unknown`); keep
 * it in the catalog so eligibility policy and the action-quality picker can
 * fail-closed remove it. No schemas are label-excluded today.
 */

interface GeneratedAction {
    schemaName: string;
    actionName: string;
    parameters: string;
    paramSpec: ParamSpec;
    description?: string;
}

interface ActionTypeNode {
    type?: {
        fields?: Record<string, SchemaFieldNode>;
    };
    comments?: string[];
}

interface ActionConfigLike {
    schemaName: string;
    schemaType:
        | string
        | { action?: string; activity?: string; entity?: string };
    schemaFile:
        | { format: string; content: string; config?: string }
        | (() => { format: string; content: string; config?: string });
    schemaFilePath?: string;
    [key: string]: unknown;
}

/** Package roots relative to this script's compiled location (dist/...). */
function packageRoot(name: "defaultAgentProvider" | "dispatcher"): string {
    // dist/translationBench/scripts → …/packages/benchmarks/dist/translationBench/scripts ../../../.. → …/packages
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packagesDir = path.resolve(here, "../../../..");
    if (name === "defaultAgentProvider") {
        return path.join(packagesDir, "defaultAgentProvider");
    }
    return path.join(packagesDir, "dispatcher", "dispatcher");
}

async function loadConvertToActionConfig(): Promise<
    (
        name: string,
        manifest: AppAgentManifest | ActionManifest,
        configs: Record<string, ActionConfigLike>,
    ) => void
> {
    const dispatcherRoot = packageRoot("dispatcher");
    const configUrl = pathToFileURL(
        path.join(dispatcherRoot, "dist/translation/actionConfig.js"),
    ).href;
    const configMod = await import(configUrl);
    if (typeof configMod.convertToActionConfig !== "function") {
        throw new Error(`convertToActionConfig missing from ${configUrl}`);
    }
    return configMod.convertToActionConfig;
}

/** Inline few-line helpers — do not import agentTranslators.js. */
function getActionSchemaTypeName(
    schemaType: string | { action?: string },
): string | undefined {
    return typeof schemaType === "string" ? schemaType : schemaType.action;
}

function getActivitySchemaTypeName(
    schemaType: string | { activity?: string },
): string | undefined {
    return typeof schemaType === "string" ? undefined : schemaType.activity;
}

function resolveSchemaContent(config: ActionConfigLike): {
    format: string;
    content: string;
    config?: string;
} {
    const schemaFile = config.schemaFile;
    if (typeof schemaFile === "function") {
        return schemaFile();
    }
    return schemaFile;
}

function parseActionConfig(config: ActionConfigLike): ParsedActionSchema {
    const {
        format,
        content,
        config: schemaConfigJson,
    } = resolveSchemaContent(config);
    if (!content) {
        throw new Error(`Empty schema content for '${config.schemaName}'`);
    }

    if (format === "pas") {
        const json = JSON.parse(content) as unknown;
        const parsed = fromJSONParsedActionSchema(json as never);
        const actionTypeName = getActionSchemaTypeName(config.schemaType);
        if (
            actionTypeName !== undefined &&
            parsed.entry.action?.name !== actionTypeName
        ) {
            throw new Error(
                `Schema type mismatch: actual: ${parsed.entry.action?.name}, expected: ${actionTypeName}`,
            );
        }
        const activityTypeName = getActivitySchemaTypeName(config.schemaType);
        if (parsed.entry.activity?.name !== activityTypeName) {
            throw new Error(
                `Activity type mismatch: actual: ${parsed.entry.activity?.name}, expected: ${activityTypeName}`,
            );
        }
        return parsed;
    }

    if (format !== "ts") {
        throw new Error(
            `Unsupported schema format '${format}' for '${config.schemaName}'`,
        );
    }

    const schemaConfig: SchemaConfig | undefined = schemaConfigJson
        ? (JSON.parse(schemaConfigJson) as SchemaConfig)
        : undefined;
    const fileName = config.schemaFilePath ?? `${config.schemaName}.ts`;
    return parseActionSchemaSource(
        content,
        config.schemaName,
        config.schemaType,
        fileName,
        schemaConfig,
        true,
    );
}

function parameterSpec(actionType: ActionTypeNode): ParamSpec {
    const params = actionType.type?.fields?.parameters?.type as
        | SchemaTypeNode
        | undefined;
    if (!params) return { kind: "object", fields: {} };
    return schemaTypeToParamSpec(params);
}

function summarizeParameters(actionType: ActionTypeNode): string {
    const fields = actionType.type?.fields;
    if (!fields) return "(none)";
    const params = fields.parameters?.type as SchemaTypeNode | undefined;
    if (!params || params.type !== "object" || !params.fields) return "(none)";
    const names = Object.entries(params.fields).map(
        ([name, f]) =>
            `${name}${f.optional ? "?" : ""}: ${renderSchemaType(f.type)}`,
    );
    return names.length === 0 ? "(none)" : names.join(", ");
}

/** Resolve relative schema/grammar paths against the manifest directory. */
function patchManifestPaths(
    manifest: ActionManifest | AppAgentManifest,
    dir: string,
): void {
    const schema = (manifest as ActionManifest).schema;
    if (schema) {
        for (const key of [
            "schemaFile",
            "originalSchemaFile",
            "grammarFile",
        ] as const) {
            const value = (schema as Record<string, unknown>)[key];
            if (typeof value === "string" && !path.isAbsolute(value)) {
                (schema as Record<string, unknown>)[key] = path.resolve(
                    dir,
                    value,
                );
            }
        }
    }
    const subs = (manifest as ActionManifest).subActionManifests;
    if (subs) {
        for (const sub of Object.values(subs)) {
            patchManifestPaths(sub, dir);
        }
    }
}

function loadJsonManifest(manifestPath: string): AppAgentManifest {
    const raw = JSON.parse(
        readFileSync(manifestPath, "utf8"),
    ) as AppAgentManifest;
    patchManifestPaths(raw, path.dirname(manifestPath));
    return raw;
}

function loadAgentManifest(
    requireFromProvider: NodeJS.Require,
    packageName: string,
): AppAgentManifest {
    try {
        const manifestPath = requireFromProvider.resolve(
            `${packageName}/agent/manifest`,
        );
        return loadJsonManifest(manifestPath);
    } catch {
        const pkgJsonPath = requireFromProvider.resolve(
            `${packageName}/package.json`,
        );
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
            exports?: Record<string, string | { default?: string }>;
        };
        const exp = pkgJson.exports?.["./agent/manifest"];
        const rel =
            typeof exp === "string"
                ? exp
                : exp && typeof exp === "object"
                  ? exp.default
                  : undefined;
        if (!rel) {
            throw new Error(
                `No agent/manifest export for package '${packageName}'`,
            );
        }
        return loadJsonManifest(path.resolve(path.dirname(pkgJsonPath), rel));
    }
}

/** Built-in dispatcher + system manifests (paths relative to dispatcher package). */
function builtinManifests(
    dispatcherRoot: string,
): Record<string, AppAgentManifest> {
    const resolve = (rel: string) => path.resolve(dispatcherRoot, rel);
    return {
        dispatcher: {
            emojiChar: "🔄",
            description: "Built-in agent to dispatch requests",
            schema: {
                description: "",
                schemaType: "DispatcherActions",
                schemaFile: resolve(
                    "src/context/dispatcher/schema/dispatcherActionSchema.ts",
                ),
                injected: true,
                cached: false,
            },
            subActionManifests: {
                clarify: {
                    schema: {
                        description:
                            "Action that helps you clarify your request.",
                        schemaFile: resolve(
                            "src/context/dispatcher/schema/clarifyActionSchema.ts",
                        ),
                        schemaType: "ClarifyRequestAction",
                        injected: true,
                        cached: false,
                    },
                },
                lookup: {
                    schema: {
                        description:
                            "Action that helps you look up information to answer user questions.",
                        schemaFile: resolve(
                            "src/context/dispatcher/schema/lookupActionSchema.ts",
                        ),
                        schemaType: {
                            action: "LookupAction",
                            activity: "LookupActivity",
                        },
                        injected: true,
                        cached: false,
                    },
                },
                activity: {
                    transient: true,
                    schema: {
                        description: "Action that manages activity context.",
                        schemaFile: resolve(
                            "src/context/dispatcher/schema/activityActionSchema.ts",
                        ),
                        schemaType: "ActivityActions",
                        injected: true,
                        cached: false,
                    },
                },
                reasoning: {
                    schema: {
                        description:
                            "Action that helps you reason through requests that require multiple steps.",
                        schemaFile: resolve(
                            "src/context/dispatcher/schema/reasoningActionSchema.ts",
                        ),
                        schemaType: "ReasoningAction",
                        injected: true,
                        cached: false,
                    },
                },
            },
        },
        system: {
            emojiChar: "🔧",
            description:
                "Built-in agent to manage system configuration and conversations",
            subActionManifests: {
                config: {
                    schema: {
                        description:
                            "System agent that helps you manage system settings and preferences.",
                        schemaFile: resolve(
                            "src/context/system/schema/configActionSchema.ts",
                        ),
                        schemaType: "ConfigAction",
                    },
                },
                conversation: {
                    schema: {
                        description:
                            "System agent that manages TypeAgent shell conversations.",
                        schemaFile: resolve(
                            "src/context/system/schema/conversationActionSchema.ts",
                        ),
                        schemaType: "ConversationAction",
                    },
                },
                notify: {
                    schema: {
                        description:
                            "System agent that helps manage notifications.",
                        schemaFile: resolve(
                            "src/context/system/schema/notificationActionSchema.ts",
                        ),
                        schemaType: "NotificationAction",
                    },
                },
                history: {
                    schema: {
                        description:
                            "System agent that helps manage chat history.",
                        schemaFile: resolve(
                            "src/context/system/schema/historyActionSchema.ts",
                        ),
                        schemaType: "HistoryAction",
                    },
                },
                grammar: {
                    schema: {
                        description:
                            "System agent that helps manage action grammars.",
                        schemaFile: resolve(
                            "src/context/system/schema/grammarActionSchema.ts",
                        ),
                        schemaType: "GrammarAction",
                    },
                },
                settings: {
                    schema: {
                        description: "System agent that helps manage settings.",
                        schemaFile: resolve(
                            "src/context/system/schema/settingsActionSchema.ts",
                        ),
                        schemaType: "UserSettingsAction",
                    },
                },
                help: {
                    schema: {
                        description: "Answer questions about TypeAgent itself.",
                        schemaFile: resolve(
                            "src/context/system/schema/helpActionSchema.ts",
                        ),
                        schemaType: "HelpAction",
                    },
                },
            },
        },
    };
}

type CatalogWriteStream = {
    writeAction: (action: GeneratedAction, isLast: boolean) => Promise<void>;

    end: () => Promise<void>;
    tmpPath: string;
    outPath: string;
};

async function openCatalogWriter(
    outPath: string,
    header: {
        catalogVersion: string;
        activeSchemas: string[];
        unloadableSchemas: string[];
        allRegistrySchemas: string[];
        activeSchemaSource: string;
    },
): Promise<CatalogWriteStream> {
    const tmpPath = `${outPath}.tmp`;
    try {
        unlinkSync(tmpPath);
    } catch {
        // ignore
    }
    const stream = createWriteStream(tmpPath, { encoding: "utf8" });
    let streamError: Error | undefined;
    stream.on("error", (err) => {
        streamError = err;
    });
    const write = (chunk: string): Promise<void> =>
        new Promise((resolve, reject) => {
            if (streamError) {
                reject(streamError);
                return;
            }
            if (stream.write(chunk)) {
                resolve();
                return;
            }
            const onDrain = () => {
                stream.off("error", onError);
                resolve();
            };
            const onError = (err: Error) => {
                stream.off("drain", onDrain);
                reject(err);
            };
            stream.once("drain", onDrain);
            stream.once("error", onError);
        });

    await write("{\n");
    await write(
        `  "catalogVersion": ${JSON.stringify(header.catalogVersion)},\n`,
    );
    await write(
        `  "activeSchemas": ${JSON.stringify(header.activeSchemas, null, 2).replace(/\n/g, "\n  ")},\n`,
    );
    await write(
        `  "unloadableSchemas": ${JSON.stringify(header.unloadableSchemas, null, 2).replace(/\n/g, "\n  ")},\n`,
    );
    await write(
        `  "allRegistrySchemas": ${JSON.stringify(header.allRegistrySchemas, null, 2).replace(/\n/g, "\n  ")},\n`,
    );
    await write(
        `  "activeSchemaSource": ${JSON.stringify(header.activeSchemaSource)},\n`,
    );
    await write(`  "actions": [\n`);

    return {
        tmpPath,
        outPath,
        async writeAction(action, isLast) {
            const actionJson = JSON.stringify(action, null, 2).replace(
                /\n/g,
                "\n    ",
            );
            const comma = isLast ? "" : ",";
            await write(`    ${actionJson}${comma}\n`);
        },
        async end() {
            await write(`  ]\n}\n`);
            stream.end();
            await finished(stream);
            renameSync(tmpPath, outPath);
        },
    };
}

async function writeCatalogAtomic(
    outPath: string,
    payload: {
        catalogVersion: string;
        activeSchemas: string[];
        unloadableSchemas: string[];
        allRegistrySchemas: string[];
        activeSchemaSource: string;
        actions: GeneratedAction[];
    },
): Promise<void> {
    const writer = await openCatalogWriter(outPath, {
        catalogVersion: payload.catalogVersion,
        activeSchemas: payload.activeSchemas,
        unloadableSchemas: payload.unloadableSchemas,
        allRegistrySchemas: payload.allRegistrySchemas,
        activeSchemaSource: payload.activeSchemaSource,
    });
    try {
        const n = payload.actions.length;
        for (let i = 0; i < n; i += 1) {
            await writer.writeAction(payload.actions[i]!, i === n - 1);
            // Allow GC of large paramSpec trees progressively when caller nulls slots (optional).
            (payload.actions as Array<GeneratedAction | undefined>)[i] =
                undefined;
        }
        await writer.end();
    } catch (error) {
        try {
            unlinkSync(writer.tmpPath);
        } catch {
            // ignore
        }
        throw error;
    }
}

function collectActionConfigs(
    convertToActionConfig: (
        name: string,
        manifest: AppAgentManifest | ActionManifest,
        configs: Record<string, ActionConfigLike>,
    ) => void,
): Record<string, ActionConfigLike> {
    const dapRoot = packageRoot("defaultAgentProvider");
    const dispatcherRoot = packageRoot("dispatcher");
    const configPath = path.join(dapRoot, "data", "config.json");
    if (!existsSync(configPath)) {
        throw new Error(`default agent config not found: ${configPath}`);
    }
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        agents: Record<string, { name: string }>;
    };
    const requireFromProvider = createRequire(
        path.join(dapRoot, "package.json"),
    );

    const actionConfigs: Record<string, ActionConfigLike> = {};

    for (const [agentName, entry] of Object.entries(config.agents)) {
        const manifest = loadAgentManifest(requireFromProvider, entry.name);
        convertToActionConfig(agentName, manifest, actionConfigs);
    }

    for (const [name, manifest] of Object.entries(
        builtinManifests(dispatcherRoot),
    )) {
        convertToActionConfig(name, manifest, actionConfigs);
    }

    return actionConfigs;
}

function parseCli(argv: string[]) {
    const program = new Command()
        .name("genCatalog")
        .description(
            "Generate catalog.generated.json from agent action schemas",
        )
        .option(
            "--allow-unloadable",
            "write partial catalog when some schemas fail",
            false,
        )
        .option(
            "--i-understand-grader-deletions",
            "required with --allow-unloadable (grader may drop missing actions)",
            false,
        )
        .argument(
            "[out]",
            "output path",
            "src/translationBench/catalog.generated.json",
        )
        .allowExcessArguments(false)
        .parse(argv, { from: "user" });

    const opts = program.opts<{
        allowUnloadable: boolean;
        iUnderstandGraderDeletions: boolean;
    }>();
    const [outPath] = program.args;
    return {
        outPath: outPath ?? "src/translationBench/catalog.generated.json",
        allowUnloadable: opts.allowUnloadable === true,
        understandGraderDeletions: opts.iUnderstandGraderDeletions === true,
    };
}

function extractActionsForSchema(
    schemaName: string,
    config: ActionConfigLike,
): GeneratedAction[] {
    const parsed = parseActionConfig(config);
    const out: GeneratedAction[] = [];
    if (!parsed.actionSchemas) return out;
    for (const [actionName, actionType] of parsed.actionSchemas) {
        const typed = actionType as ActionTypeNode;
        const description = typed.comments?.join(" ").trim().slice(0, 300);
        out.push({
            schemaName,
            actionName,
            parameters: summarizeParameters(typed),
            paramSpec: parameterSpec(typed),
            ...(description ? { description } : {}),
        });
    }
    return out;
}

async function main(): Promise<void> {
    const args = parseCli(process.argv.slice(2));
    const convertToActionConfig = await loadConvertToActionConfig();
    const actionConfigs = collectActionConfigs(convertToActionConfig);
    const schemaNames = Object.keys(actionConfigs).sort();
    if (!schemaNames.includes("dispatcher")) {
        throw new Error(
            "The `dispatcher` schema must stay active - it carries the abstain action.",
        );
    }

    const actions: GeneratedAction[] = [];
    const unloadable: Array<{ schemaName: string; error: string }> = [];

    for (const schemaName of schemaNames) {
        const config = actionConfigs[schemaName]!;
        try {
            const extracted = extractActionsForSchema(schemaName, config);
            actions.push(...extracted);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            unloadable.push({ schemaName, error: message });
            process.stderr.write(
                `[genCatalog] unloadable schema '${schemaName}': ${message}\n`,
            );
        } finally {
            // Drop config so peak RSS does not hold every schema thunk/content.
            delete actionConfigs[schemaName];
        }
    }

    if (unloadable.length > 0) {
        const names = unloadable.map((u) => u.schemaName).join(", ");
        const details = unloadable
            .map((u) => `  - ${u.schemaName}: ${u.error}`)
            .join("\n");
        if (!args.allowUnloadable) {
            throw new Error(
                `genCatalog: ${unloadable.length} schema(s) failed to load: ${names}.\n` +
                    `${details}\n` +
                    `Re-run with --allow-unloadable --i-understand-grader-deletions to ` +
                    `write a partial catalog (will cascade grader deletions).`,
            );
        }
        if (!args.understandGraderDeletions) {
            throw new Error(
                `genCatalog: --allow-unloadable requires --i-understand-grader-deletions ` +
                    `because missing schemas drop actions and the grader deletes those byAction entries.\n` +
                    `Unloadable:\n${details}`,
            );
        }
        process.stderr.write(
            `[genCatalog] WARNING: writing partial catalog; grader may delete policies for: ${names}\n`,
        );
    }

    const out = path.resolve(args.outPath);
    const unloadableNames = unloadable.map((u) => u.schemaName);
    // Keep prior behavior: schemaNames minus unloadable (includes label-excluded parents still present in the registry list).
    const activeForCatalog = schemaNames.filter(
        (s) => !unloadableNames.includes(s),
    );
    const actionCount = actions.length;

    await writeCatalogAtomic(out, {
        catalogVersion: new Date().toISOString().slice(0, 10),
        activeSchemas: activeForCatalog,
        unloadableSchemas: unloadableNames,
        allRegistrySchemas: [...schemaNames],
        activeSchemaSource:
            "defaultAgentProvider/data/config.json + builtin dispatcher/system (schema-only; no agent runtime / msal)",
        actions,
    });
    process.stderr.write(
        `[genCatalog] wrote ${out}: ${activeForCatalog.length} active schemas, ${actionCount} actions` +
            (unloadable.length ? `, ${unloadable.length} unloadable` : "") +
            "\n",
    );
}

main().then(
    () => setTimeout(() => process.exit(0), 250).unref(),
    (e) => {
        console.error("genCatalog failed:", e);
        process.exit(1);
    },
);
