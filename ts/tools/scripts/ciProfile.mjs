// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import { parseArgs } from "node:util";
import {
    azureTimelineTiming,
    profileLog,
    profileMarker,
    stageMeasurement,
} from "./lib/ciProfile.mjs";

const [command, ...args] = process.argv.slice(2);
if (command === "record") {
    assert.equal(
        args.length,
        3,
        "record requires stage, elapsed milliseconds, and exit code",
    );
    const [stage, elapsed, exit] = args;
    assert.match(elapsed, /^\d+(?:\.\d+)?$/);
    assert.match(exit, /^-?\d+$/);
    assert.ok(
        Number.isSafeInteger(Number(exit)),
        "Exit code must be a safe integer",
    );
    const observation = stageMeasurement(
        stage,
        Number(elapsed),
        Number(exit) === 0 ? "success" : "failure",
    );
    observation.exitCode = Number(exit);
    process.stdout.write(`${profileMarker}${JSON.stringify(observation)}\n`);
} else {
    assert.equal(command, "report", "Expected record or report");
    const { values } = parseArgs({
        args,
        options: {
            log: { type: "string" },
            "azure-build": { type: "string" },
            "azure-timeline": { type: "string" },
        },
    });
    assert.ok(
        values.log || values["azure-build"],
        "Provide --log or --azure-build/--azure-timeline",
    );
    assert.equal(
        Boolean(values["azure-build"]),
        Boolean(values["azure-timeline"]),
    );
    const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
    process.stdout.write(
        `${JSON.stringify(
            {
                profile: values.log
                    ? profileLog(fs.readFileSync(values.log, "utf8"))
                    : null,
                azure: values["azure-build"]
                    ? azureTimelineTiming(
                          json(values["azure-build"]),
                          json(values["azure-timeline"]),
                      )
                    : null,
                limitations: [
                    "Task timings overlap; their sum is not a dependency-graph critical path.",
                    "Composite-step observations are nested within setup/job durations and must not be added again.",
                    "Native-cache state does not establish whether the ordinary package-store cache was cold.",
                    "One control/candidate pair is qualification evidence, not a statistically established speedup.",
                ],
            },
            null,
            2,
        )}\n`,
    );
}
