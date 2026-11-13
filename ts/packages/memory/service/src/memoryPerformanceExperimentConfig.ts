// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    "indexing-parallel",
    "synopsis-parallel",
    "embedding-parallel",
    "synopsis-checkpoint-priority",
    "early-required-failure",
    "wiki-full-context",
    "wiki-stable-evidence",
    "wiki-utility-first",
    "wiki-coalesced-discovery",
    "wiki-grouped-contributions",
    "family-frozen-preparation",
] as const;

export type MemoryPerformanceExperiment =
    (typeof memoryPerformanceExperimentNames)[number];

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
                  ? memoryPerformanceExperimentNames.slice(5, 9)
                  : memoryPerformanceExperimentNames.filter(
                        (item) => item === name,
                    );
        if (!names.length)
            throw new Error(`Unknown memory performance experiment: ${name}`);
        for (const item of names) result.add(item);
    }
    if (result.has("indexing-parallel")) {
        result.add("synopsis-parallel");
        result.add("embedding-parallel");
    }
    return result;
}
