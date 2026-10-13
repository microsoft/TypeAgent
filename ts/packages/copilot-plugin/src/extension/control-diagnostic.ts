// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotSession } from "@github/copilot-sdk";
import { readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ControlMetadata } from "../shared/control-metadata.js";
import {
    publishControlMetadata,
    assertControlBinding,
} from "../shared/control-metadata.js";
import { createHash } from "node:crypto";

type ControlRpc = {
    commands: Pick<CopilotSession["rpc"]["commands"], "list" | "invoke">;
    tools: Pick<CopilotSession["rpc"]["tools"], "getCurrentMetadata">;
};
const mcpComponents = [
    "mcp-agent",
    "mcp-workspace",
    "mcp-macros",
    "mcp-skills",
];

function store(file: string, value: unknown): void {
    const pending = `${file}.pending`;
    writeFileSync(pending, JSON.stringify(value), { flag: "wx" });
    renameSync(pending, file);
}

function records(control: ControlMetadata): ControlMetadata[] {
    const directory = join(control.dataRoot, "native-control");
    return readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .map((file) => JSON.parse(readFileSync(join(directory, file), "utf8")));
}

function admittedActor(
    control: ControlMetadata,
    record: ControlMetadata,
): boolean {
    const admission = JSON.parse(
        readFileSync(
            join(control.dataRoot, "native-control-admission.json"),
            "utf8",
        ),
    );
    const identities: {
        ProcessId: number;
        ParentProcessId: number;
        ExecutablePath: string;
        StartedMs: number;
    }[] = admission.diagnosticActorIdentities ?? [];
    return identities.some(
        (identity) =>
            identity.ProcessId === record.source.pid &&
            identity.ParentProcessId === record.source.parentPid &&
            identity.ExecutablePath?.toLowerCase() ===
                record.source.executable.toLowerCase() &&
            identity.StartedMs <= Date.parse(record.source.observedAt),
    );
}

function matches(
    record: ControlMetadata,
    root: ControlMetadata,
    mode: string,
    routing: string,
    since: number,
): boolean {
    return (
        record.configPath === root.configPath &&
        record.dataRoot === root.dataRoot &&
        record.source.owner === root.source.owner &&
        record.effectiveMode === mode &&
        record.source.routing === routing &&
        record.source.readableOwnedConfig &&
        record.source.expectedMode === mode &&
        Date.parse(record.source.observedAt) >= since &&
        /^[a-f0-9]{64}$/u.test(record.digest ?? "")
    );
}

async function settled(
    control: ControlMetadata,
    mode: string,
    routing: string,
    since: number,
): Promise<ControlMetadata[]> {
    for (let attempt = 0; attempt < 75; attempt++) {
        const current = records(control);
        const wanted = current.filter(
            (record) =>
                (mcpComponents.includes(record.source.component) ||
                    record.source.component === "native-extension-status") &&
                admittedActor(control, record),
        );
        const hooks = current.filter(
            (record) =>
                record.source.component === "native-hook" &&
                record.source.parentPid === process.pid &&
                record.source.request === null &&
                matches(record, control, mode, routing, since),
        );
        if (
            wanted.length === 5 &&
            wanted.every((record) =>
                matches(record, control, mode, routing, since),
            ) &&
            hooks.length > 0
        ) {
            const latest = hooks.sort(
                (a, b) =>
                    Date.parse(b.source.observedAt) -
                    Date.parse(a.source.observedAt),
            )[0];
            const result = [...wanted, latest];
            if (new Set(result.map((record) => record.digest)).size !== 1)
                throw new Error("Control transition public digests disagree");
            if (!/node(?:\.exe)?$/iu.test(latest.source.executable))
                throw new Error(
                    "Compiled control getter did not run with Node",
                );
            return result;
        }
        await delay(200);
    }
    throw new Error(
        `Fresh all-actor control transition missing for ${mode}/${routing}`,
    );
}

async function invoke(
    rpc: ControlRpc,
    name: string,
    input: string,
): Promise<string> {
    const result = await rpc.commands.invoke({ name, input });
    if (!["completed", "text"].includes(result.kind))
        throw new Error(
            `Pure control command returned unsupported result kind ${result.kind}; no prompt submitted`,
        );
    return result.kind;
}

async function toolCatalog(
    rpc: ControlRpc,
    observed: (projection: unknown) => void,
) {
    for (let attempt = 0; attempt < 75; attempt++) {
        const result = await rpc.tools.getCurrentMetadata();
        if (result.tools === null) {
            observed(null);
            await delay(200);
            continue;
        }
        const projection = result.tools.map((tool) => ({
            name: tool.name,
            namespacedName: tool.namespacedName,
            mcpServerName: tool.mcpServerName,
            mcpToolName: tool.mcpToolName,
            schema: schemaProjection(tool.input_schema),
            deferLoading: tool.deferLoading,
        }));
        observed(projection);
        return projection;
    }
    throw new Error("Native SDK current tool metadata remained uninitialized");
}

