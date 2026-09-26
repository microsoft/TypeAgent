// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { grammarToJson, loadGrammarRules } from "@typeagent/action-grammar";
import {
    LiveSkillCatalog,
    type SkillIdentity,
    type SkillPackageInput,
} from "../src/index.js";
import { MemoryStorage } from "./memoryStorage.js";

function identity(name: string): SkillIdentity {
    return { scope: "project", origin: "test-project", name };
}

function input(
    skill: SkillIdentity,
    utterance: string,
    actionName: string,
): SkillPackageInput {
    const grammar = loadGrammarRules(
        `${skill.name}.agr`,
        `<Start> = ${utterance} -> { actionName: "${actionName}" };`,
    );
    return {
        identity: skill,
        schemaFingerprint: "schema-1",
        files: [
            {
                path: "routing/main.ag.json",
                content: JSON.stringify(grammarToJson(grammar)),
            },
        ],
    };
}

async function approveAndActivate(
    live: LiveSkillCatalog,
    packageInput: SkillPackageInput,
) {
    const entry = await live.publish(packageInput);
    await live.transition(
        entry.revision.identity,
        entry.revision.revision,
        "validated",
    );
    await live.transition(
        entry.revision.identity,
        entry.revision.revision,
        "approved",
    );
    await live.activate(entry.revision.identity, entry.revision.revision);
    return entry;
}

describe("LiveSkillCatalog", () => {
    it("loads package grammar artifacts and ranks a unique match first", async () => {
        const live = await LiveSkillCatalog.create(new MemoryStorage());
        const music = identity("music");
        const entry = await approveAndActivate(
            live,
            input(music, "pause the music", "pause"),
        );

        const results = await live.search({ text: "pause the music" });

        expect(results[0]).toMatchObject({
            source: "grammar",
            score: 2,
            entry: {
                active: true,
                revision: { revision: entry.revision.revision },
            },
            routing: {
                outcome: {
                    status: "match",
                    candidate: {
                        ruleSource: "package",
                        value: { actionName: "pause" },
                    },
                },
            },
        });
    });

    it("gives an exact correction precedence over a package rule", async () => {
        const live = await LiveSkillCatalog.create(new MemoryStorage());
        const music = identity("music");
        const entry = await approveAndActivate(
            live,
            input(music, "pause", "packagePause"),
        );
        const correctionGrammar = loadGrammarRules(
            "correction.agr",
            `<Start> = pause -> { actionName: "correctedPause" };`,
        );
        await live.addCorrection({
            skill: music,
            skillRevision: entry.revision.revision,
            schemaFingerprint: entry.revision.schemaFingerprint,
            grammar: grammarToJson(correctionGrammar),
        });

        const routing = await live.routeGrammar("pause");

        expect(routing.outcome.status).toBe("match");
        if (routing.outcome.status === "match") {
            expect(routing.outcome.candidate.ruleSource).toBe("userCorrection");
            expect(routing.outcome.candidate.value).toEqual({
                actionName: "correctedPause",
            });
        }
    });

    it("falls back to catalog search on ambiguous and invalid matches", async () => {
        const storage = new MemoryStorage();
        const ambiguous = await LiveSkillCatalog.create(storage);
        await approveAndActivate(
            ambiguous,
            input(identity("calendar"), "calendar", "first"),
        );
        await approveAndActivate(
            ambiguous,
            input(identity("other"), "calendar", "second"),
        );

        const ambiguousResults = await ambiguous.search({ text: "calendar" });
        expect(ambiguousResults[0]).toMatchObject({
            source: "exact",
            routing: { outcome: { status: "ambiguous" } },
        });

        const invalid = await LiveSkillCatalog.create(new MemoryStorage(), {
            validate: (_skill, _fingerprint, value) => ({
                valid:
                    (value as { actionName?: string }).actionName !== "invalid",
                errors: ["invalid action"],
            }),
        });
        await approveAndActivate(
            invalid,
            input(identity("invalid request"), "invalid request", "invalid"),
        );
        const invalidResults = await invalid.search({
            text: "invalid request",
        });
        expect(invalidResults[0]).toMatchObject({
            source: "exact",
            routing: {
                outcome: { status: "invalid", errors: ["invalid action"] },
            },
        });
    });

    it("removes stale revision grammars and corrections after activation", async () => {
        const live = await LiveSkillCatalog.create(new MemoryStorage());
        const music = identity("music");
        const first = await approveAndActivate(
            live,
            input(music, "old phrase", "old"),
        );
        const correction = loadGrammarRules(
            "old-correction.agr",
            `<Start> = corrected old phrase -> { actionName: "oldCorrection" };`,
        );
        await live.addCorrection({
            skill: music,
            skillRevision: first.revision.revision,
            schemaFingerprint: first.revision.schemaFingerprint,
            grammar: grammarToJson(correction),
        });
        await approveAndActivate(live, input(music, "new phrase", "new"));

        expect((await live.routeGrammar("old phrase")).outcome.status).toBe(
            "miss",
        );
        expect(
            (await live.routeGrammar("corrected old phrase")).outcome.status,
        ).toBe("miss");
        expect((await live.routeGrammar("new phrase")).outcome.status).toBe(
            "match",
        );
    });

    it("rebuilds the same deterministic snapshot after restart", async () => {
        const storage = new MemoryStorage();
        const first = await LiveSkillCatalog.create(storage);
        await approveAndActivate(
            first,
            input(identity("music"), "resume music", "resume"),
        );
        const firstSnapshot = first.getCurrentSnapshot();

        const restarted = await LiveSkillCatalog.create(storage);
        const restartedSnapshot = restarted.getCurrentSnapshot();

        expect(restartedSnapshot.snapshotId).toBe(firstSnapshot.snapshotId);
        expect(restartedSnapshot.activeRevisions).toEqual(
            firstSnapshot.activeRevisions,
        );
        expect(
            (await restarted.routeGrammar("resume music")).outcome.status,
        ).toBe("match");
        expect(
            storage.values.has(
                `skill-catalog/v1/routing/snapshots/${firstSnapshot.snapshotId}.json`,
            ),
        ).toBe(true);
    });

    it("retains artifact diagnostics while falling back", async () => {
        const live = await LiveSkillCatalog.create(new MemoryStorage());
        const broken = identity("broken");
        await approveAndActivate(live, {
            identity: broken,
            schemaFingerprint: "schema-1",
            files: [
                {
                    path: "routing/broken.ag.json",
                    content: "{not-json",
                },
            ],
        });

        const results = await live.search({ text: "broken" });

        expect(results[0]).toMatchObject({
            source: "exact",
            routing: {
                outcome: { status: "miss" },
                diagnostics: [
                    expect.objectContaining({
                        code: "artifactParse",
                        path: "routing/broken.ag.json",
                    }),
                ],
            },
        });
    });
});
