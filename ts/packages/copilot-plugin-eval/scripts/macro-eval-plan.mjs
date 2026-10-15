// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

export const macroProtocolVersion = "macro-native-eval-v1";

function positiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`${name} must be a positive integer`);
    return value;
}

function seededRandom(seed) {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function shuffled(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}

function selectCases(cases, options) {
    const available = cases.filter((scenario) => scenario.kind !== "training");
    const ids = options.caseIds ?? available.map((scenario) => scenario.id);
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
        throw new Error("Select at least one unique scenario ID");
    const selected = ids.map((id) => {
        const scenario = available.find((item) => item.id === id);
        if (!scenario) throw new Error(`Unknown non-training scenario: ${id}`);
        return scenario;
    });
    if (
        options.mode !== "acceptance" &&
        selected.some((scenario) => scenario.kind !== "positive")
    )
        throw new Error("Performance/stress trials require positive scenarios");
    if (options.mode === "stress" && selected.length !== 1)
        throw new Error("Stress trials require exactly one scenario");
    return selected;
}

function trial(scenario, repetition, condition, mode, restartBefore = false) {
    return {
        trialId: `${scenario.id}-${repetition}-${condition}`,
        pairId: mode === "paired" ? `${scenario.id}-${repetition}` : null,
        scenarioId: scenario.id,
        familyId: scenario.familyId,
        repetition,
        condition,
        freshSession: mode !== "stress" || repetition === 0 || restartBefore,
        restoreLearnedStore: condition === "reuse" && mode !== "stress",
        restartBefore,
    };
}

export function createCampaignPlan(cases, options) {
    if (!Array.isArray(cases) || !cases.length)
        throw new Error("A validated nonempty scenario corpus is required");
    if (!["acceptance", "paired", "stress"].includes(options.mode))
        throw new Error("Mode must be acceptance, paired or stress");
    if (
        !Number.isInteger(options.seed) ||
        options.seed < 0 ||
        options.seed > 0xffffffff
    )
        throw new Error(
            "An explicit unsigned 32-bit scheduler seed is required",
        );
    for (const name of ["rootModel", "runnerModel"])
        if (typeof options[name] !== "string" || !options[name].trim())
            throw new Error(`An explicit ${name} is required`);
    if (options.runnerModel !== "gpt-6-luna")
        throw new Error("Current macro runners require gpt-6-luna");
    const repetitions = positiveInteger(options.repetitions, "repetitions");
    const maxTargetModelTurns = positiveInteger(
        options.maxTargetModelTurns,
        "maxTargetModelTurns",
    );
    const maxDurationMs = positiveInteger(
        options.maxDurationMs,
        "maxDurationMs",
    );
    const selected = selectCases(cases, options);
    if (
        options.mode !== "acceptance" &&
        new Set(selected.map((scenario) => scenario.familyId)).size !== 1
    )
        throw new Error(
            "Measure one task family per performance/stress campaign",
        );
    const random = seededRandom(options.seed);
    const schedule = [];
    for (let repetition = 0; repetition < repetitions; repetition++) {
        for (const scenario of shuffled(selected, random)) {
            if (options.mode === "paired") {
                for (const condition of shuffled(["baseline", "reuse"], random))
                    schedule.push(
                        trial(scenario, repetition, condition, options.mode),
                    );
            } else {
                const restartBefore =
                    options.mode === "stress" &&
                    repetition === Math.floor(repetitions / 2) &&
                    repetition > 0;
                schedule.push(
                    trial(
                        scenario,
                        repetition,
                        "reuse",
                        options.mode,
                        restartBefore,
                    ),
                );
            }
        }
    }
    return {
        protocolVersion: macroProtocolVersion,
        scope: "synthetic-only",
        mode: options.mode,
        seed: options.seed,
        samplingSeed: null,
        models: {
            root: options.rootModel,
            runner: options.runnerModel,
            preparation: "existing-service-configuration; record at admission",
        },
        budget: {
            maxTargetModelTurns,
            maxDurationMs,
            monetaryCap: null,
            note: "Turn/deadline bounds are not a monetary or preparation-model cap.",
        },
        timingBoundary: "controller-submit-to-observed-terminal-outcome",
        scenarioHash: createHash("sha256")
            .update(JSON.stringify(cases))
            .digest("hex"),
        selectedCases: selected.map((scenario) => scenario.id),
        schedule,
        acceptance: "unexecuted",
    };
}