function schemaProjection(schema: unknown) {
    if (!schema || typeof schema !== "object") return null;
    const value = schema as Record<string, unknown>;
    const properties =
        value.properties && typeof value.properties === "object"
            ? Object.entries(value.properties)
            : [];
    return {
        type: value.type,
        required: value.required,
        additionalProperties: value.additionalProperties,
        properties: properties.map(([name, property]) => ({
            name,
            type: (property as Record<string, unknown>)?.type,
            minLength: (property as Record<string, unknown>)?.minLength,
        })),
    };
}

function inventoryGate(projection: Awaited<ReturnType<typeof toolCatalog>>) {
    const docs = projection.filter(
        (tool) =>
            tool.mcpServerName === "macro-eval-docs" &&
            ["lookup_document", "fetch_document"].includes(
                tool.mcpToolName ?? "",
            ) &&
            tool.name === `macro-eval-docs-${tool.mcpToolName}`,
    );
    const unexpectedTools = projection
        .filter(
            (tool) =>
                (tool.name !== "task" && !docs.includes(tool)) ||
                (tool.name === "task" && tool.mcpServerName !== undefined),
        )
        .map((tool) => tool.name);
    if (
        docs.length !== 2 ||
        new Set(docs.map((tool) => tool.mcpToolName)).size !== 2 ||
        unexpectedTools.length > 0
    )
        return {
            passed: false,
            reason: "Actual SDK catalog does not match exact docs plus optional non-MCP task; no alias/filter relaxation",
            unexpectedTools,
        };
    for (const doc of docs) {
        const field = doc.mcpToolName === "lookup_document" ? "title" : "id";
        if (
            doc.schema?.type !== "object" ||
            JSON.stringify(doc.schema.required) !== JSON.stringify([field]) ||
            doc.schema.additionalProperties !== false ||
            doc.schema.properties.length !== 1 ||
            doc.schema.properties[0].name !== field ||
            doc.schema.properties[0].type !== "string" ||
            doc.schema.properties[0].minLength !== 1
        )
            return {
                passed: false,
                reason: `Exact ${doc.mcpToolName} schema unavailable or mismatched`,
            };
    }
    return {
        passed: true,
        reason: "Exact synthetic docs schema; model-visible task optional, authenticated host task API not invoked/proved",
    };
}

function getterProof(control: ControlMetadata, since: number) {
    const getter = JSON.parse(
        readFileSync(
            join(control.dataRoot, "native-control-getter-process.json"),
            "utf8",
        ),
    );
    if (
        getter.ParentProcessId !== process.pid ||
        Date.parse(getter.observedAt) < since ||
        !/node(?:\.exe)?$/iu.test(getter.ExecutablePath) ||
        getter.scriptHash !==
            createHash("sha256")
                .update(readFileSync(getter.script))
                .digest("hex")
    )
        throw new Error(
            "Actual registered canonical Node getter provenance missing or stale",
        );
    return getter;
}

function initialGetter(control: ControlMetadata, since: number) {
    const current = records(control);
    const extension = current.find(
        (record) =>
            record.source.component === "native-extension-status" &&
            record.source.pid === process.pid,
    );
    const getter = getterProof(control, since);
    const hook = current.find(
        (record) =>
            record.source.component === "native-hook" &&
            record.source.pid === getter.ProcessId &&
            record.source.parentPid === process.pid &&
            record.source.request === null,
    );
    if (
        !extension ||
        !hook ||
        !matches(extension, control, "bypass", "delegate", since) ||
        !matches(hook, control, "bypass", "delegate", since) ||
        extension.digest !== hook.digest
    )
        throw new Error(
            "Initial native SDK getter did not prove exact owned bypass root; no setter admitted",
        );
    const mcp = current.filter(
        (record) =>
            mcpComponents.includes(record.source.component) &&
            admittedActor(control, record),
    );
    if (
        mcp.length !== 4 ||
        !mcp.every(
            (record) =>
                matches(record, control, "bypass", "delegate", 0) &&
                record.digest === extension.digest,
        )
    )
        throw new Error(
            "Initial MCP effective roots/modes disagree; no setter admitted",
        );
    return { extension, hook, getter, mcp };
}

