// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { check, hash, identity, text, unique } from "./quality-contract.mjs";

export const taskMetrics = [
    "issueOrdering",
    "topicFalseMerge",
    "topicFalseSplit",
    "topicAdmission",
    "correctionUptake",
    "staleClaimRemoval",
    "unaffectedPreservation",
    "sourceForgetting",
    "humanEditGuard",
];

export function validateTaskGold(
    tasks = [],
    bundle,
    mapping,
    witnessValidator,
) {
    for (const task of unique(tasks, "id", "task gold").values()) {
        check(taskMetrics.includes(task.metric), "Unknown task metric");
        text(task.requirement, "task requirement");
        check(typeof task.critical === "boolean", "Task criticality required");
        check(
            Array.isArray(task.witnesses) &&
                (task.witnesses.length > 0 || task.metric === "humanEditGuard"),
            "Task gold requires original source witnesses",
        );
        for (const witness of task.witnesses)
            witnessValidator(witness, bundle, mapping);
        if (task.metric === "issueOrdering") {
            text(task.before, "higher-priority issue");
            text(task.after, "lower-priority issue");
            check(
                task.before !== task.after,
                "Distinct ordered issues required",
            );
            check(
                [
                    "source-stated",
                    "supported-consequence",
                    "reader-order",
                ].includes(task.basis),
                "Ordering basis required; do not invent severity",
            );
        }
        if (task.metric.startsWith("topic")) {
            text(task.subject, "topic subject");
            check(
                ["same", "different", "admitted", "deferred"].includes(
                    task.expected,
                ),
                "Reviewed topic judgment required",
            );
            check(
                task.metric === "topicAdmission"
                    ? ["admitted", "deferred"].includes(task.expected)
                    : task.expected ===
                          (task.metric === "topicFalseMerge"
                              ? "different"
                              : "same"),
                "Topic metric/judgment mismatch",
            );
        }
        if (["staleClaimRemoval", "sourceForgetting"].includes(task.metric)) {
            text(task.obsoleteQuote, "obsolete claim");
            check(
                ["absent", "historical-only"].includes(task.expected),
                "Removal must define permitted historical retention",
            );
        }
        if (task.metric === "humanEditGuard") {
            text(task.protectedQuote, "protected human edit");
            text(task.protectedSavedQuote, "protected saved human edit");
        }
        if (task.metric === "sourceForgetting") {
            text(task.removedSourceId, "removed source");
        }
        if (
            !task.metric.startsWith("topic") &&
            task.metric !== "issueOrdering"
        ) {
            text(task.previousCheckpointId, "maintenance predecessor");
        }
        check(
            task.previousSavedHash === undefined &&
                task.previousRenderedHash === undefined &&
                task.operationReceiptHash === undefined,
            "Artifact hashes belong to per-attempt task bindings, not shared gold",
        );
    }
}

export function validateTaskContext(tasks = [], row, rows) {
    const bindings = unique(row.taskBindings ?? [], "id", "task bindings");
    for (const id of bindings.keys())
        check(
            tasks.some((task) => task.id === id),
            "Unknown task binding",
        );
    for (const task of tasks) {
        const binding = bindings.get(task.id);
        if (row.status !== "ok" && !binding) continue;
        if (task.previousCheckpointId !== undefined) {
            const previous = [...rows.values()].find(
                (candidate) =>
                    candidate.caseId === task.previousCheckpointId &&
                    candidate.arm === row.arm &&
                    candidate.generation === row.generation,
            );
            check(
                previous &&
                    binding &&
                    previous.id !== row.id &&
                    previous.hashes.savedHash === binding.previousSavedHash &&
                    previous.hashes.renderedHash ===
                        binding.previousRenderedHash,
                "Maintenance predecessor artifact identity mismatch",
            );
        }
        if (["sourceForgetting", "humanEditGuard"].includes(task.metric)) {
            if (
                ["failed", "missing"].includes(row.status) &&
                !row.taskReceipts?.length
            )
                continue;
            hash(
                binding?.operationReceiptHash,
                "maintenance operation receipt hash",
            );
            const receipt = row.taskReceipts?.find(
                (raw) =>
                    typeof raw === "string" &&
                    identity(raw) === binding.operationReceiptHash,
            );
            check(receipt, "Missing exact maintenance operation receipt");
            const operation = JSON.parse(receipt);
            check(
                operation.caseId === row.caseId,
                "Maintenance receipt case mismatch",
            );
            if (task.metric === "sourceForgetting") {
                check(
                    operation.kind === "source-removal" &&
                        operation.sourceId === task.removedSourceId &&
                        operation.state === "complete",
                    "Source removal receipt mismatch",
                );
                check(
                    !row.selectedEvidence.some(
                        (passage) => passage.sourceId === task.removedSourceId,
                    ),
                    "Removed source remains selected",
                );
            }
            if (task.metric === "humanEditGuard")
                check(
                    operation.kind === "human-edit" &&
                        operation.protectedQuote === task.protectedQuote &&
                        operation.state === "complete",
                    "Human edit receipt mismatch",
                );
        }
    }
}

