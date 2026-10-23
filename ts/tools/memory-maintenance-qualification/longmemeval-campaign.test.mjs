// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    campaignDecision,
    createCampaignStateWriter,
    invocationArguments,
} from "./longmemeval-campaign.mjs";

test("overlapping controller announcements publish ordered atomic state snapshots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "lme-campaign-"));
    try {
        const file = path.join(directory, "campaign.json");
        const state = { progress: 0 };
        const persist = createCampaignStateWriter(file, state);
        const publications = [];
        for (let progress = 0; progress < 30; progress++) {
            state.progress = progress;
            publications.push(persist());
        }
        await Promise.all(publications);
        assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
            progress: 29,
        });
        assert.deepEqual(await readdir(directory), ["campaign.json"]);
    } finally {
        await rm(directory, { recursive: true });
    }
});

test("campaign only resumes bounded/question-limit outcomes after clean close", () => {
    const state = (outcome, supportedClose = "COMPLETE") => ({
        outcome,
        attempts: [{ supportedClose }],
    });
    assert.equal(campaignDecision(undefined, 600000, 1000, 100), "CONTINUE");
    for (const outcome of ["PARTIAL_BOUNDED_WORK", "PARTIAL_QUESTION_LIMIT"])
        assert.equal(
            campaignDecision(state(outcome), 600000, 1000, 100),
            "CONTINUE",
        );
    for (const outcome of [
        "FAILED_REAL_BENCHMARK",
        "IN_PROGRESS",
        "FAILED_SUPPORTED_CLOSE",
    ])
        assert.equal(
            campaignDecision(state(outcome), 600000, 1000, 100),
            "STOP_FAILURE",
        );
    assert.equal(
        campaignDecision(
            state("PARTIAL_BOUNDED_WORK", "failed"),
            600000,
            1000,
            100,
        ),
        "STOP_UNCLEAN_CLOSE",
    );
    assert.equal(
        campaignDecision(
            state("FULL_500_COMPLETED_CONFIGURED_JUDGE_PROTOCOL"),
            600000,
            1000,
            100,
        ),
        "COMPLETE",
    );
});

test("overall allowance and disk reserve stop before launching another supervised worker", () => {
    assert.equal(
        campaignDecision(undefined, 479999, 1000, 100),
        "PARTIAL_ALLOWANCE",
    );
    assert.equal(
        campaignDecision(undefined, 600000, 99, 100),
        "PARTIAL_DISK_RESERVE",
    );
});

test("controller preserves frozen runner flags and reserves cleanup time", () => {
    const args = ["--authorized-live-benchmark", "--max-questions", "1"];
    assert.deepEqual(invocationArguments(args, "D:\\owned\\run", 10 * 60000), [
        ...args,
        "--work-minutes",
        "3",
        "--resume",
        "D:\\owned\\run",
    ]);
    assert.equal(
        invocationArguments(args, undefined, 120 * 60000).at(-1),
        "30",
    );
    for (const forbidden of [
        "--spec",
        "--spec=worker",
        "--resume=old",
        "--work-minutes=30",
    ])
        assert.throws(() =>
            invocationArguments([...args, forbidden], undefined, 600000),
        );
    assert.throws(
        () => invocationArguments([], undefined, 600000),
        /authorization/,
    );
    assert.throws(() => invocationArguments(args, undefined, 7 * 60000));
});
