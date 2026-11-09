// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { identity, sha256 } from "./quality-contract.mjs";
import {
    prepareQMSumQueries as prepareQMSum,
    prepareQMSum as prepareCanonicalQMSum,
    serializeQMSumTranscript,
    mapQMSumSpans,
    officialQMSumSplit,
} from "./quality-qmsum.mjs";

function fixture(split = "train") {
    const meeting = {
        meeting_transcripts: [
            { speaker: "Speaker é", content: "First\r\nline 😀." },
            { speaker: "Speaker B", content: "Middle text." },
            { speaker: "Speaker C", content: "Final Ω turn." },
        ],
        general_query_list: [
            {
                query: "Summarize the meeting.",
                answer: "GENERAL EVALUATOR ONLY",
            },
        ],
        specific_query_list: [
            {
                query: "What was discussed?",
                answer: "SPECIFIC EVALUATOR ONLY",
                relevant_text_span: [
                    ["0", "0"],
                    ["1", "2"],
                ],
            },
        ],
        topic_list: [
            { topic: "TOPIC GOLD ONLY", relevant_text_span: [["2", "2"]] },
        ],
        meeting_date: "DO NOT INFER TIME",
        project_name: "DO NOT INFER PROJECT",
    };
    const dataPath = `data/Product/jsonl/${split}.jsonl`;
    const assets = [
        {
            path: dataPath,
            bytes: Buffer.from(`${JSON.stringify(meeting)}\r\n`),
        },
        {
            path: "schema.txt",
            bytes: Buffer.from(
                "Original test evidence: zero-based inclusive turn intervals.",
            ),
        },
    ];
    const plan = {
        schemaVersion: 1,
        dataset: "qmsum-product",
        custody: split === "train" ? "development" : "confirmation-evaluator",
        release: {
            repository: "https://example.org/original-fixture",
            revision: "a".repeat(40),
            files: assets.map(({ path, bytes }) => ({
                path,
                sha256: sha256(bytes),
            })),
            license: {
                id: "original-fixture",
                terms: "Original data repository terms",
                reviewed: true,
                underlying: [
                    {
                        id: "original-meeting-fixture",
                        terms: "Original meeting text",
                        reviewed: true,
                    },
                ],
            },
        },
        selection: [
            {
                path: dataPath,
                recordIndex: 0,
                split: split === "train" ? "development" : "confirmation",
            },
        ],
        spanConvention: {
            kind: "zero-based-inclusive",
            evidenceVerified: true,
            evidencePath: "schema.txt",
            evidenceSha256: sha256(assets[1].bytes),
        },
    };
    return { meeting, assets, plan };
}

function replaceMeeting(f, mutate) {
    mutate(f.meeting);
    f.assets[0].bytes = Buffer.from(`${JSON.stringify(f.meeting)}\n`);
    f.plan.release.files[0].sha256 = sha256(f.assets[0].bytes);
}

function canonicalFixture() {
    const f = fixture();
    const ids = ["ES2002b", "IS1008d", "ES2002a"];
    const meetings = ids.map((id) => ({
        ...structuredClone(f.meeting),
        meeting_transcripts: [
            {
                speaker: "Designer",
                content: `${id}: remote control design discussion.`,
            },
        ],
        specific_query_list: [
            {
                query: "Describe design choices.",
                answer: "SPECIFIC EVALUATOR ONLY",
                relevant_text_span: [["0", "0"]],
            },
        ],
    }));
    const dataPath = f.assets[0].path;
    f.assets[0].bytes = Buffer.from(
        meetings.map((meeting) => JSON.stringify(meeting)).join("\n") + "\n",
    );
    for (let index = 0; index < ids.length; index++)
        f.assets.push({
            path: `data/Product/train/${ids[index]}.json`,
            bytes: Buffer.from(JSON.stringify(meetings[index])),
        });
    f.assets.push({
        path: "project-order.txt",
        bytes: Buffer.from(
            "Reviewed AMI scenario series and a-d sequence; no wall-clock dates.",
        ),
    });
    f.plan.release.files = f.assets.map(({ path, bytes }) => ({
        path,
        sha256: sha256(bytes),
    }));
    f.plan.selection = ids.map((id, recordIndex) => ({
        path: dataPath,
        recordIndex,
        split: "development",
        meetingIdentityPath: `data/Product/train/${id}.json`,
    }));
    f.plan.projectGrouping = {
        kind: "ami-scenario-series",
        evidenceVerified: true,
        evidencePath: "project-order.txt",
        evidenceSha256: sha256(f.assets.at(-1).bytes),
    };
    return f;
}