function validateOrderingLabel(label, row) {
    if (!label.correct) return;
    for (const key of ["beforeQuote", "afterQuote"])
        check(
            row.rendered?.includes(text(label[key], key)),
            "Ordered issue quote absent from rendered artifact",
        );
    if (label.correct)
        check(
            row.rendered.indexOf(label.beforeQuote) <
                row.rendered.indexOf(label.afterQuote),
            "Issue ordering verdict contradicts rendered order",
        );
}

function validateTopicLabel(task, label) {
    const allowed =
        task.metric === "topicAdmission"
            ? ["admitted", "deferred", "uncertain"]
            : ["same", "different", "uncertain"];
    check(allowed.includes(label.observed), "Observed topic judgment required");
    check(
        label.correct === (label.observed === task.expected),
        "Topic verdict contradicts reviewed judgment",
    );
}

function validateMaintenanceLabel(task, label, row) {
    if (!label.correct) return;
    if (task.expected === "absent")
        check(
            row.saved !== null &&
                row.rendered !== null &&
                !row.saved.includes(task.obsoleteQuote) &&
                !row.rendered.includes(task.obsoleteQuote),
            "Removed claim remains in artifact",
        );
    if (task.metric === "humanEditGuard")
        check(
            row.saved?.includes(task.protectedSavedQuote) &&
                row.rendered?.includes(task.protectedQuote),
            "Protected human edit was not preserved",
        );
}

export function validateTaskLabels(tasks = [], labels = [], row) {
    const verdicts = unique(labels, "id", "task labels");
    check(verdicts.size === tasks.length, "Missing/unknown task annotation");
    for (const task of tasks) {
        const label = verdicts.get(task.id);
        const outputless =
            ["failed", "missing"].includes(row.status) &&
            row.saved === null &&
            row.rendered === null;
        if (outputless) {
            check(
                label &&
                    [false, null].includes(label.correct) &&
                    Array.isArray(label.evidence) &&
                    label.evidence.length === 0,
                "Outputless failure requires a false/unknown verdict without fabricated output quotes",
            );
            text(label.rationale, "task verdict rationale");
            if (task.metric.startsWith("topic"))
                check(
                    label.observed === "uncertain",
                    "Outputless topic verdict must remain uncertain",
                );
            continue;
        }
        check(
            label && typeof label.correct === "boolean",
            "Task verdict required",
        );
        text(label.rationale, "task verdict rationale");
        check(
            Array.isArray(label.evidence) && label.evidence.length > 0,
            "Task verdict requires exact saved/rendered evidence",
        );
        for (const evidence of label.evidence)
            check(
                ["saved", "rendered"].includes(evidence.artifact) &&
                    row[evidence.artifact]?.includes(
                        text(evidence.quote, "task quote"),
                    ),
                "Task quote absent from actual artifact",
            );
        if (task.previousCheckpointId !== undefined && label.correct) {
            const binding = row.taskBindings?.find(
                (entry) => entry.id === task.id,
            );
            hash(binding?.previousSavedHash, "predecessor saved hash");
            hash(binding?.previousRenderedHash, "predecessor rendered hash");
        }
        if (task.metric === "issueOrdering") validateOrderingLabel(label, row);
        if (task.metric.startsWith("topic")) validateTopicLabel(task, label);
        validateMaintenanceLabel(task, label, row);
    }
}

export function taskScore(tasks = [], labels = [], metric, successful) {
    const targets = tasks.filter((task) => task.metric === metric);
    if (["topicFalseMerge", "topicFalseSplit"].includes(metric)) {
        const observed = successful
            ? targets
                  .map(
                      (task) =>
                          labels.find((label) => label.id === task.id)
                              ?.observed,
                  )
                  .filter((value) => ["same", "different"].includes(value))
            : [];
        const errors = observed.filter(
            (value) =>
                value === (metric === "topicFalseMerge" ? "same" : "different"),
        ).length;
        return {
            numerator: errors,
            denominator: observed.length || null,
            value: observed.length ? errors / observed.length : null,
        };
    }
    const numerator = successful
        ? targets.filter(
              (task) => labels.find((label) => label.id === task.id)?.correct,
          ).length
        : 0;
    return {
        numerator,
        denominator: targets.length || null,
        value: targets.length ? numerator / targets.length : null,
    };
}
