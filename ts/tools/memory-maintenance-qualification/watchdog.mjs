// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { validateSpec, writeJson } from "./harness.mjs";
import {
    alive,
    supervise as superviseOwned,
    validateAdmission,
    workerArguments,
    workerDeadline,
} from "../../packages/benchmarks/src/memoryBench/shared/supervisor.mjs";
export { alive, validateAdmission, workerArguments, workerDeadline };
export const supervise = (
    spec,
    worker = path.join(import.meta.dirname, "harness.mjs"),
    validator = validateSpec,
) => superviseOwned(spec, worker, validator);

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            fixtures: { type: "string" },
            output: { type: "string" },
            resume: { type: "string" },
            startup: { type: "string", default: "120000" },
            work: { type: "string", default: "1200000" },
            help: { type: "boolean" },
            "crash-stage": { type: "string" },
            p6: { type: "boolean" },
            performance: { type: "boolean" },
            qualification: { type: "boolean" },
            checkpoint: { type: "string" },
            "no-native-profile": { type: "boolean" },
            "stop-initial-failure": { type: "boolean" },
        },
    });
    if (values.help) {
        process.stdout.write(
            "OFFLINE only: --product <ts root> --fixtures <read-only memoryDemo> [--output <existing artifacts parent>] [--startup <ms>] [--work <ms>] [--p6] [--crash-stage t1]. Performance requires --performance --checkpoint <explicit name/hashes JSON>; optional --no-native-profile --stop-initial-failure. Full stages/mechanisms: --qualification --checkpoint <same explicit JSON> --no-native-profile, first unexpected terminal failure stops with normal cleanup. P6 crash is post-canonical/pre-redirect/index/ack. Resume: --resume <owned run directory> with unchanged --p6/--qualification/checkpoint. No model-role flags or implicit user stores.\n",
        );
    } else {
        assert.ok(
            values.product && values.fixtures,
            "--product and --fixtures required",
        );
        let runDirectory;
        let receiptId;
        if (values.resume) {
            runDirectory = await realpath(values.resume);
            const owner = JSON.parse(
                await readFile(
                    path.join(runDirectory, "ownership.json"),
                    "utf8",
                ),
            );
            receiptId = owner.receiptId;
        } else {
            runDirectory = await mkdtemp(
                path.join(
                    await realpath(values.output ?? os.tmpdir()),
                    "memory-maintenance-qualification-",
                ),
            );
            receiptId = randomUUID();
            await writeJson(path.join(runDirectory, "ownership.json"), {
                receiptId,
                runDirectory,
            });
        }
        const spec = {
            receiptId,
            mode: "offline",
            runDirectory,
            resume: !!values.resume,
            p6: !!values.p6 || !!values.performance || !!values.qualification,
            performance: !!values.performance,
            qualification: !!values.qualification,
            nativeProfile: !values["no-native-profile"],
            stopInitialFailure: !!values["stop-initial-failure"],
            ...(values.checkpoint
                ? {
                      expectedCheckpoint: JSON.parse(
                          await readFile(
                              await realpath(values.checkpoint),
                              "utf8",
                          ),
                      ),
                  }
                : {}),
            productRoot: await realpath(values.product),
            fixtureRoot: await realpath(values.fixtures),
            startupAllowanceMs: Number(values.startup),
            workAllowanceMs: Number(values.work),
            ...(values["crash-stage"]
                ? { crashStage: values["crash-stage"] }
                : {}),
        };
        const receipt = await supervise(spec);
        process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
        if (receipt.outcome !== "WORKER_COMPLETED") process.exitCode = 1;
    }
}
