// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Scaffolder: takes a workspace's discoveredActions.json and emits a runtime
// TypeAgent agent package that can replay each action via the helper.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SynthesizedAction } from "./synthesisLlmSchema.js";

export type ScaffoldOptions = {
    /** Source discoveredActions.json (typically <workspace>/discoveredActions.json). */
    discoveredActionsPath: string;
    /** Output package directory (typically `ts/packages/agents/<name>/`). */
    targetDir: string;
    /** camelCase integration name (e.g., "windowsClock"). */
    integrationName: string;
    /** Human-readable description for the agent manifest. */
    description?: string;
    /** Emoji shown next to the agent in the shell. */
    emoji?: string;
    /** AUMID (UWP) or absolute exePath for app auto-launch. */
    appLaunch: { aumid?: string; exePath?: string };
    /**
     * Substring to match against window titles when probing for an
     * already-running instance of the app (UWP apps can't be launched twice).
     * Defaults to the integrationName.
     */
    appTitleMatch?: string;
};

export function scaffoldUiAgent(opts: ScaffoldOptions): void {
    if (!existsSync(opts.discoveredActionsPath)) {
        throw new Error(
            `discoveredActions.json not found at ${opts.discoveredActionsPath}`,
        );
    }
    const discovered = JSON.parse(
        readFileSync(opts.discoveredActionsPath, "utf8"),
    ) as { actions: SynthesizedAction[] };
    if (!Array.isArray(discovered.actions) || discovered.actions.length === 0) {
        throw new Error("discoveredActions.json has no actions");
    }

    const name = opts.integrationName;
    const cap = capitalize(name);
    const description =
        opts.description ?? `${cap} agent — UI Automation playback.`;
    const emoji = opts.emoji ?? "⚙️";

    mkdirSync(path.join(opts.targetDir, "src"), { recursive: true });
    mkdirSync(path.join(opts.targetDir, "data"), { recursive: true });

    // Copy discoveredActions.json into data/.
    writeFileSync(
        path.join(opts.targetDir, "data", "discoveredActions.json"),
        JSON.stringify(discovered, null, 2),
    );

    // Schema (TS action union + per-action types).
    writeFileSync(
        path.join(opts.targetDir, "src", `${name}Schema.ts`),
        renderSchema(name, cap, discovered.actions),
    );

    // Manifest.
    writeFileSync(
        path.join(opts.targetDir, "src", `${name}Manifest.json`),
        renderManifest(name, cap, description, emoji),
    );

    // ActionHandler.
    const appTitleMatch = opts.appTitleMatch ?? name;
    writeFileSync(
        path.join(opts.targetDir, "src", `${name}ActionHandler.ts`),
        renderActionHandler(name, cap, opts.appLaunch, appTitleMatch),
    );

    // package.json + tsconfigs.
    writeFileSync(
        path.join(opts.targetDir, "package.json"),
        renderPackageJson(name),
    );
    writeFileSync(
        path.join(opts.targetDir, "tsconfig.json"),
        renderRootTsconfig(),
    );
    writeFileSync(
        path.join(opts.targetDir, "src", "tsconfig.json"),
        renderSrcTsconfig(),
    );
}

function renderSchema(
    name: string,
    cap: string,
    actions: SynthesizedAction[],
): string {
    const lines: string[] = [];
    lines.push("// Copyright (c) Microsoft Corporation.");
    lines.push("// Licensed under the MIT License.");
    lines.push("");
    lines.push(`export type ${cap}Action =`);
    for (let i = 0; i < actions.length; i++) {
        const last = i === actions.length - 1;
        lines.push(`    | ${actionTypeName(actions[i]!)}${last ? ";" : ""}`);
    }
    lines.push("");

    for (const a of actions) {
        // The action-schema-compiler doesn't accept /** ... */ blocks; use //.
        for (const dl of a.description.split("\n")) {
            lines.push(`// ${dl}`);
        }
        lines.push(`export type ${actionTypeName(a)} = {`);
        lines.push(`    actionName: "${a.actionName}";`);
        if (a.parameters.length === 0) {
            lines.push(`    parameters: {};`);
        } else {
            lines.push(`    parameters: {`);
            for (const p of a.parameters) {
                if (p.description) {
                    lines.push(
                        `        // ${p.description.replace(/\n/g, " ")}`,
                    );
                }
                lines.push(
                    `        ${p.name}${p.examples.length === 0 ? "?" : ""}: ${tsType(p)};`,
                );
            }
            lines.push(`    };`);
        }
        lines.push(`};`);
        lines.push("");
    }
    return lines.join("\n");
}

