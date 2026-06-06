// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowledgeGraph, NodeId } from "./graph.js";

export interface ActivationOptions {
    /** Fraction of activation that survives each hop (0..1). */
    decay: number;
    /** Maximum number of hops to propagate. */
    maxHops: number;
    /** Activation below this is not propagated further. */
    minActivation: number;
}

export const defaultActivationOptions: ActivationOptions = {
    decay: 0.5,
    maxHops: 3,
    minActivation: 0.01,
};

/**
 * Spreading activation: seed energy on the query's matched nodes and let it
 * flow across typed edges, attenuated per hop and split by normalized edge
 * weight. Nodes that accumulate activation are "associatively related" to the
 * query even if they never share a token with it.
 *
 * Returns the total accumulated activation per reachable node.
 */
export function spreadingActivation(
    graph: KnowledgeGraph,
    seeds: Map<NodeId, number>,
    options: ActivationOptions = defaultActivationOptions,
): Map<NodeId, number> {
    const accumulated = new Map<NodeId, number>();
    // frontier holds activation to propagate outward this hop
    let frontier = new Map<NodeId, number>();

    for (const [id, energy] of seeds) {
        if (!graph.hasNode(id)) {
            continue;
        }
        accumulated.set(id, (accumulated.get(id) ?? 0) + energy);
        frontier.set(id, energy);
    }

    for (let hop = 0; hop < options.maxHops; hop++) {
        const next = new Map<NodeId, number>();

        for (const [from, energy] of frontier) {
            const outgoing = energy * options.decay;
            if (outgoing < options.minActivation) {
                continue;
            }
            const edges = graph.neighbors(from);
            const totalWeight = edges.reduce((s, e) => s + e.weight, 0);
            if (totalWeight <= 0) {
                continue;
            }
            for (const edge of edges) {
                const share = (edge.weight / totalWeight) * outgoing;
                if (share < options.minActivation) {
                    continue;
                }
                accumulated.set(
                    edge.to,
                    (accumulated.get(edge.to) ?? 0) + share,
                );
                next.set(edge.to, (next.get(edge.to) ?? 0) + share);
            }
        }

        if (next.size === 0) {
            break;
        }
        frontier = next;
    }

    return accumulated;
}
