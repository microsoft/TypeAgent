// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 5 — Scaffolder handler.
// Stamps out a complete TypeAgent agent package from approved artifacts.
// Templates cover manifest, handler, schema, grammar, package.json, tsconfigs.

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { AgentPattern, ScaffolderActions } from "./scaffolderSchema.js";
import {
    loadState,
    updatePhase,
    writeArtifact,
    readArtifact,
    readArtifactJson,
} from "../lib/workspace.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Sub-schema group type matching discovery/sub-schema-groups.json
type SubSchemaGroup = {
    name: string;
    description: string;
    actions: string[];
};

type SubSchemaSuggestion = {
    recommended: boolean;
    groups: SubSchemaGroup[];
};

// Default output root within the TypeAgent repo
const AGENTS_DIR = path.resolve(
    fileURLToPath(import.meta.url),
    "../../../../../../packages/agents",
);

export async function executeScaffolderAction(
    action: TypeAgentAction<ScaffolderActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "scaffoldAgent":
            return handleScaffoldAgent(
                action.parameters.integrationName,
                action.parameters.pattern,
                action.parameters.outputDir,
            );
        case "scaffoldPlugin":
            return handleScaffoldPlugin(
                action.parameters.integrationName,
                action.parameters.template,
                action.parameters.outputDir,
            );
        case "listTemplates":
            return handleListTemplates();
        case "listPatterns":
            return handleListPatterns();
    }
}

async function handleScaffoldAgent(
    integrationName: string,
    pattern: AgentPattern = "schema-grammar",
    outputDir?: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.grammarGen.status !== "approved") {
        return {
            error: `Grammar phase must be approved first. Run approveGrammar.`,
        };
    }

    const schemaTs = await readArtifact(
        integrationName,
        "schemaGen",
        "schema.ts",
    );
    const grammarAgr = await readArtifact(
        integrationName,
        "grammarGen",
        "schema.agr",
    );
    if (!schemaTs || !grammarAgr) {
        return {
            error: `Missing schema or grammar artifacts for "${integrationName}".`,
        };
    }

    await updatePhase(integrationName, "scaffolder", { status: "in-progress" });

    // Determine package name and Pascal-case type name
    const packageName = `${integrationName}-agent`;
    const pascalName = toPascalCase(integrationName);
    const targetDir = outputDir ?? path.join(AGENTS_DIR, integrationName);
    const srcDir = path.join(targetDir, "src");

    await fs.mkdir(srcDir, { recursive: true });

    // Check if sub-schema groups exist from the discovery phase
    const subSchemaSuggestion = await readArtifactJson<SubSchemaSuggestion>(
        integrationName,
        "discovery",
        "sub-schema-groups.json",
    );
    const subGroups =
        subSchemaSuggestion?.recommended &&
        subSchemaSuggestion.groups.length > 0
            ? subSchemaSuggestion.groups
            : undefined;

    // Write core schema and grammar
    await writeFile(path.join(srcDir, `${integrationName}Schema.ts`), schemaTs);
    await writeFile(
        path.join(srcDir, `${integrationName}Schema.agr`),
        grammarAgr.replace(
            /from "\.\/schema\.ts"/g,
            `from "./${integrationName}Schema.ts"`,
        ),
    );

    // Track all files created for the output summary
    const files: string[] = [
        `src/${integrationName}Schema.ts`,
        `src/${integrationName}Schema.agr`,
    ];

    // If sub-schema groups exist, generate per-group schema and grammar files
    if (subGroups) {
        const actionsDir = path.join(srcDir, "actions");
        await fs.mkdir(actionsDir, { recursive: true });

        for (const group of subGroups) {
            const groupPascal = toPascalCase(group.name);

            // Generate a filtered schema file for this group
            const groupSchemaContent = buildSubSchemaTs(
                integrationName,
                pascalName,
                group,
                groupPascal,
                schemaTs,
            );
            await writeFile(
                path.join(actionsDir, `${group.name}ActionsSchema.ts`),
                groupSchemaContent,
            );
            files.push(`src/actions/${group.name}ActionsSchema.ts`);

            // Generate a filtered grammar file for this group
            const groupGrammarContent = buildSubSchemaAgr(
                integrationName,
                group,
                groupPascal,
                grammarAgr,
            );
            await writeFile(
                path.join(actionsDir, `${group.name}ActionsSchema.agr`),
                groupGrammarContent,
            );
            files.push(`src/actions/${group.name}ActionsSchema.agr`);
        }
    }

    // Stamp out manifest (with sub-action manifests if groups exist)
    await writeFile(
        path.join(srcDir, `${integrationName}Manifest.json`),
        JSON.stringify(
            buildManifest(
                integrationName,
                pascalName,
                state.config.description ?? "",
                pattern,
                subGroups,
            ),
            null,
            2,
        ),
    );
    files.push(`src/${integrationName}Manifest.json`);

    // Stamp out handler
    await writeFile(
        path.join(srcDir, `${integrationName}ActionHandler.ts`),
        buildHandler(integrationName, pascalName, pattern),
    );
    files.push(`src/${integrationName}ActionHandler.ts`);

    // Stamp out package.json (with sub-schema build scripts if groups exist)
    const subSchemaNames = subGroups?.map((g) => g.name);
    await writeFile(
        path.join(targetDir, "package.json"),
        JSON.stringify(
            buildPackageJson(
                integrationName,
                packageName,
                pascalName,
                pattern,
                subSchemaNames,
            ),
            null,
            2,
        ),
    );
    files.push(`package.json`);

    // Stamp out tsconfigs
    await writeFile(
        path.join(targetDir, "tsconfig.json"),
        JSON.stringify(ROOT_TSCONFIG, null, 2),
    );
    await writeFile(
        path.join(srcDir, "tsconfig.json"),
        JSON.stringify(SRC_TSCONFIG, null, 2),
    );
    files.push(`tsconfig.json`, `src/tsconfig.json`);

    // Also copy to workspace scaffolder dir for reference
    await writeArtifact(
        integrationName,
        "scaffolder",
        "scaffolded-to.txt",
        targetDir,
    );

    await updatePhase(integrationName, "scaffolder", { status: "approved" });

    let subSchemaNote = "";
    if (subGroups) {
        subSchemaNote =
            `\n\n**Sub-schemas generated:** ${subGroups.length} groups\n` +
            subGroups
                .map(
                    (g) =>
                        `- **${g.name}** (${g.actions.length} actions): ${g.description}`,
                )
                .join("\n");
    }

    return createActionResultFromMarkdownDisplay(
        `## Agent scaffolded: ${integrationName}\n\n` +
            `**Output directory:** \`${targetDir}\`\n\n` +
            `**Files created:**\n` +
            files.map((f) => `- \`${f}\``).join("\n") +
            subSchemaNote +
            `\n\n**Next step:** Phase 6 — use \`generateTests\` and \`runTests\` to validate.`,
    );
}