function actionTypeName(a: SynthesizedAction): string {
    return `${capitalize(a.actionName)}Action`;
}

function tsType(p: SynthesizedAction["parameters"][number]): string {
    if (p.type === "enum" && p.enumValues && p.enumValues.length > 0) {
        return p.enumValues.map((v) => JSON.stringify(v)).join(" | ");
    }
    switch (p.type) {
        case "string":
            return "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        default:
            return "string";
    }
}

function renderManifest(
    name: string,
    cap: string,
    description: string,
    emoji: string,
): string {
    return JSON.stringify(
        {
            emojiChar: emoji,
            description,
            schema: {
                description,
                originalSchemaFile: `./${name}Schema.ts`,
                schemaFile: `../dist/${name}Schema.pas.json`,
                schemaType: {
                    action: `${cap}Action`,
                },
            },
        },
        null,
        2,
    );
}

function renderActionHandler(
    name: string,
    cap: string,
    appLaunch: ScaffoldOptions["appLaunch"],
    appTitleMatch: string,
): string {
    const launchArg = appLaunch.aumid
        ? `{ aumid: ${JSON.stringify(appLaunch.aumid)} }`
        : `{ exePath: ${JSON.stringify(appLaunch.exePath ?? "")} }`;
    const titleMatchLit = JSON.stringify(appTitleMatch);
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    executePlayback,
    HelperClient,
    SynthesizedAction,
} from "onboarding-agent/uiCapture";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ${cap}Action } from "./${name}Schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_TITLE_MATCH = ${titleMatchLit};

type DiscoveredActionsFile = { actions: SynthesizedAction[] };

let cachedActions: DiscoveredActionsFile | null = null;
function loadDiscoveredActions(): DiscoveredActionsFile {
    if (cachedActions) return cachedActions;
    // From dist/${name}ActionHandler.js, the data dir is two levels up + /data/.
    const file = path.resolve(
        __dirname,
        "..",
        "data",
        "discoveredActions.json",
    );
    cachedActions = JSON.parse(
        readFileSync(file, "utf8"),
    ) as DiscoveredActionsFile;
    return cachedActions;
}

type AgentState = {
    client: HelperClient | null;
    appPid: number | null;
    appMainWindow: string | null;
};

async function ensureClient(state: AgentState): Promise<HelperClient> {
    if (!state.client) {
        state.client = await HelperClient.start();
    }
    return state.client;
}

async function ensureAppRunning(state: AgentState): Promise<void> {
    const client = await ensureClient(state);
    if (state.appPid !== null) {
        // Verify still running.
        const list = await client.appList();
        const found = list.find((w) => w.pid === state.appPid);
        if (found) {
            state.appMainWindow = found.mainWindow;
            return;
        }
        state.appPid = null;
        state.appMainWindow = null;
    }
    // The app may already be running from a prior invocation (each CLI / agent
    // call gets a fresh AgentState). Probe app.list for an existing window
    // matching APP_TITLE_MATCH before launching — UWP apps can't be launched
    // twice and FlaUI returns "no main window" when they are.
    const existing = await client.appList();
    const match = existing.find((w) =>
        w.title.toLowerCase().includes(APP_TITLE_MATCH.toLowerCase()),
    );
    if (match) {
        state.appPid = match.pid;
        state.appMainWindow = match.mainWindow;
        await client.eventsIdle({ debounceMs: 600, maxWaitMs: 3000 });
        return;
    }
    const launch = await client.appLaunch(${launchArg});
    state.appPid = launch.pid;
    state.appMainWindow = launch.mainWindow;
    await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
}

