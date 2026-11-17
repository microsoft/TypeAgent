// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type { TopicCurationCompletion } from "./topicCuration.js";

const wrapped = new WeakSet<TopicCurationCompletion>();
export class TopicCurationTransportError extends Error {}
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

function request(
    payload: unknown,
    schema: StructuredOutputJsonSchema | undefined,
) {
    if (!record(payload) || !Array.isArray(payload.nodes)) return undefined;
    const ids = new Map<string, string>();
    let rawNodes = 0;
    let priorConcepts = 0;
    let proposalConcepts = 0;
    for (const node of payload.nodes) {
        if (!record(node) || typeof node.id !== "string")
            throw new Error("Invalid topic transport candidate");
        if (ids.has(node.id))
            throw new Error("Duplicate topic transport candidate");
        ids.set(node.id, `n${ids.size}`);
        if (node.id.startsWith("topic:")) rawNodes++;
        if (node.id.startsWith("concept:")) priorConcepts++;
        if (node.id.startsWith("proposal:")) proposalConcepts++;
    }
    function replaceSchema(value: unknown): void {
        if (Array.isArray(value)) value.forEach(replaceSchema);
        else if (record(value))
            for (const [key, child] of Object.entries(value)) {
                if (key === "enum" && Array.isArray(child))
                    value[key] = child.map((item) =>
                        typeof item === "string"
                            ? (ids.get(item) ?? item)
                            : item,
                    );
                else replaceSchema(child);
            }
    }
    const compactSchema = schema ? structuredClone(schema) : undefined;
    if (compactSchema) replaceSchema(compactSchema.schema);
    const aliases = new Map([...ids].map(([id, alias]) => [alias, id]));
    function original(value: unknown): unknown {
        if (typeof value !== "string") return value;
        const id = aliases.get(value);
        if (!id)
            throw new TopicCurationTransportError(
                "Unknown compact topic identifier",
            );
        return id;
    }
    return {
        payload: {
            ...payload,
            nodes: payload.nodes.map((node) => {
                if (!record(node) || typeof node.id !== "string")
                    throw new Error("Invalid topic transport candidate");
                return { ...node, id: ids.get(node.id) };
            }),
        },
        schema: compactSchema,
        counts: { rawNodes, priorConcepts, proposalConcepts },
        restore(value: unknown): unknown {
            if (!record(value)) return value;
            return {
                ...value,
                ...(Array.isArray(value.concepts)
                    ? {
                          concepts: value.concepts.map((concept) =>
                              record(concept) &&
                              Array.isArray(concept.memberIds)
                                  ? {
                                        ...concept,
                                        memberIds:
                                            concept.memberIds.map(original),
                                    }
                                  : concept,
                          ),
                      }
                    : {}),
                ...(Array.isArray(value.deferred)
                    ? {
                          deferred: value.deferred.map((entry) =>
                              record(entry)
                                  ? {
                                        ...entry,
                                        nodeId: original(entry.nodeId),
                                    }
                                  : entry,
                          ),
                      }
                    : {}),
            };
        },
    };
}

export function compactTopicCompletion(
    complete: TopicCurationCompletion,
    inspect = complete.inspectRequest,
): TopicCurationCompletion {
    if (wrapped.has(complete)) return complete;
    const compact: TopicCurationCompletion = async (
        rules,
        payload,
        schema,
        context,
    ) => {
        const wire = request(payload, schema);
        if (!wire) return complete(rules, payload, schema, context);
        return wire.restore(
            await complete(
                rules,
                wire.payload,
                wire.schema,
                context
                    ? {
                          ...context,
                          rawNodes: context.rawNodes ?? wire.counts.rawNodes,
                          priorConcepts:
                              context.priorConcepts ??
                              wire.counts.priorConcepts,
                          proposalConcepts:
                              context.proposalConcepts ??
                              wire.counts.proposalConcepts,
                      }
                    : undefined,
            ),
        );
    };
    if (inspect)
        compact.inspectRequest = (rules, payload, schema) => {
            const wire = request(payload, schema);
            return inspect(
                rules,
                wire?.payload ?? payload,
                wire?.schema ?? schema,
            );
        };
    wrapped.add(compact);
    return compact;
}
