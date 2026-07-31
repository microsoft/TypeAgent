// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getAllActionConfigProvider,
    type ActionConfigProvider,
} from "agent-dispatcher/internal";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import { initializeCommandHandlerContext } from "agent-dispatcher/internal";
import { writeFileSync } from "node:fs";

const LABEL_EXCLUDED_SCHEMAS = new Set(["dispatcher"]);

interface GeneratedAction {
    schemaName: string;
    actionName: string;
    parameters: string;
    paramSpec: ParamSpec;
    description?: string;
}

type ParamSpec =
    | { k: "string"; enum?: string[] }
    | { k: "number" }
    | { k: "boolean" }
    | { k: "array"; item: ParamSpec }
    | {
          k: "object";
          fields: Record<string, { optional: boolean; spec: ParamSpec }>;
      }
    | { k: "any" };

/** Loose shape of action-schema type nodes (runtime schema objects). */
interface SchemaTypeNode {
    type?: string;
    typeEnum?: string[];
    elementType?: SchemaTypeNode;
    fields?: Record<string, SchemaFieldNode>;
    definition?: { type?: SchemaTypeNode };
}

interface SchemaFieldNode {
    optional?: boolean;
    type?: SchemaTypeNode;
}

interface ActionTypeNode {
    type?: {
        fields?: Record<string, SchemaFieldNode>;
    };
    comments?: string[];
}

interface ParsedActionSchema {
    actionSchemas: Iterable<[string, ActionTypeNode]>;
}

interface ActionSchemaFileLike {
    parsedActionSchema?: ParsedActionSchema;
}

function toSpec(t: SchemaTypeNode | undefined, depth = 0): ParamSpec {
    if (!t || depth > 5) return { k: "any" };
    switch (t.type) {
        case "string":
            return { k: "string" };
        case "number":
            return { k: "number" };
        case "boolean":
            return { k: "boolean" };
        case "string-union":
            return t.typeEnum !== undefined
                ? { k: "string", enum: t.typeEnum }
                : { k: "string" };
        case "array":
            return { k: "array", item: toSpec(t.elementType, depth + 1) };
        case "object": {
            const fields: Record<
                string,
                { optional: boolean; spec: ParamSpec }
            > = {};
            for (const [n, f] of Object.entries(t.fields ?? {})) {
                fields[n] = {
                    optional: !!f.optional,
                    spec: toSpec(f.type, depth + 1),
                };
            }
            return { k: "object", fields };
        }
        case "type-reference":
            return toSpec(t.definition?.type, depth + 1);
        default:
            return { k: "any" };
    }
}

function parameterSpec(actionType: ActionTypeNode): ParamSpec {
    const params = actionType.type?.fields?.parameters?.type;
    if (!params) return { k: "object", fields: {} };
    return toSpec(params);
}

function renderType(t: SchemaTypeNode | undefined, depth = 0): string {
    if (!t || depth > 3) return "any";
    switch (t.type) {
        case "string":
            return "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "array":
            return `${renderType(t.elementType, depth + 1)}[]`;
        case "string-union":
            return t.typeEnum
                ? t.typeEnum.map((v) => JSON.stringify(v)).join("|")
                : "string";
        case "object": {
            if (!t.fields) return "object";
            const inner = Object.entries(t.fields)
                .map(
                    ([n, f]) =>
                        `${n}${f.optional ? "?" : ""}: ${renderType(
                            f.type,
                            depth + 1,
                        )}`,
                )
                .join(", ");
            return `{ ${inner} }`;
        }
        case "type-reference":
            return renderType(t.definition?.type, depth + 1);
        default:
            return t.type ?? "any";
    }
}

function summarizeParameters(actionType: ActionTypeNode): string {
    const fields = actionType.type?.fields;
    if (!fields) return "(none)";
    const params = fields.parameters?.type;
    if (!params || params.type !== "object" || !params.fields) return "(none)";
    const names = Object.entries(params.fields).map(
        ([name, f]) =>
            `${name}${f.optional ? "?" : ""}: ${renderType(f.type)}`,
    );
    return names.length === 0 ? "(none)" : names.join(", ");
}

async function main(): Promise<void> {
    const systemContext = await initializeCommandHandlerContext(
        "translation-bench-catalog",
        {
            appAgentProviders: getDefaultAppAgentProviders(undefined),
            persistSession: false,
            dblogging: false,
        },
    );
    const active = [
        ...(
            systemContext.agents as unknown as {
                getSchemaNames: () => string[];
            }
        ).getSchemaNames(),
    ].sort();

    if (!active.includes("dispatcher")) {
        throw new Error(
            "The `dispatcher` schema must stay active - it carries the abstain action.",
        );
    }

    const { provider, schemaNames } = await getAllActionConfigProvider(
        getDefaultAppAgentProviders(undefined),
    );
    const p = provider as ActionConfigProvider;

    const actions: GeneratedAction[] = [];
    const unloadable: string[] = [];
    for (const schemaName of active) {
        if (LABEL_EXCLUDED_SCHEMAS.has(schemaName)) continue;
        let file: ActionSchemaFileLike;
        try {
            const config = p.getActionConfig(schemaName);
            file = p.getActionSchemaFileForConfig(
                config,
            ) as ActionSchemaFileLike;
        } catch {
            unloadable.push(schemaName);
            continue;
        }
        const parsed = file.parsedActionSchema;
        if (!parsed?.actionSchemas) continue;
        for (const [actionName, actionType] of parsed.actionSchemas) {
            const description = actionType.comments
                ?.join(" ")
                .trim()
                .slice(0, 300);
            actions.push({
                schemaName,
                actionName,
                parameters: summarizeParameters(actionType),
                paramSpec: parameterSpec(actionType),
                ...(description ? { description } : {}),
            });
        }
    }

    const out =
        process.argv[2] ?? "src/translationBench/catalog.generated.json";
    writeFileSync(
        out,
        `${JSON.stringify(
            {
                catalogVersion: new Date().toISOString().slice(0, 10),
                activeSchemas: active.filter((s) => !unloadable.includes(s)),
                unloadableSchemas: unloadable,
                allRegistrySchemas: [...schemaNames].sort(),
                activeSchemaSource:
                    "systemContext.agents.getSchemaNames() (same source as translationProbeRunner)",
                actions,
            },
            null,
            2,
        )}\n`,
    );
    process.stderr.write(
        `[genCatalog] wrote ${out}: ${active.length} active schemas, ${actions.length} actions\n`,
    );
}

main().then(
    () => setTimeout(() => process.exit(0), 250).unref(),
    (e) => {
        console.error("genCatalog failed:", e);
        process.exit(1);
    },
);