export function instantiate(): AppAgent {
    return {
        async initializeAgentContext() {
            return {
                client: null,
                appPid: null,
                appMainWindow: null,
            } as AgentState;
        },
        async updateAgentContext(
            _enable: boolean,
            _context: SessionContext<AgentState>,
            _schemaName: string,
        ) {
            // No per-session work needed; the helper is launched lazily.
        },
        async executeAction(
            action: TypeAgentAction<${cap}Action>,
            context: ActionContext<AgentState>,
        ) {
            const state = context.sessionContext.agentContext;
            const def = loadDiscoveredActions().actions.find(
                (a) => a.actionName === action.actionName,
            );
            if (!def) {
                return createActionResultFromError(
                    \`No discovered action named '\${action.actionName}'\`,
                );
            }
            try {
                await ensureAppRunning(state);
                const client = await ensureClient(state);
                const result = await executePlayback(
                    def,
                    (action.parameters ?? {}) as Record<
                        string,
                        string | number | boolean
                    >,
                    {
                        client,
                        defaultIdleDebounceMs: 700,
                        defaultIdleMaxWaitMs: 4000,
                    },
                );
                if (!result.success) {
                    const failed = result.steps[result.failedAtStep ?? 0];
                    return createActionResultFromError(
                        \`Playback failed at step \${(result.failedAtStep ?? 0) + 1}: \${failed?.errorMessage ?? "unknown"}\`,
                    );
                }
                return createActionResultFromTextDisplay(
                    \`Done: \${action.actionName} (\${result.steps.length} steps)\`,
                );
            } catch (e) {
                return createActionResultFromError(
                    e instanceof Error ? e.message : String(e),
                );
            }
        },
        async closeAgentContext(context: SessionContext<AgentState>) {
            const state = context.agentContext;
            if (state.client) {
                await state.client.dispose();
                state.client = null;
            }
        },
    };
}
`;
}

function renderPackageJson(name: string): string {
    return JSON.stringify(
        {
            name: `${name}-agent`,
            version: "0.0.1",
            private: true,
            description: `${name} TypeAgent — UI Automation playback`,
            type: "module",
            exports: {
                "./agent/manifest": `./src/${name}Manifest.json`,
                "./agent/handlers": `./dist/${name}ActionHandler.js`,
            },
            scripts: {
                "asc:main": `asc -i ./src/${name}Schema.ts -o ./dist/${name}Schema.pas.json -t ${capitalize(name)}Action`,
                build: `concurrently npm:tsc npm:asc:*`,
                clean: "rimraf --glob dist *.tsbuildinfo *.done.build.log",
                tsc: "tsc -b",
            },
            dependencies: {
                "@typeagent/agent-sdk": "workspace:*",
                "onboarding-agent": "workspace:*",
            },
            devDependencies: {
                "@typeagent/action-schema-compiler": "workspace:*",
                concurrently: "^9.1.2",
                rimraf: "^6.0.1",
                typescript: "~5.4.5",
            },
            engines: {
                node: ">=20",
            },
        },
        null,
        2,
    );
}

function renderRootTsconfig(): string {
    return JSON.stringify(
        {
            extends: "../../../tsconfig.base.json",
            compilerOptions: { composite: true },
            include: [],
            references: [{ path: "./src" }],
        },
        null,
        2,
    );
}

function renderSrcTsconfig(): string {
    return JSON.stringify(
        {
            extends: "../../../../tsconfig.base.json",
            compilerOptions: {
                composite: true,
                rootDir: ".",
                outDir: "../dist",
            },
            include: ["./**/*"],
        },
        null,
        2,
    );
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
