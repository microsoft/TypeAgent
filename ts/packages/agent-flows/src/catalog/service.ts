// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
    detailForMacro,
    detailForPowerShellFlow,
    detailForTaskFlow,
    summarizeMacro,
    summarizePowerShellFlow,
    summarizeTaskFlow,
    type FlowIndexEntryLike,
    type MacroLike,
    type PowerShellDefinitionLike,
    type TaskFlowDefinitionLike,
} from "./summarize.js";
import {
    parseAutomationId,
    type AutomationCatalog,
    type AutomationDetail,
    type AutomationKind,
    type AutomationProviderStatus,
    type AutomationSummary,
    type AutomationValidationReport,
} from "./types.js";

// The macro manager's own methods. The catalog calls them and reports their
// answers; it applies no approval or validation rules of its own.
export interface MacroCatalogSource {
    listMacros(): Promise<{ macroId: string }[]>;
    inspectMacro(request: { macroId: string }): Promise<MacroLike>;
    validateMacro(request: {
        macroId: string;
        version?: number;
    }): Promise<AutomationValidationReport>;
    approveMacro(request: {
        macroId: string;
        version?: number;
    }): Promise<unknown>;
    disableMacro(request: { macroId: string }): Promise<unknown>;
    deleteMacro(request: { macroId: string }): Promise<void>;
}

export interface AutomationCatalogSources {
    instanceDir: string;
    macros?: MacroCatalogSource | undefined;
}

export interface AutomationCatalogService {
    list(): Promise<AutomationCatalog>;
    get(id: string): Promise<AutomationDetail>;
    validate(id: string): Promise<AutomationValidationReport>;
    approve(id: string): Promise<AutomationSummary>;
    disable(id: string): Promise<AutomationSummary>;
    remove(id: string): Promise<void>;
}

type StoredFlowEntry = FlowIndexEntryLike & {
    flowPath?: string;
    scriptPath?: string;
};

interface FlowIndexFile {
    flows?: Record<string, StoredFlowEntry>;
}

async function readJsonIfPresent<T>(file: string): Promise<T | undefined> {
    try {
        return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

async function readTextIfPresent(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

// Index files are written by other agents, so a stored path must not escape
// the agent's storage directory.
function resolveInside(root: string, relative: string | undefined) {
    if (!relative) return undefined;
    const resolved = path.resolve(root, relative);
    const rootWithSeparator = path.resolve(root) + path.sep;
    return resolved.startsWith(rootWithSeparator) ? resolved : undefined;
}

type FlowKind = Extract<AutomationKind, "powershell" | "taskflow">;

const FLOW_DIRS: Record<FlowKind, string> = {
    powershell: "powershell",
    taskflow: "taskflow",
};

export function createAutomationCatalogService(
    sources: AutomationCatalogSources,
): AutomationCatalogService {
    const flowRoot = (kind: FlowKind) =>
        path.join(sources.instanceDir, FLOW_DIRS[kind]);

    async function readFlowIndex(kind: FlowKind): Promise<StoredFlowEntry[]> {
        const index = await readJsonIfPresent<FlowIndexFile>(
            path.join(flowRoot(kind), "index.json"),
        );
        return Object.values(index?.flows ?? {});
    }

    async function listFlows(kind: FlowKind): Promise<AutomationSummary[]> {
        const entries = await readFlowIndex(kind);
        return entries.map((entry) =>
            kind === "powershell"
                ? summarizePowerShellFlow(entry)
                : summarizeTaskFlow(entry),
        );
    }

    async function listMacros(): Promise<AutomationSummary[]> {
        const macros = sources.macros!;
        const summaries = await macros.listMacros();
        const items: AutomationSummary[] = [];
        for (const { macroId } of summaries) {
            items.push(summarizeMacro(await macros.inspectMacro({ macroId })));
        }
        return items;
    }

    async function guarded(
        kind: AutomationKind,
        load: () => Promise<AutomationSummary[]>,
    ): Promise<{
        items: AutomationSummary[];
        status: AutomationProviderStatus;
    }> {
        try {
            return {
                items: await load(),
                status: { kind, available: true },
            };
        } catch (error) {
            return {
                items: [],
                status: {
                    kind,
                    available: false,
                    reason:
                        error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    async function getFlow(
        kind: FlowKind,
        name: string,
    ): Promise<AutomationDetail> {
        const root = flowRoot(kind);
        const entries = await readFlowIndex(kind);
        const entry = entries.find((e) => e.actionName === name);
        if (!entry) throw new Error(`Automation not found: ${kind}:${name}`);
        const definitionPath = resolveInside(root, entry.flowPath);
        const scriptPath = resolveInside(root, entry.scriptPath);
        const definition = definitionPath
            ? await readJsonIfPresent<
                  PowerShellDefinitionLike & TaskFlowDefinitionLike
              >(definitionPath)
            : undefined;
        const script = scriptPath
            ? await readTextIfPresent(scriptPath)
            : undefined;
        return kind === "powershell"
            ? detailForPowerShellFlow(
                  entry,
                  definition as PowerShellDefinitionLike | undefined,
                  script,
              )
            : detailForTaskFlow(
                  entry,
                  definition as TaskFlowDefinitionLike | undefined,
                  script,
              );
    }

    function macroSource(): MacroCatalogSource {
        if (!sources.macros) {
            throw new Error("Macro manager is not available.");
        }
        return sources.macros;
    }

    function parseMacroId(id: string): string {
        const parsed = parseAutomationId(id);
        if (parsed?.kind !== "toolMacro") {
            throw new Error(`This automation does not support that action.`);
        }
        return parsed.nativeId;
    }

    async function macroSummary(macroId: string) {
        return summarizeMacro(await macroSource().inspectMacro({ macroId }));
    }

    return {
        async list() {
            const [powershell, taskflow, macros] = await Promise.all([
                guarded("powershell", () => listFlows("powershell")),
                guarded("taskflow", () => listFlows("taskflow")),
                sources.macros
                    ? guarded("toolMacro", listMacros)
                    : Promise.resolve({
                          items: [] as AutomationSummary[],
                          status: {
                              kind: "toolMacro" as const,
                              available: false,
                              reason: "Macro manager is not available.",
                          },
                      }),
            ]);
            return {
                items: [
                    ...powershell.items,
                    ...taskflow.items,
                    ...macros.items,
                ],
                providers: [powershell.status, taskflow.status, macros.status],
            };
        },

        async get(id) {
            const parsed = parseAutomationId(id);
            if (!parsed) throw new Error(`Unknown automation id: ${id}`);
            switch (parsed.kind) {
                case "powershell":
                case "taskflow":
                    return getFlow(parsed.kind, parsed.nativeId);
                case "toolMacro":
                    return detailForMacro(
                        await macroSource().inspectMacro({
                            macroId: parsed.nativeId,
                        }),
                    );
                default:
                    throw new Error(`Unsupported automation kind: ${id}`);
            }
        },

        async validate(id) {
            return macroSource().validateMacro({ macroId: parseMacroId(id) });
        },

        async approve(id) {
            const macroId = parseMacroId(id);
            await macroSource().approveMacro({ macroId });
            return macroSummary(macroId);
        },

        async disable(id) {
            const macroId = parseMacroId(id);
            await macroSource().disableMacro({ macroId });
            return macroSummary(macroId);
        },

        async remove(id) {
            await macroSource().deleteMacro({ macroId: parseMacroId(id) });
        },
    };
}