test("canonical QMSum groups exact identities, orders meetings and keeps queries evaluator-only", () => {
    const f = canonicalFixture();
    const before = identity(f);
    const result = prepareCanonicalQMSum(f.assets, f.plan);
    assert.equal(identity(f), before);
    assert.deepEqual(result, prepareCanonicalQMSum(f.assets, f.plan));
    assert.equal(result.construction.bundles.length, 2);
    const [project, other] = result.construction.bundles;
    assert.equal(project.id, "qmsum-ami-es2002");
    assert.equal(other.id, "qmsum-ami-is1008");
    assert.deepEqual(project.project.meetingIds, [
        "qmsum-ami-es2002a",
        "qmsum-ami-es2002b",
    ]);
    assert.deepEqual(
        project.sources.map((source) => source.provenance.sequence),
        [1, 2],
    );
    assert.ok(
        project.sources.every((source) => source.authoredAt === undefined),
    );
    assert.match(project.sources[0].text, /ES2002a: remote control/);
    assert.equal(result.manifest.cases.length, 2);
    assert.equal(result.manifest.queryVariants.length, 6);
    assert.equal(result.evaluator.cases.length, 6);
    assert.doesNotMatch(
        JSON.stringify(result.construction),
        /EVALUATOR|TOPIC GOLD|DO NOT INFER|Describe design choices/,
    );
    assert.match(JSON.stringify(result.evaluator), /SPECIFIC EVALUATOR ONLY/);
    assert.ok(
        result.evaluator.cases.every((query) =>
            result.construction.bundles
                .find((bundle) => bundle.id === query.canonicalViewId)
                .sources.some(
                    (source) => source.id === query.witnesses[0].sourceId,
                ),
        ),
    );
});

test("canonical project and meeting IDs survive release changes, reordered selection and appended meetings", () => {
    const f = canonicalFixture();
    const initial = prepareCanonicalQMSum(f.assets, f.plan);
    f.plan.release.revision = "b".repeat(40);
    f.plan.selection.reverse();
    const refreshed = prepareCanonicalQMSum(f.assets, f.plan);
    assert.deepEqual(
        refreshed.construction.bundles.map((bundle) => ({
            id: bundle.id,
            project: bundle.project,
        })),
        initial.construction.bundles.map((bundle) => ({
            id: bundle.id,
            project: bundle.project,
        })),
    );
    f.plan.selection = f.plan.selection.filter(
        (selected) => selected.recordIndex !== 0,
    );
    const earlier = prepareCanonicalQMSum(f.assets, f.plan);
    assert.equal(
        earlier.construction.bundles[0].id,
        initial.construction.bundles[0].id,
    );
    assert.equal(earlier.construction.bundles[0].sources.length, 1);
    assert.equal(initial.construction.bundles[0].sources.length, 2);
});

test("canonical grouping refuses missing/unverified evidence, mismatched originals and duplicate identities", () => {
    for (const [mutate, expected] of [
        [
            (f) => {
                delete f.plan.projectGrouping;
            },
            /verified AMI project grouping/,
        ],
        [
            (f) => {
                f.plan.projectGrouping.evidenceVerified = false;
            },
            /verified AMI project grouping/,
        ],
        [
            (f) => {
                f.plan.projectGrouping.evidenceSha256 = "b".repeat(64);
            },
            /grouping evidence hash mismatch/,
        ],
        [
            (f) => {
                delete f.plan.selection[0].meetingIdentityPath;
            },
            /asset path/,
        ],
        [
            (f) => {
                f.plan.selection[0].meetingIdentityPath =
                    f.plan.selection[1].meetingIdentityPath;
            },
            /does not match/,
        ],
    ]) {
        const f = canonicalFixture();
        mutate(f);
        assert.throws(() => prepareCanonicalQMSum(f.assets, f.plan), expected);
    }
    const f = canonicalFixture();
    const rows = f.assets[0].bytes.toString("utf8").trim().split("\n");
    rows.push(rows[0]);
    f.assets[0].bytes = Buffer.from(rows.join("\n") + "\n");
    f.plan.release.files[0].sha256 = sha256(f.assets[0].bytes);
    f.plan.selection.push({ ...f.plan.selection[0], recordIndex: 3 });
    assert.throws(
        () => prepareCanonicalQMSum(f.assets, f.plan),
        /Duplicate canonical meeting identity/,
    );
});

