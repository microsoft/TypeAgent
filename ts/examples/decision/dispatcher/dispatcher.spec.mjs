import assert from "node:assert/strict";
import test from "node:test";
import { catalog, cases, CLARIFY, NO_FIT } from "./fixtures.mjs";
import {
    buildQuestions,
    checkedSelection,
    eligibleSchemas,
    lexicalBaseline,
    route,
} from "./router.mjs";
import { run } from "./main.mjs";

function answer(choice, fit = 1) {
    return {
        answers: {
            route: { type: "choice", choice },
            fit: { type: "noul", noul: fit },
        },
    };
}

test("26 labels and manifest-grounded schemas", () => {
    assert.equal(cases.length, 26);
    assert.equal(new Set(cases.map((item) => item.id)).size, 26);
    for (const schema of catalog) {
        assert.ok(
            schema.description &&
                schema.schemaType &&
                schema.originalSchemaFile,
        );
    }
    assert.equal(
        lexicalBaseline("Play my jazz playlist", catalog).actual,
        "player",
    );
});

test("fit predicates independently describe eligible schemas and categories", () => {
    const schemas = eligibleSchemas(catalog).slice(0, 2);
    for (const category of [false, true]) {
        const questions = buildQuestions(schemas, category);
        const criteria = { ...questions.route.criteria };
        delete criteria[CLARIFY];
        delete criteria[NO_FIT];
        assert.ok(
            questions.fit.instructions.endsWith(JSON.stringify(criteria)),
        );
        assert.match(
            questions.fit.instructions,
            /schema routing, not action execution/,
        );
    }
});

test("exact members, missing answers, fit gate and clarification", () => {
    const questions = buildQuestions(catalog);
    assert.equal(checkedSelection(answer("email"), questions), "email");
    assert.equal(checkedSelection(answer("email", 0.1), questions), NO_FIT);
    assert.equal(checkedSelection(answer(CLARIFY, 0), questions), CLARIFY);
    for (const response of [
        answer({
            toString() {
                return "email";
            },
        }),
        answer("EMAIL"),
        answer("fake"),
        {},
        answer("email", NaN),
    ]) {
        assert.throws(() => checkedSelection(response, questions));
    }
});

test("all variants filter before the model and constrain each stage", async () => {
    const restricted = catalog.map((schema) => ({
        ...schema,
        allowed: schema.id === "player",
    }));
    assert.deepEqual(
        eligibleSchemas(restricted).map((schema) => schema.id),
        ["player"],
    );
    for (const variant of [
        "decisionChoice",
        "retrievalDecision",
        "hierarchical",
    ]) {
        const client = {
            async decide(state, questions) {
                assert.equal(state.request, "Play music");
                assert.equal(
                    Object.hasOwn(questions.route.criteria, "email"),
                    false,
                );
                assert.equal(
                    Object.hasOwn(questions.route.criteria, "productivity"),
                    false,
                );
                return answer(
                    Object.hasOwn(questions.route.criteria, "media")
                        ? "media"
                        : "player",
                );
            },
        };
        assert.equal(
            (await route("Play music", restricted, variant, client)).actual,
            "player",
        );
    }
});

test("empty eligible set, invalid category, missing and thrown responses fail closed", async () => {
    const never = {
        decide() {
            assert.fail("must not call model");
        },
    };
    assert.equal((await route("Play", [], "decisionChoice", never)).calls, 0);
    for (const response of [answer("productivity"), {}]) {
        const result = await route("Play", [catalog[3]], "hierarchical", {
            async decide() {
                return response;
            },
        });
        assert.equal(result.actual, NO_FIT);
        assert.equal(result.failed, true);
    }
    assert.equal(
        (
            await route("Play", catalog, "decisionChoice", {
                async decide() {
                    throw Error("private detail");
                },
            })
        ).reason,
        "decision-error",
    );
});

test("retrieval rejects eligible IDs omitted from its shortlist", async () => {
    const result = await route(
        "Play song playlist",
        catalog,
        "retrievalDecision",
        {
            async decide(state, questions) {
                const omitted = catalog.find(
                    (schema) =>
                        !Object.hasOwn(questions.route.criteria, schema.id),
                );
                return answer(omitted.id);
            },
        },
    );
    assert.equal(result.actual, NO_FIT);
    assert.equal(result.failed, true);
});

test("hierarchical abstention stops before schema selection", async () => {
    for (const choice of [NO_FIT, CLARIFY]) {
        let calls = 0;
        const result = await route("unspecified", catalog, "hierarchical", {
            async decide() {
                calls++;
                return answer(choice, 0);
            },
        });
        assert.equal(result.actual, choice);
        assert.equal(calls, 1);
        assert.equal(result.calls, 1);
    }
});

test("offline CLI does not call an injected client or imply real decisions", async () => {
    const logs = [];
    assert.equal(
        await run([], {
            log: (line) => logs.push(JSON.parse(line)),
            client: {
                decide() {
                    assert.fail("offline called client");
                },
            },
        }),
        0,
    );
    assert.equal(logs.length, 27);
    assert.equal(logs[0].variants.decisionChoice.reason, "offline-not-run");
    assert.equal(logs.at(-1).decisionSource, "not-run");
    for (const args of [
        ["--limit", "0"],
        ["--limit", "27"],
        ["--live", "--dry-run"],
        ["--cli-path", "unused"],
    ]) {
        await assert.rejects(run(args, { log() {} }));
    }
});

test("mock CLI labels all three lanes and contains model failures", async () => {
    const logs = [];
    const code = await run(["--live", "--limit", "1"], {
        log: (line) => logs.push(JSON.parse(line)),
        client: {
            async decide() {
                throw Error("private detail");
            },
        },
    });
    assert.equal(code, 1);
    assert.equal(logs[0].mode, "mock");
    assert.equal(logs.at(-1).failures, 3);
    assert.equal(JSON.stringify(logs).includes("private detail"), false);
});
