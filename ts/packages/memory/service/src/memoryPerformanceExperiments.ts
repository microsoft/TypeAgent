// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { timeSearchStage } from "@typeagent/knowpro";
export const memoryPerformanceExperimentNames = [
    "fast-models",
    "brief-reader",
    "source-preview",
    "refinement-fallback",
    "translation-cache",
    "evidence-leases",
    "graph-parallel",
    "foreground-priority",
    "lazy-collections",
] as const;

export type MemoryPerformanceExperiment =
    (typeof memoryPerformanceExperimentNames)[number];

export function resolveInitialReaderModelEndpoint(
    configured: string | undefined,
    fastEndpoint: string | undefined,
    experiments: ReadonlySet<MemoryPerformanceExperiment>,
): string | undefined {
    if (configured !== undefined && !configured.trim())
        throw new Error("initialReaderModelEndpoint must not be empty");
    return (
        configured ??
        (experiments.has("fast-models") ? fastEndpoint : undefined)
    );
}

export function memoryPerformanceExperiments(
    value = process.env.TYPEAGENT_MEMORY_PERF_EXPERIMENTS ?? "",
): ReadonlySet<MemoryPerformanceExperiment> {
    const result = new Set<MemoryPerformanceExperiment>();
    for (const name of value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)) {
        const names =
            name === "p2"
                ? memoryPerformanceExperimentNames.slice(0, 5)
                : name === "p3"
                  ? memoryPerformanceExperimentNames.slice(5)
                  : memoryPerformanceExperimentNames.filter(
                        (item) => item === name,
                    );
        if (!names.length)
            throw new Error(`Unknown memory performance experiment: ${name}`);
        for (const item of names) result.add(item);
    }
    return result;
}

export async function boundedSupportMap<T, R>(
    items: readonly T[],
    concurrency: 1 | 2,
    work: (item: T) => Promise<R>,
): Promise<R[]> {
    return timeSearchStage(
        "understanding.graphSupport",
        async () => {
            const result: R[] = [];
            for (let offset = 0; offset < items.length; offset += concurrency) {
                const settled = await Promise.allSettled(
                    items.slice(offset, offset + concurrency).map(work),
                );
                for (const item of settled) {
                    if (item.status === "rejected") throw item.reason;
                    result.push(item.value);
                }
            }
            return result;
        },
        { supportQueries: items.length, concurrency },
    );
}
