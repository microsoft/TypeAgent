// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type AppAction,
    type ActionContext,
    type ActionResult,
    type SessionContext,
    type SchemaContent,
    type GrammarContent,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
    TaskFlowStore,
    type TaskFlowDefinition,
} from "./store/taskFlowStore.mjs";
import type { Recipe } from "./types/recipe.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:taskflow:handler");
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "samples");

// ── Agent context ───────────────────────────────────────────────────────────

interface TaskFlowAgentContext {
    store?: TaskFlowStore | undefined;
}

// ── Genre validation ────────────────────────────────────────────────────────

const KNOWN_GENRES: string[] = [
    "acoustic",
    "adult contemporary",
    "afrobeat",
    "alternative",
    "americana",
    "ambient",
    "appalachian",
    "bachata",
    "bebop",
    "big band",
    "bluegrass",
    "blues",
    "bossa nova",
    "broadway",
    "cajun",
    "celtic",
    "children's",
    "chillout",
    "christian",
    "christmas",
    "classic rock",
    "classical",
    "contemporary christian",
    "country",
    "cumbia",
    "dance",
    "disco",
    "drum and bass",
    "dubstep",
    "edm",
    "electronic",
    "emo",
    "flamenco",
    "folk",
    "funk",
    "gospel",
    "grunge",
    "hard rock",
    "hip-hop",
    "hip hop",
    "holiday",
    "honky tonk",
    "house",
    "indie",
    "industrial",
    "j-pop",
    "jazz",
    "k-pop",
    "latin",
    "lo-fi",
    "metal",
    "mountain",
    "musical theatre",
    "new age",
    "new wave",
    "old-time",
    "opera",
    "outlaw country",
    "pop",
    "power pop",
    "progressive rock",
    "psychedelic",
    "punk",
    "r&b",
    "rap",
    "red dirt",
    "reggae",
    "rnb",
    "rockabilly",
    "salsa",
    "singer-songwriter",
    "ska",
    "smooth jazz",
    "soft rock",
    "soul",
    "swing",
    "swing jazz",
    "techno",
    "tejano",
    "trap",
    "western swing",
    "world music",
    "worship",
    "zydeco",
];

function isKnownGenre(genre: string): boolean {
    const normalized = genre.toLowerCase().trim();
    return KNOWN_GENRES.some(
        (g) =>
            g === normalized ||
            normalized.includes(g) ||
            g.includes(normalized),
    );
}

// ── Sample seeding ──────────────────────────────────────────────────────────

async function seedSampleFlows(store: TaskFlowStore): Promise<number> {
    let seeded = 0;
    let sampleFiles: string[];
    try {
        sampleFiles = readdirSync(SAMPLES_DIR).filter((f) =>
            f.endsWith(".recipe.json"),
        );
    } catch {
        debug("No samples directory found");
        return 0;
    }

    for (const file of sampleFiles) {
        const recipe: Recipe = JSON.parse(
            readFileSync(join(SAMPLES_DIR, file), "utf8"),
        );

        if (store.hasFlow(recipe.actionName)) continue;
        if (store.isSampleDeleted(recipe.actionName)) continue;

        await store.saveFlow(recipe, "seed");
        seeded++;
    }

    if (seeded > 0) {
        debug(`Seeded ${seeded} sample flow(s)`);
    }
    return seeded;
}

// ── Action handler ──────────────────────────────────────────────────────────

let _agentStore: TaskFlowStore | undefined;

async function handleTaskFlowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    context: ActionContext<TaskFlowAgentContext>,
): Promise<ActionResult> {
    const store = _agentStore;

    switch (action.actionName) {
        case "listTaskFlows": {
            if (!store) {
                return createActionResultFromTextDisplay(
                    "Task flow store not available.",
                );
            }
            const entries = store.listFlows();
            if (entries.length === 0) {
                return createActionResultFromTextDisplay(
                    "No task flows registered.",
                );
            }
            const lines = entries.map(
                (e) =>
                    `  \u2022 ${e.actionName}: ${e.description} [usage: ${e.usageCount}]${e.source === "seed" ? " (sample)" : ""}`,
            );
            return createActionResultFromTextDisplay(
                `Task flows (${entries.length}):\n${lines.join("\n")}`,
            );
        }

        case "deleteTaskFlow": {
            if (!store) {
                return createActionResultFromError(
                    "Task flow store not available",
                );
            }
            const name = action.parameters?.name as string | undefined;
            if (!name) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }
            const deleted = await store.deleteFlow(name);
            if (!deleted) {
                return createActionResultFromError(
                    `Task flow not found: ${name}`,
                );
            }
            await context.sessionContext.reloadAgentSchema();
            return createActionResultFromTextDisplay(
                `Deleted task flow: ${name}`,
            );
        }

        case "executeTaskFlow": {
            if (!store) {
                return createActionResultFromError(
                    "Task flow store not available",
                );
            }
            const flowName = action.parameters?.flowName as string | undefined;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: flowName",
                );
            }

            const flow = await store.getFlow(flowName);
            if (!flow) {
                return createActionResultFromError(
                    `Unknown task flow '${flowName}'. Use 'list my task flows' to see available flows.`,
                );
            }

            // Extract flow parameters (everything except flowName)
            const flowParams: Record<string, unknown> = {};
            if (action.parameters) {
                for (const [key, value] of Object.entries(action.parameters)) {
                    if (key !== "flowName") {
                        flowParams[key] = value;
                    }
                }
            }

            const result = await executeFlow(flow, flowParams, context);
            await store.recordUsage(flowName);
            return result;
        }

        default: {
            // Dynamic flow execution — grammar may route directly to flow name
            if (!store) {
                return createActionResultFromError(
                    `Unknown action '${action.actionName}'`,
                );
            }

            const flow = await store.getFlow(action.actionName);
            if (!flow) {
                return createActionResultFromError(
                    `Unknown task flow '${action.actionName}'. Use 'list my task flows' to see available flows.`,
                );
            }

            const result = await executeFlow(
                flow,
                action.parameters ?? {},
                context,
            );
            await store.recordUsage(action.actionName);
            return result;
        }
    }
}

