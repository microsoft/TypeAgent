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
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { ScaffolderActions } from "./scaffolderSchema.js";
import {
    loadState,
    updatePhase,
    writeArtifact,
    readArtifact,
    getWorkspacePath,
} from "../lib/workspace.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Default output root within the TypeAgent repo
const AGENTS_DIR = path.resolve(
    new URL(import.meta.url).pathname,
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
    }
}

async function handleScaffoldAgent(
    integrationName: string,
    outputDir?: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.grammarGen.status !== "approved") {
        return { error: `Grammar phase must be approved first. Run approveGrammar.` };
    }

    const schemaTs = await readArtifact(integrationName, "schemaGen", "schema.ts");
    const grammarAgr = await readArtifact(integrationName, "grammarGen", "schema.agr");
    if (!schemaTs || !grammarAgr) {
        return { error: `Missing schema or grammar artifacts for "${integrationName}".` };
    }

    await updatePhase(integrationName, "scaffolder", { status: "in-progress" });

    // Determine package name and Pascal-case type name
    const packageName = `${integrationName}-agent`;
    const pascalName = toPascalCase(integrationName);
    const targetDir = outputDir ?? path.join(AGENTS_DIR, integrationName);
    const srcDir = path.join(targetDir, "src");

    await fs.mkdir(srcDir, { recursive: true });

    // Write schema and grammar
    await writeFile(
        path.join(srcDir, `${integrationName}Schema.ts`),
        schemaTs,
    );
    await writeFile(
        path.join(srcDir, `${integrationName}Schema.agr`),
        grammarAgr.replace(
            /from "\.\/schema\.ts"/g,
            `from "./${integrationName}Schema.ts"`,
        ),
    );

    // Stamp out manifest
    await writeFile(
        path.join(srcDir, `${integrationName}Manifest.json`),
        JSON.stringify(
            buildManifest(integrationName, pascalName, state.config.description ?? ""),
            null,
            2,
        ),
    );

    // Stamp out handler
    await writeFile(
        path.join(srcDir, `${integrationName}ActionHandler.ts`),
        buildHandler(integrationName, pascalName),
    );

    // Stamp out package.json
    await writeFile(
        path.join(targetDir, "package.json"),
        JSON.stringify(buildPackageJson(integrationName, packageName, pascalName), null, 2),
    );

    // Stamp out tsconfigs
    await writeFile(
        path.join(targetDir, "tsconfig.json"),
        JSON.stringify(ROOT_TSCONFIG, null, 2),
    );
    await writeFile(
        path.join(srcDir, "tsconfig.json"),
        JSON.stringify(SRC_TSCONFIG, null, 2),
    );

    // Also copy to workspace scaffolder dir for reference
    await writeArtifact(
        integrationName,
        "scaffolder",
        "scaffolded-to.txt",
        targetDir,
    );

    await updatePhase(integrationName, "scaffolder", { status: "approved" });

    const files = [
        `src/${integrationName}Schema.ts`,
        `src/${integrationName}Schema.agr`,
        `src/${integrationName}Manifest.json`,
        `src/${integrationName}ActionHandler.ts`,
        `package.json`,
        `tsconfig.json`,
        `src/tsconfig.json`,
    ];

    return createActionResultFromMarkdownDisplay(
        `## Agent scaffolded: ${integrationName}\n\n` +
            `**Output directory:** \`${targetDir}\`\n\n` +
            `**Files created:**\n` +
            files.map((f) => `- \`${f}\``).join("\n") +
            `\n\n**Next step:** Phase 6 — use \`generateTests\` and \`runTests\` to validate.`,
    );
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
        return { error: `Unknown template "${template}". Use listTemplates to see available templates.` };
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

function buildManifest(name: string, pascalName: string, description: string) {
    return {
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
}

function buildHandler(name: string, pascalName: string): string {
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

function buildPackageJson(name: string, packageName: string, pascalName: string) {
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
        scripts: {
            asc: `asc -i ./src/${name}Schema.ts -o ./dist/${name}Schema.pas.json -t ${pascalName}Actions`,
            agc: `agc -i ./src/${name}Schema.agr -o ./dist/${name}Schema.ag.json`,
            build: "concurrently npm:tsc npm:asc npm:agc",
            clean: "rimraf --glob dist *.tsbuildinfo *.done.build.log",
            tsc: "tsc -b",
        },
        dependencies: {
            "@typeagent/agent-sdk": "workspace:*",
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
