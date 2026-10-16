// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotSession } from "@github/copilot-sdk";
import type { TraceSummary } from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";
import { lstat, writeFile, rename, realpath } from "node:fs/promises";
import path from "node:path";
import {
    publishControlMetadata,
    assertControlBinding,
    type ControlMetadata,
} from "../shared/control-metadata.js";
import {
    readWorkiqCaptureFile,
    readWorkiqCaptureBytes,
} from "./workiq-originals.js";

export async function publishWorkiqNativeRecord(
    control: ControlMetadata,
    name: string,
    value: unknown,
) {
    if (
        ![
            "native-workiq-session.json",
            "native-workiq-finalized.json",
            "native-control-admission.json",
        ].includes(name)
    )
        throw new Error("WorkIQ source record name is not admitted.");
    const info = await lstat(control.dataRoot);
    if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        path.resolve(await realpath(control.dataRoot)).toLowerCase() !==
            control.dataRoot.toLowerCase()
    )
        throw new Error("WorkIQ source record root is unsafe.");
    const filename = path.join(control.dataRoot, name);
    try {
        const previous = await lstat(filename);
        if (
            !previous.isFile() ||
            previous.isSymbolicLink() ||
            previous.nlink !== 1
        )
            throw new Error("WorkIQ source record is unsafe.");
    } catch (error) {
        if (
            !(
                error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "ENOENT"
            )
        )
            throw error;
    }
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 1024 * 1024)
        throw new Error("WorkIQ source record exceeds its bound.");
    const pending = `${filename}.pending`;
    await writeFile(pending, json, { flag: "wx", mode: 0o600 });
    await rename(pending, filename);
}

function source(control: ControlMetadata, sessionId: string) {
    return {
        component: "native-workiq-session-v1",
        sessionId,
        processStartedAt: new Date(
            Date.now() - process.uptime() * 1000,
        ).toISOString(),
        control,
        observedAt: new Date().toISOString(),
    };
}

interface NativeSessionRecord {
    schemaVersion: number;
    phase: string;
    source: ReturnType<typeof source>;
    initialization: {
        method: string;
        startedAt: string;
        completedAt: string;
        returnedKeys: string[];
    };
    tools: Awaited<
        ReturnType<CopilotSession["rpc"]["tools"]["getCurrentMetadata"]>
    >;
    registry: Awaited<ReturnType<CopilotSession["rpc"]["commands"]["list"]>>;
    controls: unknown[];
    admission: false;
}

export async function publishWorkiqSessionKnown(
    control: ControlMetadata,
    sessionId: string,
) {
    await publishWorkiqNativeRecord(control, "native-workiq-session.json", {
        schemaVersion: 1,
        phase: "session-known",
        source: source(control, sessionId),
        initialization: null,
        tools: null,
        registry: null,
        controls: [],
        admission: false,
    });
}

export async function initializeWorkiqNativeSession(
    control: ControlMetadata,
    session: Pick<CopilotSession, "sessionId" | "rpc">,
): Promise<NativeSessionRecord> {
    const startedAt = new Date().toISOString();
    const initialized = await session.rpc.tools.initializeAndValidate();
    const initialization = {
        method: "session.tools.initializeAndValidate",
        startedAt,
        completedAt: new Date().toISOString(),
        returnedKeys: Object.keys(initialized),
    };
    const tools = await session.rpc.tools.getCurrentMetadata();
    const registry = await session.rpc.commands.list();
    const select = (name: string) => {
        const found = registry.commands.filter((command) =>
            [name, `typeagent:${name}`].includes(command.name),
        );
        if (found.length !== 1)
            throw new Error(
                "WorkIQ native pure control registry is ambiguous.",
            );
        return found[0].name;
    };
    const mode = select("typeagent-mode"),
        status = select("typeagent-status");
    const controls = [];
    for (const input of ["bypass", "direct"]) {
        const admission = await readWorkiqCaptureFile(
            control.dataRoot,
            "native-control-admission.json",
            256 * 1024,
        );
        if (!admission || typeof admission !== "object")
            throw new Error("WorkIQ control admission is invalid.");
        await publishWorkiqNativeRecord(
            control,
            "native-control-admission.json",
            { ...admission, expectedMode: input },
        );
        const before = new Date().toISOString();
        const setter = await session.rpc.commands.invoke({ name: mode, input });
        const getter = await session.rpc.commands.invoke({
            name: status,
            input: "--control",
        });
        const observed = publishControlMetadata("native-workiq-pure-control", {
            sessionId: session.sessionId,
            timestamp: Date.now(),
            cwd: process.cwd(),
        });
        assertControlBinding(observed);
        controls.push({
            mode: input,
            startedAt: before,
            completedAt: new Date().toISOString(),
            setter: { name: mode, returnedKeys: Object.keys(setter) },
            getter: {
                name: status,
                input: "--control",
                returnedKeys: Object.keys(getter),
            },
            control: observed,
        });
    }
    const record: NativeSessionRecord = {
        schemaVersion: 1,
        phase: "initialized",
        source: source(control, session.sessionId),
        initialization,
        tools,
        registry,
        controls,
        admission: false,
    };
    await publishWorkiqNativeRecord(
        control,
        "native-workiq-session.json",
        record,
    );
    return record;
}

export async function publishWorkiqFinalizedCapture(
    control: ControlMetadata,
    sessionId: string,
    summary: TraceSummary,
    receipt: { source: { traceId: string }; calls: number; admission: boolean },
) {
    const policy = await readWorkiqCaptureFile(
        control.dataRoot,
        "native-workiq-originals-policy.json",
        64 * 1024,
    );
    if (
        !policy ||
        typeof policy !== "object" ||
        !("artifactRoot" in policy) ||
        typeof policy.artifactRoot !== "string"
    )
        throw new Error("WorkIQ artifact root is missing.");
    if (
        summary.sessionId !== sessionId ||
        receipt.source.traceId !== summary.traceId ||
        receipt.calls !== 4
    )
        throw new Error("WorkIQ finalized summary is unbound.");
    const trace = await readWorkiqCaptureBytes(
        policy.artifactRoot,
        path.join("traces", `${summary.traceId}.json`),
        1024 * 1024,
    );
    const originalReceipt = await readWorkiqCaptureBytes(
        policy.artifactRoot,
        path.join("workiq-sdk-originals", sessionId, "receipt.json"),
        256 * 1024,
    );
    await publishWorkiqNativeRecord(control, "native-workiq-finalized.json", {
        schemaVersion: 1,
        source: source(control, sessionId),
        summary,
        tracePath: path.join(
            policy.artifactRoot,
            "traces",
            `${summary.traceId}.json`,
        ),
        traceSha256: createHash("sha256").update(trace).digest("hex"),
        receiptPath: path.join(
            policy.artifactRoot,
            "workiq-sdk-originals",
            sessionId,
            "receipt.json",
        ),
        receiptSha256: createHash("sha256")
            .update(originalReceipt)
            .digest("hex"),
        hashKind: "physical-sha256",
        runIdentityKind: "controller-trial-lease",
        admission: false,
        modelInputExposure: "not-certified",
    });
}
