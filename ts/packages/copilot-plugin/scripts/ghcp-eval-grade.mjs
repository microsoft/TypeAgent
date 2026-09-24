// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function terminalExecutionFailure(toolName, result, success) {
    if (
        /^(?:functions[.-])?(?:powershell|view|glob|rg|web_fetch)$/.test(
            toolName,
        )
    )
        return success === false;
    if (!/processCommand|executeAction|continueAction/.test(toolName))
        return false;
    return (
        success === false ||
        (toolName.includes("processCommand") &&
            /^Error:\s/.test(result?.content ?? "")) ||
        ["failed", "cancelled", "unavailable", "execution_uncertain"].includes(
            result?.structuredContent?.status,
        )
    );
}

export function percentile(values, fraction) {
    if (values.length === 0) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}

export function intervalUnionMs(intervals) {
    const sorted = intervals
        .filter(
            ([start, end]) =>
                Number.isFinite(start) && Number.isFinite(end) && end >= start,
        )
        .sort(([a], [b]) => a - b);
    let end = -Infinity;
    let total = 0;
    for (const [start, next] of sorted) {
        total += Math.max(0, next - Math.max(start, end));
        end = Math.max(end, next);
    }
    return total;
}

export function externalOracle(readiness) {
    if (readiness.status !== "passed")
        throw new Error("Live readiness has not passed");
    const prs = {};
    for (const entry of readiness.externalEvidence) {
        const text = (entry.outcome.output ?? []).join("\n");
        if (entry.actionName === "prFiles") {
            const files = [
                ...text.matchAll(
                    /^(\S+)\s+(?:modified|added|removed|renamed)\s+\d+\s+\d+\s*$/gm,
                ),
            ].map((match) => match[1]);
            const count = text.match(/(\d+) of (\d+) files/);
            if (
                !count ||
                Number(count[1]) !== Number(count[2]) ||
                new Set(files).size !== Number(count[2])
            )
                throw new Error("Independent PR file snapshot is incomplete");
            prs[entry.number] = {
                files: [...new Set(files)],
                capturedAt: entry.capturedAt,
            };
        }
        if (entry.actionName === "prChecks") {
            if (!prs[entry.number]) throw new Error("Missing PR file oracle");
            prs[entry.number].checks = text;
        }
    }
    return prs;
}

// These are conservative evidence checks, not a semantic grader. A human/AI
// reviewer must resolve pending faithfulness grades before accuracy claims.
export function preliminaryGrade(result, evidence) {
    if (result.status !== "completed_ungraded")
        return { outcome: "incomplete", reason: result.error ?? result.status };
    if (result.routeViolations.length)
        return { outcome: "failed", reason: "route_or_interaction_violation" };
    if (result.terminalExecutionFailure)
        return {
            outcome: "incomplete",
            reason: "execution_failed_or_uncertain_no_replay",
        };
    if (
        !result.grade.filesUnchanged ||
        result.grade.listStateMatchesOracle === false
    )
        return {
            outcome: "failed",
            reason: "independent_fixture_oracle_mismatch",
        };
    if (
        result.caseId.startsWith("A") &&
        (!result.grade.clarificationRequested ||
            !result.grade.noPrematureListMutation)
    )
        return {
            outcome: "failed",
            reason: "clarification_not_verified_before_effects",
        };
    const answer = result.answer ?? "";
    if (!answer.trim()) return { outcome: "failed", reason: "no_final_answer" };
    const required = {
        S1: [
            "grocery",
            "pantry",
            "packing",
            "travel",
            "office",
            "errand",
            "weekend",
        ],
        S2: ["passport", "charger", "socks"],
        S4: ["apples"],
        M1: [
            "report-a.txt",
            "report-b.txt",
            "passport",
            "charger",
            "socks",
            "adapter",
        ],
        M3: ["bread", "oranges"],
        M5: [evidence.issueTitle],
        R1: ["rice"],
        R2: ["report-a.txt", "report-b.txt"],
        R4: ["jacket"],
        R5: [evidence.issueTitle],
        A1: ["apples"],
        A2: ["charger", "adapter"],
        A5: ["destination", "mountain", "jacket", "required"],
    }[result.caseId];
    const missing =
        required?.filter(
            (term) => !answer.toLowerCase().includes(term.toLowerCase()),
        ) ?? [];
    if (missing.length)
        return {
            outcome: "pending_review",
            reason: "answer_evidence_missing",
            missing,
        };
    return {
        outcome: "pending_review",
        reason: "independent_state_checked_final_faithfulness_required",
    };
}
