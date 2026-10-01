// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface TopicSourceSet {
    name: string;
    mentionCount: number;
    sourceIds: string[];
}

export interface TopicCooccurrenceEdge {
    from: string;
    to: string;
    type: "co-occurs";
    strength: number;
    confidence: number;
}

export interface TopicCooccurrenceOptions {
    maxSourceFanout?: number;
    maxNeighborsPerTopic?: number;
}

const defaultMaxSourceFanout = 40;
const defaultMaxNeighborsPerTopic = 6;
const minimumConfidence = 0.25;

/**
 * The durable memory graph has topics but no topic relationships or
 * hierarchy. Two topics are related when they were extracted from the same
 * sources: the edge strength is the number of shared sources and its
 * confidence is their Jaccard similarity. Each topic keeps only its strongest
 * neighbors so the graph stays readable and the computation stays bounded.
 */
export function buildTopicCooccurrenceEdges(
    topics: TopicSourceSet[],
    options: TopicCooccurrenceOptions = {},
): TopicCooccurrenceEdge[] {
    const maxFanout = options.maxSourceFanout ?? defaultMaxSourceFanout;
    const maxNeighbors =
        options.maxNeighborsPerTopic ?? defaultMaxNeighborsPerTopic;

    const topicsBySource = new Map<string, TopicSourceSet[]>();
    for (const topic of topics) {
        for (const sourceId of new Set(topic.sourceIds)) {
            const group = topicsBySource.get(sourceId);
            if (group === undefined) {
                topicsBySource.set(sourceId, [topic]);
            } else {
                group.push(topic);
            }
        }
    }

    const sharedCounts = new Map<string, Map<string, number>>();
    const addShared = (left: string, right: string) => {
        const row = sharedCounts.get(left) ?? new Map<string, number>();
        row.set(right, (row.get(right) ?? 0) + 1);
        sharedCounts.set(left, row);
    };
    for (const group of topicsBySource.values()) {
        const bounded =
            group.length > maxFanout
                ? [...group]
                      .sort((a, b) => b.mentionCount - a.mentionCount)
                      .slice(0, maxFanout)
                : group;
        for (let i = 0; i < bounded.length; i++) {
            for (let j = i + 1; j < bounded.length; j++) {
                addShared(bounded[i].name, bounded[j].name);
                addShared(bounded[j].name, bounded[i].name);
            }
        }
    }

    const sourceCount = new Map(
        topics.map((topic) => [topic.name, new Set(topic.sourceIds).size]),
    );
    const kept = new Map<string, TopicCooccurrenceEdge>();
    for (const [name, neighbors] of sharedCounts) {
        const strongest = [...neighbors]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, maxNeighbors);
        for (const [other, shared] of strongest) {
            const [from, to] = name < other ? [name, other] : [other, name];
            const key = `${from}|${to}`;
            if (kept.has(key)) {
                continue;
            }
            const union =
                (sourceCount.get(name) ?? 0) +
                (sourceCount.get(other) ?? 0) -
                shared;
            kept.set(key, {
                from,
                to,
                type: "co-occurs",
                strength: shared,
                confidence: Math.max(
                    minimumConfidence,
                    union > 0 ? shared / union : 0,
                ),
            });
        }
    }
    return [...kept.values()];
}