test("QMSum emits all queries with complete meeting, exact packet shape and no gold leakage", () => {
    const f = fixture();
    const before = identity(f);
    const result = prepareQMSum(f.assets, f.plan);
    assert.deepEqual(result, prepareQMSum(f.assets, f.plan));
    assert.equal(identity(f), before);
    assert.deepEqual(Object.keys(result.construction), [
        "schemaVersion",
        "purpose",
        "dataset",
        "release",
        "bundles",
    ]);
    assert.equal(result.construction.bundles.length, 2);
    const [general, specific] = result.construction.bundles;
    assert.deepEqual(Object.keys(general), [
        "id",
        "kind",
        "query",
        "aliases",
        "sources",
    ]);
    assert.equal(general.kind, "projectBrief");
    assert.deepEqual(general.sources, specific.sources);
    assert.equal(general.query, f.meeting.general_query_list[0].query);
    assert.equal(specific.query, f.meeting.specific_query_list[0].query);
    assert.doesNotMatch(
        JSON.stringify(result.construction),
        /EVALUATOR|TOPIC GOLD|DO NOT INFER|relevant_text_span|answer/,
    );
    assert.equal(result.evaluator.cases[0].answer, "GENERAL EVALUATOR ONLY");
    assert.equal(result.evaluator.cases[1].topics[0].topic, "TOPIC GOLD ONLY");
    assert.equal(
        result.manifest.cases[0].clusterId,
        result.manifest.cases[1].clusterId,
    );
    assert.equal(result.manifest.cases[0].officialSplit, "train");
    assert.equal(result.manifest.evaluatorHash, identity(result.evaluator));
    assert.equal(general.sources[0].authoredAt, undefined);
    assert.equal(general.sources[0].provenance.chronology, "unknown");
    assert.equal(general.sources[0].provenance.titleOrigin, "adapter-context");
});

test("QMSum UTF16 maps preserve exact CRLF, nonASCII, speakers and surrogate pairs", () => {
    const f = fixture();
    const result = prepareQMSum(f.assets, f.plan);
    const source = result.construction.bundles[0].sources[0];
    assert.equal(
        source.text,
        "[0] Speaker é\nFirst\r\nline 😀.\n\n[1] Speaker B\nMiddle text.\n\n[2] Speaker C\nFinal Ω turn.\n\n",
    );
    assert.equal(source.sha256, sha256(Buffer.from(source.text, "utf8")));
    assert.notEqual(source.sha256, sha256(f.assets[0].bytes));
    for (const mapping of source.coordinateMap) {
        const { turn, field, start, end } = mapping.coordinate;
        assert.equal(
            source.text.slice(mapping.retainedStart, mapping.retainedEnd),
            f.meeting.meeting_transcripts[turn][field].slice(start, end),
        );
        assert.equal(mapping.retainedEnd - mapping.retainedStart, end - start);
    }
    const first = source.coordinateMap.find(
        (mapping) => mapping.coordinate.field === "content",
    );
    const emojiOffset = f.meeting.meeting_transcripts[0].content.indexOf("😀");
    assert.equal(
        source.text.slice(
            first.retainedStart + emojiOffset,
            first.retainedStart + emojiOffset + 2,
        ),
        "😀",
    );
    assert.equal(result.evaluator.cases[0].witnesses[0].quote, source.text);
});

test("QMSum maps every inclusive span, including final turn, to retained witnesses", () => {
    const f = fixture();
    const result = prepareQMSum(f.assets, f.plan);
    const source = result.construction.bundles[1].sources[0];
    const witnesses = result.evaluator.cases[1].witnesses;
    assert.equal(witnesses.length, 2);
    assert.equal(witnesses[0].quote, "[0] Speaker é\nFirst\r\nline 😀.");
    assert.equal(
        witnesses[1].quote,
        "[1] Speaker B\nMiddle text.\n\n[2] Speaker C\nFinal Ω turn.",
    );
    for (const witness of witnesses) {
        assert.equal(
            witness.quote,
            source.text.slice(witness.start, witness.end),
        );
        assert.equal(witness.version, source.version);
        assert.equal(witness.sha256, source.sha256);
        assert.equal(witness.turnSpan.convention, "zero-based-inclusive");
    }
    const serialized = serializeQMSumTranscript(f.meeting.meeting_transcripts);
    const last = mapQMSumSpans([[2, 2]], source, serialized.turnMap)[0];
    assert.equal(last.quote, "[2] Speaker C\nFinal Ω turn.");
    for (const spans of [
        [],
        [[0, 3]],
        [[-1, 1]],
        [[2, 1]],
        [[0.5, 1]],
        [["01", "2"]],
        [[0]],
        [[null, 1]],
        [["9007199254740992", "9007199254740992"]],
    ]) {
        assert.throws(
            () => mapQMSumSpans(spans, source, serialized.turnMap),
            /span|Span/,
        );
    }
});

test("QMSum never caps transcript or uses relevant-turn gold to select construction", () => {
    const f = fixture();
    replaceMeeting(f, (meeting) => {
        meeting.meeting_transcripts[1].content = "Retain ".repeat(3000);
        meeting.specific_query_list[0].relevant_text_span = [["2", "2"]];
    });
    const result = prepareQMSum(f.assets, f.plan);
    const source = result.construction.bundles[1].sources[0];
    assert.ok(source.text.includes("Retain ".repeat(3000)));
    assert.match(source.text, /First\r\nline 😀/);
    assert.match(source.text, /Final Ω turn/);
    assert.equal(result.evaluator.cases[1].witnesses.length, 1);
});