// ── Flow execution ──────────────────────────────────────────────────────────
// Delegates to the dispatcher's processFlow() via dynamic import to avoid
// cyclic workspace dependencies.

async function executeFlow(
    flowDef: TaskFlowDefinition,
    flowParams: Record<string, unknown>,
    context: ActionContext<any>,
): Promise<ActionResult> {
    try {
        // Import processFlow from the dispatcher at runtime to avoid
        // cyclic package dependencies (taskflow -> dispatcher -> taskflow)
        const tsRoot = join(__dirname, "..", "..", "..", "..");
        const flowInterpreterPath = join(
            tsRoot,
            "packages",
            "dispatcher",
            "dispatcher",
            "dist",
            "execute",
            "flowInterpreter.js",
        );

        if (!existsSync(flowInterpreterPath)) {
            return createActionResultFromError(
                `Flow interpreter not found at ${flowInterpreterPath}. Ensure the dispatcher is built.`,
            );
        }

        const { processFlow } = await import(
            /* webpackIgnore: true */ "file://" +
                flowInterpreterPath.replace(/\\/g, "/")
        );

        // processFlow expects the FlowDefinition type from the dispatcher
        return await processFlow(flowDef, flowParams, context, 0);
    } catch (err) {
        return createActionResultFromError(
            `Flow execution failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

// ── Wildcard validation ─────────────────────────────────────────────────────

async function validateTaskFlowWildcardMatch(
    action: AppAction,
    _context: SessionContext,
): Promise<boolean> {
    // For executeTaskFlow with flowName=createTopSongsPlaylist, validate genre
    const params = (action as any).parameters;
    if (
        params?.flowName === "createTopSongsPlaylist" &&
        typeof params?.genre === "string"
    ) {
        return isKnownGenre(params.genre);
    }
    return true;
}

// ── Action completion ───────────────────────────────────────────────────────

async function getTaskFlowActionCompletion(
    _context: SessionContext,
    action: AppAction,
    propertyName: string,
): Promise<string[] | undefined> {
    const params = (action as any).parameters;
    if (
        params?.flowName === "createTopSongsPlaylist" &&
        propertyName === "parameters.genre"
    ) {
        return [...KNOWN_GENRES].sort();
    }
    return undefined;
}

// ── Instantiate ─────────────────────────────────────────────────────────────

export function instantiate(): AppAgent {
    let agentContext: TaskFlowAgentContext = {};

    return {
        async initializeAgentContext() {
            return agentContext;
        },

        async updateAgentContext(
            enable: boolean,
            sessionContext: SessionContext,
        ) {
            if (!enable) return;

            const instanceStorage = sessionContext.instanceStorage;
            if (!instanceStorage) {
                debug("No instance storage available, skipping store init");
                return;
            }

            const store = new TaskFlowStore(instanceStorage);
            await store.initialize();
            agentContext.store = store;
            _agentStore = store;

            await seedSampleFlows(store);
            debug(`Store initialized with ${store.listFlows().length} flow(s)`);
        },

        executeAction(action, context: ActionContext<TaskFlowAgentContext>) {
            return handleTaskFlowAction(
                action as {
                    actionName: string;
                    parameters?: Record<string, unknown>;
                },
                context,
            );
        },

        async getDynamicSchema(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<SchemaContent | undefined> {
            if (!agentContext.store) return undefined;
            return {
                format: "ts",
                content: agentContext.store.generateDynamicSchemaText(),
            };
        },

        async getDynamicGrammar(
            _context: SessionContext,
            _schemaName: string,
        ): Promise<GrammarContent | undefined> {
            if (!agentContext.store) return undefined;
            const text = agentContext.store.getDynamicGrammarText();
            if (!text) return undefined;
            return { format: "agr", content: text };
        },

        validateWildcardMatch: validateTaskFlowWildcardMatch,
        getActionCompletion: getTaskFlowActionCompletion,
    };
}