async function catalogAdmission(
    control: ControlMetadata,
    sessionId: string,
    observed: (admission: unknown) => void,
): Promise<void> {
    for (let attempt = 0; attempt < 750; attempt++) {
        const admission = JSON.parse(
            readFileSync(
                join(control.dataRoot, "native-control-admission.json"),
                "utf8",
            ),
        );
        if (admission.diagnosticCatalogReady === true) {
            observed({
                expectedSessionId: sessionId,
                admittedSessionId: admission.diagnosticCatalogSessionId ?? null,
                ready: true,
            });
            if (admission.diagnosticCatalogSessionId !== sessionId)
                throw new Error(
                    "Diagnostic catalog admission belongs to another native session",
                );
            return;
        }
        await delay(200);
    }
    throw new Error(
        "Controller did not admit the complete consent-aware native catalog",
    );
}

/** Only source-verified registered local setters/getters, never send or tool execute. */
export async function runControlDiagnostic(
    rpc: ControlRpc,
    control: ControlMetadata,
    sessionId: string,
): Promise<void> {
    const file = join(
        control.dataRoot,
        "native-control-diagnostic-result.json",
    );
    const result: {
        status: string;
        sessionId: string;
        transitions: unknown[];
        commandNames?: string[];
        registryNames?: string[];
        tools?: unknown;
        initialControl?: unknown;
        catalogAdmission?: unknown;
        workflowGates?: unknown[];
        error?: string;
        callback: null;
        capture: null;
    } = {
        status: "running",
        sessionId,
        transitions: [],
        callback: null,
        capture: null,
    };
    store(file, result);
    try {
        await catalogAdmission(control, sessionId, (admission) => {
            result.catalogAdmission = admission;
            store(file, result);
        });
        const registry = await rpc.commands.list();
        result.registryNames = registry.commands
            .map((command) => command.name)
            .filter((name) => name.includes("typeagent"));
        const select = (base: string) => {
            const found = registry.commands.filter((command) =>
                [base, `typeagent:${base}`].includes(command.name),
            );
            if (found.length !== 1)
                throw new Error(
                    `Exactly one registered ${base} command required`,
                );
            return found[0].name;
        };
        const status = select("typeagent-status");
        const modeCommand = select("typeagent-mode");
        result.commandNames = [status, modeCommand];
        result.tools = await toolCatalog(rpc, (projection) => {
            result.tools = projection;
            store(file, result);
        });
        const initial = publishControlMetadata("native-extension-status");
        assertControlBinding(initial);
        if (
            !initial ||
            initial.configPath !== control.configPath ||
            initial.dataRoot !== control.dataRoot ||
            initial.effectiveMode !== "bypass"
        )
            throw new Error(
                "Initial effective config/root/mode changed; no setter admitted",
            );
        const initialSince = Date.now();
        await invoke(rpc, status, "--control");
        result.initialControl = initialGetter(control, initialSince);
        result.workflowGates = [
            inventoryGate(
                result.tools as Awaited<ReturnType<typeof toolCatalog>>,
            ),
        ];
        store(file, result);
        const admissionFile = join(
            control.dataRoot,
            "native-control-admission.json",
        );
        for (const [mode, routing, input] of [
            ["bypass", "delegate", "bypass"],
            ["mcp", "mixed", "mcp mixed"],
            ["direct", "mixed", "direct"],
            ["bypass", "mixed", "bypass"],
        ]) {
            const before = Date.now();
            const admission = JSON.parse(readFileSync(admissionFile, "utf8"));
            store(admissionFile, { ...admission, expectedMode: mode });
            const setterResultKind = await invoke(rpc, modeCommand, input);
            const getterResultKind = await invoke(rpc, status, "--control");
            const current = await settled(control, mode, routing, before);
            const getter = getterProof(control, before);
            const projection = await toolCatalog(rpc, (projection) => {
                result.tools = projection;
                store(file, result);
            });
            const workflowGate = inventoryGate(projection);
            result.workflowGates.push(workflowGate);
            result.transitions.push({
                mode,
                routing,
                input,
                observedAt: new Date().toISOString(),
                setterResultKind,
                getterResultKind,
                control: current,
                getter,
                workflowGate,
                tools: projection,
            });
            store(file, result);
        }
        result.status = result.workflowGates.every(
            (gate) => (gate as { passed: boolean }).passed,
        )
            ? "passed-metadata-only"
            : "blocked";
        if (result.status === "blocked")
            result.error =
                "Pure mode/getter transitions proved; exact SDK workflow catalog/schema remains blocked";
    } catch (error) {
        result.status = "blocked";
        result.error =
            error instanceof Error
                ? error.message
                : "Native control diagnostic failed";
    }
    store(file, result);
}