test("QMSum retains official splits and entire-meeting clustering; test is unused", () => {
    const train = fixture();
    const val = fixture("val");
    const result = prepareQMSum(val.assets, val.plan);
    assert.ok(
        result.manifest.cases.every(
            (row) =>
                row.split === "confirmation" && row.officialSplit === "val",
        ),
    );
    assert.notEqual(
        result.construction.bundles[0].id,
        prepareQMSum(train.assets, train.plan).construction.bundles[0].id,
    );
    const testData = fixture("test");
    assert.throws(
        () => prepareQMSum(testData.assets, testData.plan),
        /Official meeting split\/custody mismatch; test remains unused/,
    );
    train.plan.selection[0].path = "data/Product/jsonl/val.jsonl";
    assert.throws(
        () => prepareQMSum(train.assets, train.plan),
        /Official meeting split\/custody mismatch/,
    );
    assert.equal(
        officialQMSumSplit("data\\Product\\jsonl\\train.jsonl"),
        "train",
    );
    assert.throws(
        () => officialQMSumSplit("data/ALL/jsonl/train.jsonl"),
        /official QMSum Product/,
    );
});

test("QMSum rejects absent source, missing queries, malformed transcripts/spans and unverified terms", () => {
    const cases = [
        [
            (f) => {
                delete f.plan.spanConvention;
            },
            /Pinned evidence/,
        ],
        [
            (f) => {
                f.plan.spanConvention.kind = "exclusive";
            },
            /Pinned evidence/,
        ],
        [
            (f) => {
                f.plan.spanConvention.evidenceVerified = false;
            },
            /evidence verification required/,
        ],
        [
            (f) => {
                f.plan.spanConvention.evidenceSha256 = "b".repeat(64);
            },
            /evidence hash mismatch/,
        ],
        [
            (f) => {
                delete f.plan.release.license.underlying;
            },
            /Underlying QMSum meeting corpus terms review required/,
        ],
        [
            (f) => {
                f.plan.release.license.underlying[0].reviewed = false;
            },
            /terms review required/,
        ],
        [
            (f) => {
                f.plan.selection[0].recordIndex = 1;
            },
            /Selected meeting record absent/,
        ],
        [
            (f) => {
                replaceMeeting(f, (m) => {
                    m.meeting_transcripts = [];
                });
            },
            /Complete nonempty meeting transcript required/,
        ],
        [
            (f) => {
                replaceMeeting(f, (m) => {
                    delete m.meeting_transcripts[0].speaker;
                });
            },
            /turn speaker: required text/,
        ],
        [
            (f) => {
                replaceMeeting(f, (m) => {
                    m.meeting_transcripts[0].content = null;
                });
            },
            /well-formed text/,
        ],
        [
            (f) => {
                replaceMeeting(f, (m) => {
                    delete m.specific_query_list;
                });
            },
            /specific query list required/,
        ],
        [
            (f) => {
                replaceMeeting(f, (m) => {
                    delete m.specific_query_list[0].answer;
                });
            },
            /Reference answer required/,
        ],
        [
            (f) => {
                replaceMeeting(f, (m) => {
                    m.specific_query_list[0].relevant_text_span = [[0, 3]];
                });
            },
            /out of bounds/,
        ],
        [
            (f) => {
                f.assets[0].bytes = Buffer.from("{}\n\n");
                f.plan.release.files[0].sha256 = sha256(f.assets[0].bytes);
            },
            /Blank QMSum JSONL record/,
        ],
    ];
    for (const [mutate, message] of cases) {
        const f = fixture();
        mutate(f);
        assert.throws(() => prepareQMSum(f.assets, f.plan), message);
    }
});

test("QMSum stable record-position identity does not use filenames or invented project metadata", () => {
    const f = fixture();
    const second = structuredClone(f.meeting);
    second.general_query_list[0].answer = "OTHER ANSWER";
    f.assets[0].bytes = Buffer.from(
        `${JSON.stringify(f.meeting)}\n${JSON.stringify(second)}\n`,
    );
    f.plan.release.files[0].sha256 = sha256(f.assets[0].bytes);
    f.plan.selection.push({ ...f.plan.selection[0], recordIndex: 1 });
    const result = prepareQMSum(f.assets, f.plan);
    assert.equal(result.construction.bundles.length, 4);
    assert.notEqual(
        result.manifest.cases[0].clusterId,
        result.manifest.cases[2].clusterId,
    );
    assert.match(result.construction.bundles[2].id, /:train:1:general:0$/);
    assert.equal(
        new Set(
            result.construction.bundles.map((bundle) => bundle.sources[0].id),
        ).size,
        2,
    );
});