// Build a sub-schema TypeScript file that re-exports only the actions belonging
// to this group. It imports from the main schema and creates a union type.
function buildSubSchemaTs(
    _integrationName: string,
    _pascalName: string,
    group: SubSchemaGroup,
    groupPascal: string,
    fullSchemaTs: string,
): string {
    // Extract individual action type names from the full schema that match the
    // group's action list. TypeAgent schema files define types like:
    //   export type BoldAction = { actionName: "bold"; parameters: {...} };
    // and then a union:
    //   export type FooActions = BoldAction | ItalicAction | ...;
    //
    // We emit a new file that re-exports only the relevant action types and
    // creates a new union type for this sub-schema group.

    const actionTypeNames = group.actions.map(
        (a) => `${a.charAt(0).toUpperCase()}${a.slice(1)}Action`,
    );

    // Find action type blocks in the full schema that belong to this group
    const actionBlocks: string[] = [];
    for (const actionName of group.actions) {
        // Match "export type XxxAction = ..." blocks
        const typeName = `${actionName.charAt(0).toUpperCase()}${actionName.slice(1)}Action`;
        const regex = new RegExp(
            `(export\\s+type\\s+${typeName}\\s*=\\s*\\{[\\s\\S]*?\\};)`,
        );
        const match = fullSchemaTs.match(regex);
        if (match) {
            actionBlocks.push(match[1]);
        }
    }

    const unionType = `export type ${groupPascal}Actions =\n    | ${actionTypeNames.join("\n    | ")};`;

    return `// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT License.\n\n// Sub-schema: ${group.name} — ${group.description}\n// Auto-generated by the onboarding scaffolder.\n\n${actionBlocks.join("\n\n")}\n\n${unionType}\n`;
}

