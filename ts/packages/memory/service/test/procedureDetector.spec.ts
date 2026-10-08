// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { detectProcedureCandidates } from "../src/procedureDetector.js";
import {
    procedureFromMarkdown,
    procedureToMarkdown,
} from "../src/procedureMarkdown.js";

const detect = (content: string) =>
    detectProcedureCandidates("corpus", "source", "revision", content);
const cases = [
    [
        "S01 canary: preflight, mutating-command guard, verification and rollback",
        "scenario-01-aks-canary.md",
        "aks get-credentials",
        "rollout status",
        "Rollback or recovery",
    ],
    [
        "S02 Key Vault: metadata-only diagnosis, correction and recovery",
        "scenario-02-key-vault-5xx.md",
        "secret-value",
        "authentication succeeds",
        "Rollback or recovery",
    ],
    [
        "S03 Service Bus: depth versus flow, scale guard and poison isolation",
        "scenario-03-service-bus-backlog.md",
        "scale ceiling",
        "DeadletteredMessages",
        "Do not replay",
    ],
    [
        "S04 SQL: server versus pool pressure, multiline queries and recovery",
        "scenario-04-sql-latency.md",
        "SQL text or parameters",
        "percentile(DurationMs, 95)",
        "1.85 seconds",
    ],
    [
        "S05 IR-7421: evidence preservation, hypothesis correction and handoff",
        "scenario-05-ir-7421.md",
        "Approved containment procedure",
        "no signing key",
        "Verification",
    ],
];

describe("deterministic guide extraction (no model or reviewer/gold inputs)", () => {
    test.each(cases)("%s", async (_label, file, ...required) => {
        const content = await readFile(
            new URL(`../../test/data/guides/${file}`, import.meta.url),
            "utf8",
        );
        const candidates = detect(content);
        expect(candidates).toHaveLength(1);
        const candidate = candidates[0];
        expect(candidate.title).toMatch(/^Guide:/);
        expect(candidate.steps.length).toBeGreaterThanOrEqual(5);
        const rendered = procedureToMarkdown(candidate);
        for (const value of required) expect(rendered).toContain(value);
        expect(rendered).toContain("## Prerequisites");
        expect(rendered).toContain("## Verification");
        expect(rendered).toContain("## Rollback or recovery");
        expect(candidate.steps.join("\n")).toContain("```");
        const citation = candidate.citations[0];
        const offsets = /^chars:(\d+)-(\d+)$/.exec(citation.locator!)!;
        expect(content.slice(Number(offsets[1]), Number(offsets[2]))).toBe(
            citation.excerpt,
        );
        expect(procedureFromMarkdown(rendered)).toMatchObject({
            steps: candidate.steps,
            additionalSections: candidate.additionalSections,
            citations: candidate.citations,
        });
        expect(detect(content)).toEqual(candidates);
    });

    test.each(["\n", "\r\n", "\r"])(
        "UTF-16 end-exclusive offsets preserve %j source bytes",
        (newline) => {
            const content = [
                "Preamble \u{1F680}",
                "# How to inspect",
                "1. Open console.",
                "   Preserve the continuation.",
                "   ```powershell",
                "   # Install is code, not a heading",
                "   command `",
                "     --flag",
                "   ```",
                "2. Verify.",
                "# Unrelated notes",
                "Do not include this.",
            ].join(newline);
            const [candidate] = detect(content);
            expect(candidate.steps).toHaveLength(2);
            expect(candidate.steps[0]).toContain("--flag");
            expect(candidate.steps.join("")).not.toContain("Unrelated");
            const citation = candidate.citations[0];
            const expectedStart = content.indexOf("# How to inspect");
            const expectedEnd = content.indexOf("# Unrelated notes");
            expect(citation.locator).toBe(
                `chars:${expectedStart}-${expectedEnd}`,
            );
            expect(citation.excerpt).toBe(
                content.slice(expectedStart, expectedEnd),
            );
        },
    );

    test("ordinary commands and recovery continuations never become titles", () => {
        const content =
            "# How to recover\n1. Check.\n   Configure the application to use this setting.\n2. Recover.\n   Install the current package before retrying.\n\nRollback means restoring the old setup.";
        const [candidate] = detect(content);
        expect(candidate.title).toBe("How to recover");
        expect(candidate.steps[0]).toContain("Configure the application");
        expect(candidate.steps[1]).toContain("Install the current package");
        expect(
            detect(
                "Configure the service.\n1. This is an example.\n2. Not a task heading.",
            ),
        ).toEqual([]);
    });

    test.each(["```markdown", "~~~~markdown"])(
        "ignores entire %s fenced examples",
        (fence) => {
            const content = `${fence}\n# How to install\n1. First\n2. Second\n${fence.replace("markdown", "")}\n# Status\nEverything is healthy.`;
            expect(detect(content)).toEqual([]);
        },
    );

    test("retains task boundaries rather than collecting every numbered line", () => {
        const [first, second] = detect(
            "# How to diagnose\n1. Inspect.\n2. Verify.\n# How to recover\n1. Restore.\n2. Observe.",
        );
        expect(first.steps).toEqual(["Inspect.", "Verify."]);
        expect(second.steps).toEqual(["Restore.", "Observe."]);
    });

    test("task-local prerequisites and parent-scope verification are retained and exactly cited", () => {
        const content =
            "# Calibration reference\nRead access is required. Stop if the baseline differs.\n\n## How to calibrate\nUse an isolated bus.\n\n1. Measure.\n2. Verify.\n\n## Expected result\nAgreement within tolerance.\n\n# Other reference\nDo not include this.";
        const [candidate] = detect(content);
        const rendered = procedureToMarkdown(candidate);
        expect(rendered).toContain("Read access is required");
        expect(rendered).toContain("Use an isolated bus");
        expect(rendered).toContain("Agreement within tolerance");
        expect(rendered).not.toContain("Do not include this");
        for (const citation of candidate.citations) {
            const match = /^chars:(\d+)-(\d+)$/.exec(citation.locator!)!;
            expect(content.slice(Number(match[1]), Number(match[2]))).toBe(
                citation.excerpt,
            );
        }
    });

    test.each([
        "# Procedure\n1. One step only.",
        "# Meeting notes\n1. Alice attended.\n2. Bob attended.",
        "# Checklist\n- Ordinary bullet\n- Another bullet",
        "Run the setup command:\n1. Example output.\n2. More output.",
    ])("nonprocedural/single-step negative: %s", (content) => {
        expect(detect(content)).toEqual([]);
    });
});
