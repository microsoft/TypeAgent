// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { question } from "./memoryHubQuestionsTestData";
import {
    parseQuestionAssertion,
    questionAttention,
    questionIdentity,
    questionReason,
} from "./memoryHubQuestionsModel";
import { parseRoute, routeHash, readHidden } from "./memoryHubModel";
import {
    parseSchemaViewPageUri,
    schemaViewPageBrowserLink,
} from "./memoryHubViewPages";

test("inventory remains authoritative while attention is grouped, ranked and bounded", () => {
    const questions = Array.from({ length: 12 }, (_, index) =>
        question(`s${index}`, `v${index}`),
    );
    questions.push(question("s-extra", "v0"));
    questions[8].details.answerState = "conflicted";
    const before = JSON.stringify(questions);
    const groups = questionAttention(questions, {}, 0, 3);
    expect(groups).toHaveLength(3);
    expect(groups[0].questions[0].details.answerState).toBe("conflicted");
    expect(
        groups.find((group) => group.title === "v0")?.questions,
    ).toHaveLength(2);
    expect(JSON.stringify(questions)).toBe(before);
    expect(questionAttention(questions, {}, 0, 0)).toEqual([]);
});

test("dismissal and snooze survive serialization but changed fingerprints resurface", () => {
    const first = question();
    const hidden = readHidden(
        JSON.stringify({
            [questionIdentity(first)]: {
                fingerprint: first.fingerprint,
                until: 100,
            },
        }),
    );
    expect(questionAttention([first], hidden, 99)).toEqual([]);
    expect(questionAttention([first], hidden, 100)).toHaveLength(1);
    expect(
        questionAttention(
            [{ ...first, fingerprint: "new-evidence" }],
            hidden,
            99,
        ),
    ).toHaveLength(1);
});

test("rejected and settled questions do not become repeated notifications", () => {
    const rejected = question("rejected");
    rejected.slot.approval = "rejected";
    const answered = question("answered");
    answered.details.answerState = "answered";
    answered.details.reviewState = "confirmed";
    expect(questionAttention([rejected, answered], {})).toEqual([]);
    const proposal = question("proposal");
    proposal.slot.approval = "proposed";
    expect(questionReason(proposal)).toBe("Approve proposed question");
});

test("assertions validate restricted records and enum values rather than treating examples as facts", () => {
    const record = question();
    record.slot.schema = {
        type: "object",
        properties: {
            name: { type: "string", enum: ["Ada"] },
            enabled: { type: "boolean" },
        },
        required: ["name"],
    };
    expect(
        parseQuestionAssertion(record, '{"name":"Ada","enabled":true}'),
    ).toEqual({ name: "Ada", enabled: true });
    for (const invalid of [
        '{"name":"Other"}',
        '{"enabled":true}',
        '{"name":"Ada","unknown":1}',
        "null",
        "[]",
    ])
        expect(() => parseQuestionAssertion(record, invalid)).toThrow();
});

test("deterministic agent URIs preserve collection items, slots and exact revisions through wiki links", () => {
    const uri =
        "memory-view://corpus/view%2Fid?slotId=slot%2F1&itemKey=A%20%26%20B&revisionId=revision%2Fold";
    expect(parseSchemaViewPageUri(uri)).toEqual({
        corpusId: "corpus",
        viewId: "view/id",
        slotId: "slot/1",
        itemKey: "A & B",
        revisionId: "revision/old",
    });
    const route = parseRoute(schemaViewPageBrowserLink(uri));
    expect(route).toEqual({
        page: "views",
        corpusId: "corpus",
        objectId: "view/id",
        viewPageId: "slot/1",
        viewItemKey: "A & B",
        viewRevisionId: "revision/old",
    });
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(
        parseRoute(
            routeHash({ page: "questions", corpusId: "c", objectId: "view/1" }),
        ),
    ).toEqual({ page: "questions", corpusId: "c", objectId: "view/1" });
    for (const invalid of [
        "https://evil/view",
        "memory-view://c/a/b",
        "memory-view://c/v?slotId=a&slotId=b",
        "memory-view://c/v?execute=tool",
    ])
        expect(() => parseSchemaViewPageUri(invalid)).toThrow();
});