// Build a sub-schema grammar file that includes only the rules relevant to
// this group's actions.
function buildSubSchemaAgr(
    integrationName: string,
    group: SubSchemaGroup,
    groupPascal: string,
    fullGrammarAgr: string,
): string {
    // Grammar files contain rule blocks that typically start with the action name.
    // We extract lines that reference actions in this group and build a new .agr.
    const lines = fullGrammarAgr.split("\n");
    const relevantLines: string[] = [];
    let inRelevantBlock = false;
    const actionSet = new Set(group.actions);

    for (const line of lines) {
        // Check if line starts a new action rule (e.g., "actionName:" or
        // a line that contains an action name as an identifier)
        const ruleMatch = line.match(/^(\w+)\s*:/);
        if (ruleMatch) {
            inRelevantBlock = actionSet.has(ruleMatch[1]);
        }

        // Also include header/import lines (lines starting with '#' or 'from')
        const isHeader =
            line.startsWith("#") ||
            line.startsWith("from ") ||
            line.startsWith("//") ||
            line.trim() === "";

        if (inRelevantBlock || isHeader) {
            relevantLines.push(line);
        }
    }

    // Fix the schema file reference to point to the sub-schema
    let content = relevantLines.join("\n");
    content = content.replace(
        /from "\.\/[^"]*Schema\.ts"/g,
        `from "./actions/${group.name}ActionsSchema.ts"`,
    );
    // Update the schema type reference
    content = content.replace(
        /from "\.\/[^"]*"/g,
        `from "./actions/${group.name}ActionsSchema.ts"`,
    );

    return `// Sub-schema grammar: ${group.name} — ${group.description}\n// Auto-generated by the onboarding scaffolder.\n\n${content}\n`;
}

async function handleScaffoldPlugin(
    integrationName: string,
    template: string,
    outputDir?: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };

    const templateInfo = PLUGIN_TEMPLATES[template];
    if (!templateInfo) {
        return {
            error: `Unknown template "${template}". Use listTemplates to see available templates.`,
        };
    }

    const targetDir =
        outputDir ??
        path.join(AGENTS_DIR, integrationName, templateInfo.defaultSubdir);
    await fs.mkdir(targetDir, { recursive: true });

    for (const [filename, content] of Object.entries(
        templateInfo.files(integrationName),
    )) {
        await writeFile(path.join(targetDir, filename), content);
    }

    return createActionResultFromMarkdownDisplay(
        `## Plugin scaffolded: ${integrationName} (${template})\n\n` +
            `**Output:** \`${targetDir}\`\n\n` +
            `**Files created:**\n` +
            Object.keys(templateInfo.files(integrationName))
                .map((f) => `- \`${f}\``)
                .join("\n") +
            `\n\n${templateInfo.nextSteps}`,
    );
}

async function handleListTemplates(): Promise<ActionResult> {
    const lines = [
        `## Available scaffolding templates`,
        ``,
        `### Agent templates`,
        `- **default** — TypeAgent agent package (manifest, handler, schema, grammar)`,
        ``,
        `### Plugin templates (use with \`scaffoldPlugin\`)`,
        ...Object.entries(PLUGIN_TEMPLATES).map(
            ([key, t]) => `- **${key}** — ${t.description}`,
        ),
    ];
    return createActionResultFromMarkdownDisplay(lines.join("\n"));
}

// ─── Template helpers ────────────────────────────────────────────────────────

