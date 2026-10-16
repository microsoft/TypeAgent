// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const planBytes = fs.readFileSync(
    process.env.TYPEAGENT_NATIVE_SERVICE_MODULE_PLAN,
);
if (
    typeof process.send !== "function" ||
    digest(planBytes) !==
        process.env.TYPEAGENT_NATIVE_SERVICE_MODULE_PLAN_SHA256
)
    throw new Error(
        "Native service module observer has no owned launch binding",
    );
const plan = JSON.parse(planBytes);
const observerPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (
    observerPath !== plan.observer.file ||
    digest(fs.readFileSync(observerPath)) !== plan.observer.sha256 ||
    process.execPath !== plan.nodeExecutable ||
    process.argv[1] !== plan.serviceEntry
)
    throw new Error("Native service module observer launch/source changed");
const modules = new Map(
    plan.modules.map((entry) => [pathToFileURL(entry.realPath).href, entry]),
);
if (
    modules.size !== 5 ||
    new Set(plan.modules.map((entry) => entry.role)).size !== 5
)
    throw new Error(
        "Native service module observer requires five distinct modules",
    );

registerHooks({
    load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        const withoutQuery = new URL(url);
        withoutQuery.search = "";
        withoutQuery.hash = "";
        const entry =
            withoutQuery.href === pathToFileURL(plan.serviceEntry).href;
        const expected = entry
            ? {
                  role: "normal-service-entry",
                  realPath: plan.serviceEntry,
                  sha256: plan.serviceEntrySha256,
                  sizeBytes: plan.serviceEntrySizeBytes,
              }
            : modules.get(withoutQuery.href);
        if (!expected) return result;
        if (
            url !== pathToFileURL(expected.realPath).href ||
            fs.realpathSync(fileURLToPath(url)) !== expected.realPath ||
            result.format !== "module" ||
            (typeof result.source !== "string" &&
                !ArrayBuffer.isView(result.source))
        )
            throw new Error(
                "Native service module load path/format/source changed",
            );
        const bytes = Buffer.from(result.source);
        if (
            digest(bytes) !== expected.sha256 ||
            digest(fs.readFileSync(expected.realPath)) !== expected.sha256
        )
            throw new Error(
                "Native service module load bytes differ from qualification",
            );
        process.send({
            kind: entry
                ? "native-workiq-service-entry-load-v1"
                : "native-workiq-service-module-load-v1",
            owner: plan.owner,
            ownedRoot: plan.ownedRoot,
            manifestDigest: plan.manifestDigest,
            planDigest: digest(planBytes),
            observerDigest: plan.observer.sha256,
            nonce: plan.nonce,
            pid: process.pid,
            parentPid: process.ppid,
            executable: process.execPath,
            serviceEntry: plan.serviceEntry,
            role: expected.role,
            url,
            realPath: expected.realPath,
            sha256: digest(bytes),
            sizeBytes: bytes.length,
            format: result.format,
            observedMonotonicNs: process.hrtime.bigint().toString(),
            boundary: "normal-node-load-source-not-module-evaluation",
        });
        return result;
    },
});
process.channel.unref();