function toPascalCase(str: string): string {
    return str
        .split(/[-_\s]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
}

function buildManifest(
    name: string,
    pascalName: string,
    description: string,
    pattern: AgentPattern = "schema-grammar",
    subGroups?: SubSchemaGroup[],
) {
    const manifest: Record<string, unknown> = {
        emojiChar: "🔌",
        description: description || `Agent for ${name}`,
        defaultEnabled: false,
        schema: {
            description: `${pascalName} agent actions`,
            originalSchemaFile: `./${name}Schema.ts`,
            schemaFile: `../dist/${name}Schema.pas.json`,
            grammarFile: `../dist/${name}Schema.ag.json`,
            schemaType: `${pascalName}Actions`,
        },
    };

    // Pattern-specific manifest flags
    if (pattern === "llm-streaming") {
        manifest.injected = true;
        manifest.cached = false;
        manifest.streamingActions = ["generateResponse"];
    } else if (pattern === "view-ui") {
        manifest.localView = true;
    }

    if (subGroups && subGroups.length > 0) {
        const subActionManifests: Record<string, unknown> = {};
        for (const group of subGroups) {
            const groupPascal = toPascalCase(group.name);
            subActionManifests[group.name] = {
                schema: {
                    description: group.description,
                    originalSchemaFile: `./actions/${group.name}ActionsSchema.ts`,
                    schemaFile: `../dist/actions/${group.name}ActionsSchema.pas.json`,
                    grammarFile: `../dist/actions/${group.name}ActionsSchema.ag.json`,
                    schemaType: `${groupPascal}Actions`,
                },
            };
        }
        manifest.subActionManifests = subActionManifests;
    }

    return manifest;
}

function buildHandler(
    name: string,
    pascalName: string,
    pattern: AgentPattern = "schema-grammar",
): string {
    switch (pattern) {
        case "external-api":
            return buildExternalApiHandler(name, pascalName);
        case "llm-streaming":
            return buildLlmStreamingHandler(name, pascalName);
        case "sub-agent-orchestrator":
            return buildSubAgentOrchestratorHandler(name, pascalName);
        case "websocket-bridge":
            return buildWebSocketBridgeHandler(name, pascalName);
        case "state-machine":
            return buildStateMachineHandler(name, pascalName);
        case "native-platform":
            return buildNativePlatformHandler(name, pascalName);
        case "view-ui":
            return buildViewUiHandler(name, pascalName);
        case "command-handler":
            return buildCommandHandlerTemplate(name, pascalName);
        default:
            return buildSchemaGrammarHandler(name, pascalName);
    }
}

function buildSchemaGrammarHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    // TODO: implement action handlers
    return createActionResultFromTextDisplay(
        \`Executing \${action.actionName} — not yet implemented.\`,
    );
}
`;
}

function buildPackageJson(
    name: string,
    packageName: string,
    pascalName: string,
    pattern: AgentPattern = "schema-grammar",
    subSchemaNames?: string[],
) {
    const scripts: Record<string, string> = {
        asc: `asc -i ./src/${name}Schema.ts -o ./dist/${name}Schema.pas.json -t ${pascalName}Actions`,
        agc: `agc -i ./src/${name}Schema.agr -o ./dist/${name}Schema.ag.json`,
        tsc: "tsc -b",
        clean: "rimraf --glob dist *.tsbuildinfo *.done.build.log",
    };

    // Generate asc:<group> and agc:<group> scripts for each sub-schema
    const buildTargets = ["npm:tsc", "npm:asc", "npm:agc"];
    if (subSchemaNames && subSchemaNames.length > 0) {
        for (const groupName of subSchemaNames) {
            const groupPascal = toPascalCase(groupName);
            scripts[`asc:${groupName}`] =
                `asc -i ./src/actions/${groupName}ActionsSchema.ts -o ./dist/actions/${groupName}ActionsSchema.pas.json -t ${groupPascal}Actions`;
            scripts[`agc:${groupName}`] =
                `agc -i ./src/actions/${groupName}ActionsSchema.agr -o ./dist/actions/${groupName}ActionsSchema.ag.json`;
            buildTargets.push(`npm:asc:${groupName}`, `npm:agc:${groupName}`);
        }
    }

    scripts.build = `concurrently ${buildTargets.join(" ")}`;

    return {
        name: packageName,
        version: "0.0.1",
        private: true,
        description: `TypeAgent agent for ${name}`,
        license: "MIT",
        author: "Microsoft",
        type: "module",
        exports: {
            "./agent/manifest": `./src/${name}Manifest.json`,
            "./agent/handlers": `./dist/${name}ActionHandler.js`,
        },
        scripts,
        dependencies: {
            "@typeagent/agent-sdk": "workspace:*",
            ...(pattern === "llm-streaming"
                ? { aiclient: "workspace:*", typechat: "workspace:*" }
                : pattern === "external-api"
                  ? { aiclient: "workspace:*" }
                  : pattern === "websocket-bridge"
                    ? { ws: "^8.18.0" }
                    : {}),
        },
        devDependencies: {
            "@typeagent/action-schema-compiler": "workspace:*",
            "action-grammar-compiler": "workspace:*",
            concurrently: "^9.1.2",
            rimraf: "^6.0.1",
            typescript: "~5.4.5",
        },
    };
}

const ROOT_TSCONFIG = {
    extends: "../../../tsconfig.base.json",
    compilerOptions: { composite: true },
    include: [],
    references: [{ path: "./src" }],
    "ts-node": { esm: true },
};

const SRC_TSCONFIG = {
    extends: "../../../../tsconfig.base.json",
    compilerOptions: { composite: true, rootDir: ".", outDir: "../dist" },
    include: ["./**/*"],
    "ts-node": { esm: true },
};

const PLUGIN_TEMPLATES: Record<
    string,
    {
        description: string;
        defaultSubdir: string;
        nextSteps: string;
        files: (name: string) => Record<string, string>;
    }
> = {
    "rest-client": {
        description: "Simple REST API client bridge",
        defaultSubdir: "src",
        nextSteps:
            "Implement `executeCommand(action, params)` to call your REST API endpoints.",
        files: (name) => ({
            [`${name}Bridge.ts`]: buildRestClientTemplate(name),
        }),
    },
    "websocket-bridge": {
        description:
            "WebSocket bridge (bidirectional RPC, used by Excel, VS Code agents)",
        defaultSubdir: "src",
        nextSteps:
            "Start the bridge with `new WebSocketBridge(port).start()` and connect your plugin.",
        files: (name) => ({
            [`${name}Bridge.ts`]: buildWebSocketBridgeTemplate(name),
        }),
    },
    "office-addin": {
        description: "Office.js task pane add-in skeleton",
        defaultSubdir: "addin",
        nextSteps:
            "Load the add-in in Excel/Word/Outlook and configure the manifest URL.",
        files: (name) => ({
            "taskpane.html": buildOfficeAddinHtml(name),
            "taskpane.ts": buildOfficeAddinTs(name),
            "manifest.xml": buildOfficeManifestXml(name),
        }),
    },
};

function buildRestClientTemplate(name: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// REST client bridge for ${name}.
// Calls the target API and returns results to the TypeAgent handler.

export class ${toPascalCase(name)}Bridge {
    constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}

    async executeCommand(actionName: string, parameters: Record<string, unknown>): Promise<unknown> {
        // TODO: map actionName to HTTP endpoint and method
        throw new Error(\`Not implemented: \${actionName}\`);
    }

    private get headers(): Record<string, string> {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (this.apiKey) h["Authorization"] = \`Bearer \${this.apiKey}\`;
        return h;
    }
}
`;
}

function buildWebSocketBridgeTemplate(name: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// WebSocket bridge for ${name}.
// Manages a WebSocket connection to the host application plugin.
// Pattern matches the Excel/VS Code agent bridge implementations.

import { WebSocketServer, WebSocket } from "ws";

type BridgeCommand = {
    id: string;
    actionName: string;
    parameters: Record<string, unknown>;
};

type BridgeResponse = {
    id: string;
    success: boolean;
    result?: unknown;
    error?: string;
};

export class ${toPascalCase(name)}Bridge {
    private wss: WebSocketServer | undefined;
    private client: WebSocket | undefined;
    private pending = new Map<string, (response: BridgeResponse) => void>();

    constructor(private readonly port: number) {}

    start(): void {
        this.wss = new WebSocketServer({ port: this.port });
        this.wss.on("connection", (ws) => {
            this.client = ws;
            ws.on("message", (data) => {
                const response = JSON.parse(data.toString()) as BridgeResponse;
                this.pending.get(response.id)?.(response);
                this.pending.delete(response.id);
            });
        });
    }

    async sendCommand(actionName: string, parameters: Record<string, unknown>): Promise<unknown> {
        if (!this.client) throw new Error("No client connected");
        const id = \`cmd-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
        return new Promise((resolve, reject) => {
            this.pending.set(id, (res) => {
                if (res.success) resolve(res.result);
                else reject(new Error(res.error));
            });
            this.client!.send(JSON.stringify({ id, actionName, parameters } satisfies BridgeCommand));
        });
    }
}
`;
}

function buildOfficeAddinHtml(name: string): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <title>${toPascalCase(name)} TypeAgent Add-in</title>
    <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
    <script src="taskpane.js" type="module"></script>
</head>
<body>
    <h2>${toPascalCase(name)} TypeAgent</h2>
    <div id="status">Connecting...</div>
</body>
</html>
`;
}

function buildOfficeAddinTs(name: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Office.js task pane add-in for ${name} TypeAgent integration.
// Connects to the TypeAgent bridge via WebSocket and forwards commands
// to the Office.js API.

const BRIDGE_PORT = 5678;

Office.onReady(async () => {
    document.getElementById("status")!.textContent = "Connecting to TypeAgent...";
    const ws = new WebSocket(\`ws://localhost:\${BRIDGE_PORT}\`);

    ws.onopen = () => {
        document.getElementById("status")!.textContent = "Connected";
        ws.send(JSON.stringify({ type: "hello", addinName: "${name}" }));
    };

    ws.onmessage = async (event) => {
        const command = JSON.parse(event.data);
        try {
            const result = await executeCommand(command.actionName, command.parameters);
            ws.send(JSON.stringify({ id: command.id, success: true, result }));
        } catch (err: any) {
            ws.send(JSON.stringify({ id: command.id, success: false, error: err?.message ?? String(err) }));
        }
    };
});

async function executeCommand(actionName: string, parameters: Record<string, unknown>): Promise<unknown> {
    // TODO: map actionName to Office.js API calls
    throw new Error(\`Not implemented: \${actionName}\`);
}
`;
}

function buildOfficeManifestXml(name: string): string {
    const pascal = toPascalCase(name);
    return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xsi:type="TaskPaneApp">
  <Id><!-- Replace with a new GUID --></Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Microsoft</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="${pascal} TypeAgent" />
  <Description DefaultValue="${pascal} integration for TypeAgent" />
  <Hosts>
    <Host Name="Workbook" />
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://localhost:3000/taskpane.html" />
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
</OfficeApp>
`;
}

async function writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
}

// ─── Pattern listing ─────────────────────────────────────────────────────────

async function handleListPatterns(): Promise<ActionResult> {
    const lines = [
        `## Agent architectural patterns`,
        ``,
        `Pass \`pattern\` to \`scaffoldAgent\` to generate pattern-appropriate boilerplate.`,
        ``,
        `| Pattern | When to use | Examples |`,
        `|---------|-------------|----------|`,
        `| \`schema-grammar\` | Standard: bounded set of typed actions (default) | weather, photo, list |`,
        `| \`external-api\` | REST/OAuth cloud API (MS Graph, Spotify, GitHub…) | calendar, email, player |`,
        `| \`llm-streaming\` | Agent calls an LLM and streams partial results | chat, greeting |`,
        `| \`sub-agent-orchestrator\` | API surface too large for one schema; split into groups | desktop, code, browser |`,
        `| \`websocket-bridge\` | Automate an app via a host-side plugin over WebSocket | browser, code |`,
        `| \`state-machine\` | Multi-phase workflow with approval gates and disk persistence | onboarding, scriptflow |`,
        `| \`native-platform\` | OS/device APIs via child_process or SDK; no cloud | androidMobile, playerLocal |`,
        `| \`view-ui\` | Rich interactive UI rendered in a local web view | turtle, montage, markdown |`,
        `| \`command-handler\` | Simple settings-style agent; direct dispatch, no schema | settings, test |`,
    ];
    return createActionResultFromMarkdownDisplay(lines.join("\n"));
}

// ─── Pattern-specific handler builders ───────────────────────────────────────

function buildExternalApiHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: external-api — REST/OAuth cloud API bridge.
// Implement ${pascalName}Client with your API's authentication and endpoints.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";

// ---- API client --------------------------------------------------------

class ${pascalName}Client {
    private token: string | undefined;

    /** Authenticate and store the access token. */
    async authenticate(): Promise<void> {
        // TODO: implement OAuth flow or API key loading.
        // Store token in: ~/.typeagent/profiles/<profile>/${name}/token.json
        throw new Error("authenticate() not yet implemented");
    }

    async callApi(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
        if (!this.token) await this.authenticate();
        // TODO: implement HTTP call using this.token
        throw new Error(\`callApi(\${endpoint}) not yet implemented\`);
    }
}

// ---- Agent lifecycle ---------------------------------------------------

type Context = { client: ${pascalName}Client };

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<Context> {
    return { client: new ${pascalName}Client() };
}

async function updateAgentContext(
    enable: boolean,
    _context: ActionContext<Context>,
): Promise<void> {
    // Optionally authenticate eagerly when the agent is enabled.
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    context: ActionContext<Context>,
): Promise<ActionResult> {
    const { client } = context.agentContext;
    // TODO: map each action to a client.callApi() call.
    return createActionResultFromTextDisplay(
        \`Executing \${action.actionName} — not yet implemented.\`,
    );
}
`;
}

function buildLlmStreamingHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: llm-streaming — LLM-injected agent with streaming responses.
// Runs inside the dispatcher process (injected: true in manifest).
// Uses aiclient + typechat; streams partial results via streamingActionContext.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "generateResponse": {
            // TODO: call your LLM and stream chunks via:
            //   context.streamingActionContext?.appendDisplay(chunk)
            return createActionResultFromMarkdownDisplay(
                "Streaming response not yet implemented.",
            );
        }
        default:
            return createActionResultFromMarkdownDisplay(
                \`Unknown action: \${(action as any).actionName}\`,
            );
    }
}
`;
}

function buildSubAgentOrchestratorHandler(
    name: string,
    pascalName: string,
): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: sub-agent-orchestrator — root agent routing to N typed sub-schemas.
// Add one executeXxxAction() per sub-schema group defined in subActionManifests.
// The root executeAction routes by action name (each group owns disjoint names).

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    // TODO: route to sub-schema handlers, e.g.:
    // if (isGroupOneAction(action)) return executeGroupOneAction(action, context);
    // if (isGroupTwoAction(action)) return executeGroupTwoAction(action, context);
    return createActionResultFromTextDisplay(
        \`Executing \${action.actionName} — not yet implemented.\`,
    );
}

// ---- Sub-schema handlers (one per subActionManifests group) ------------

// async function executeGroupOneAction(
//     action: TypeAgentAction<GroupOneActions>,
//     context: ActionContext<unknown>,
// ): Promise<ActionResult> { ... }
`;
}

function buildWebSocketBridgeHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: websocket-bridge — bidirectional RPC to a host-side plugin.
// The agent owns a WebSocketServer; the host plugin connects as the client.
// Commands flow TypeAgent → WebSocket → plugin → response.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { WebSocketServer, WebSocket } from "ws";
import { ${pascalName}Actions } from "./${name}Schema.js";

const BRIDGE_PORT = 5678; // TODO: choose an unused port

// ---- WebSocket bridge --------------------------------------------------

type BridgeRequest = { id: string; actionName: string; parameters: unknown };
type BridgeResponse = { id: string; success: boolean; result?: unknown; error?: string };

class ${pascalName}Bridge {
    private wss: WebSocketServer | undefined;
    private client: WebSocket | undefined;
    private pending = new Map<string, (r: BridgeResponse) => void>();

    start(): void {
        this.wss = new WebSocketServer({ port: BRIDGE_PORT });
        this.wss.on("connection", (ws) => {
            this.client = ws;
            ws.on("message", (data) => {
                const response = JSON.parse(data.toString()) as BridgeResponse;
                this.pending.get(response.id)?.(response);
                this.pending.delete(response.id);
            });
            ws.on("close", () => { this.client = undefined; });
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => this.wss?.close(() => resolve()));
    }

    async send(actionName: string, parameters: unknown): Promise<unknown> {
        if (!this.client) {
            throw new Error("No host plugin connected on port " + BRIDGE_PORT);
        }
        const id = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
        return new Promise((resolve, reject) => {
            this.pending.set(id, (res) =>
                res.success ? resolve(res.result) : reject(new Error(res.error)),
            );
            this.client!.send(
                JSON.stringify({ id, actionName, parameters } satisfies BridgeRequest),
            );
        });
    }

    get connected(): boolean { return this.client !== undefined; }
}

// ---- Agent lifecycle ---------------------------------------------------

type Context = { bridge: ${pascalName}Bridge };

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        closeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<Context> {
    const bridge = new ${pascalName}Bridge();
    bridge.start();
    return { bridge };
}

async function updateAgentContext(
    _enable: boolean,
    _context: ActionContext<Context>,
): Promise<void> {}

async function closeAgentContext(context: ActionContext<Context>): Promise<void> {
    await context.agentContext.bridge.stop();
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    context: ActionContext<Context>,
): Promise<ActionResult> {
    const { bridge } = context.agentContext;
    if (!bridge.connected) {
        return {
            error: \`Host plugin not connected. Make sure the ${name} plugin is running on port \${BRIDGE_PORT}.\`,
        };
    }
    try {
        const result = await bridge.send(action.actionName, action.parameters);
        return createActionResultFromTextDisplay(JSON.stringify(result, null, 2));
    } catch (err: any) {
        return { error: err?.message ?? String(err) };
    }
}
`;
}

function buildStateMachineHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: state-machine — multi-phase disk-persisted workflow.
// State is stored in ~/.typeagent/${name}/<workflowId>/state.json.
// Each phase must be approved before the next begins.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

const STATE_ROOT = path.join(os.homedir(), ".typeagent", "${name}");

// ---- State types -------------------------------------------------------

type PhaseStatus = "pending" | "in-progress" | "approved";

type WorkflowState = {
    workflowId: string;
    currentPhase: string;
    phases: Record<string, { status: PhaseStatus; updatedAt: string }>;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

// ---- State I/O ---------------------------------------------------------

async function loadState(workflowId: string): Promise<WorkflowState | undefined> {
    const statePath = path.join(STATE_ROOT, workflowId, "state.json");
    try {
        return JSON.parse(await fs.readFile(statePath, "utf-8")) as WorkflowState;
    } catch {
        return undefined;
    }
}

async function saveState(state: WorkflowState): Promise<void> {
    const stateDir = path.join(STATE_ROOT, state.workflowId);
    await fs.mkdir(stateDir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(
        path.join(stateDir, "state.json"),
        JSON.stringify(state, null, 2),
        "utf-8",
    );
}

// ---- Agent lifecycle ---------------------------------------------------

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    await fs.mkdir(STATE_ROOT, { recursive: true });
    return {};
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    // TODO: map actions to phase handlers, e.g.:
    // case "startWorkflow":  return handleStart(action.parameters.workflowId);
    // case "runPhaseOne":    return handlePhaseOne(action.parameters.workflowId);
    // case "approvePhase":   return handleApprove(action.parameters.workflowId, action.parameters.phase);
    // case "getStatus":      return handleStatus(action.parameters.workflowId);
    return createActionResultFromMarkdownDisplay(
        \`Executing \${action.actionName} — not yet implemented.\`,
    );
}
`;
}

function buildNativePlatformHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: native-platform — OS/device APIs via child_process or SDK.
// No cloud dependency. Handle platform differences in executeCommand().

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { exec } from "child_process";
import { promisify } from "util";
import { ${pascalName}Actions } from "./${name}Schema.js";

const execAsync = promisify(exec);
const platform = process.platform; // "win32" | "darwin" | "linux"

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    try {
        const output = await executeCommand(
            action.actionName,
            action.parameters as Record<string, unknown>,
        );
        return createActionResultFromTextDisplay(output ?? "Done.");
    } catch (err: any) {
        return { error: err?.message ?? String(err) };
    }
}

/**
 * Map a typed action to a platform-specific shell command or SDK call.
 * Add one case per action defined in ${pascalName}Actions.
 */
async function executeCommand(
    actionName: string,
    parameters: Record<string, unknown>,
): Promise<string> {
    switch (actionName) {
        // TODO: add cases for each action. Example:
        // case "openFile": {
        //     const cmd = platform === "win32" ? \`start "" "\${parameters.path}"\`
        //               : platform === "darwin" ? \`open "\${parameters.path}"\`
        //               : \`xdg-open "\${parameters.path}"\`;
        //     return (await execAsync(cmd)).stdout;
        // }
        default:
            throw new Error(\`Not implemented: \${actionName}\`);
    }
}
`;
}

function buildViewUiHandler(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: view-ui — web view renderer with IPC handler.
// Opens a local HTTP server serving site/ and communicates via display APIs.
// The actual UX lives in the site/ directory.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromHtmlDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ${pascalName}Actions } from "./${name}Schema.js";

const VIEW_PORT = 3456; // TODO: choose an unused port

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        closeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    // TODO: start the local HTTP server that serves site/
    return {};
}

async function updateAgentContext(
    enable: boolean,
    context: ActionContext<unknown>,
): Promise<void> {
    if (enable) {
        await context.sessionContext.agentIO.openLocalView(
            context.sessionContext.requestId,
            VIEW_PORT,
        );
    } else {
        await context.sessionContext.agentIO.closeLocalView(
            context.sessionContext.requestId,
            VIEW_PORT,
        );
    }
}

async function closeAgentContext(_context: ActionContext<unknown>): Promise<void> {
    // TODO: stop the local HTTP server
}

async function executeAction(
    action: TypeAgentAction<${pascalName}Actions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    // Push state changes to the view via HTML display updates.
    return createActionResultFromHtmlDisplay(
        \`<p>Executing \${action.actionName} — not yet implemented.</p>\`,
    );
}
`;
}

function buildCommandHandlerTemplate(name: string, pascalName: string): string {
    return `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pattern: command-handler — direct dispatch via a handlers map.
// Suited for settings-style agents with a small number of well-known commands.

import { AppAgent, ActionResult } from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";

export function instantiate(): AppAgent {
    return getCommandInterface(handlers);
}

// ---- Handlers ----------------------------------------------------------
// Add one entry per action name defined in ${pascalName}Actions.

const handlers: Record<string, (params: unknown) => Promise<ActionResult>> = {
    // exampleAction: async (params) => {
    //     return createActionResultFromTextDisplay("Done.");
    // },
};

function getCommandInterface(
    handlerMap: Record<string, (params: unknown) => Promise<ActionResult>>,
): AppAgent {
    return {
        async executeAction(action: any): Promise<ActionResult> {
            const handler = handlerMap[action.actionName];
            if (!handler) {
                return { error: \`Unknown action: \${action.actionName}\` };
            }
            return handler(action.parameters);
        },
    };
}
`;
}
