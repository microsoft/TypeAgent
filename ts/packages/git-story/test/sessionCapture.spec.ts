// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    SessionWatcher,
    type CapturedSessionUpdates,
    type SessionCaptureCheckpoint,
    type SessionCaptureOptions,
    type SessionWatchRequest,
} from "../src/sessionWatcher.js";
import { captureSessionUpdates } from "../src/sessionCapture.js";
import { captureStatePath } from "../src/sessionCaptureState.js";

const guid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const payload = {
    type: "user.message",
    data: { content: "sanitized message" },
};
const line = JSON.stringify(payload) + "\n";
let directory: string;
let request: SessionWatchRequest;
let options: SessionCaptureOptions;
let stateFile: string;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "git-story-capture-"));
    request = {
        sessionId: "sanitized-session",
        projectPath: directory,
        transcriptPath: path.join(directory, "events.jsonl"),
        metadata: { clientName: "Copilot CLI", models: [] },
    };
    options = { stateDirectory: path.join(directory, "state") };
    stateFile = captureStatePath(
        request.sessionId,
        request.transcriptPath,
        options.stateDirectory,
    );
    await fs.writeFile(request.transcriptPath, "");
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function checkpoint(offset: number): SessionCaptureCheckpoint {
    return {
        sessionId: request.sessionId,
        transcriptPath: request.transcriptPath,
        sourceByteOffset: String(offset),
    };
}

function capture(
    from?: SessionCaptureCheckpoint,
    overrides: SessionCaptureOptions = {},
): Promise<CapturedSessionUpdates> {
    return new SessionWatcher().captureUpdates(request, from, {
        ...options,
        ...overrides,
    });
}

test("empty input and partial-only input keep a zero checkpoint", async () => {
    const empty = await capture();
    expect(empty.records).toEqual([]);
    expect(empty.nextCheckpoint).toEqual(checkpoint(0));
    await fs.appendFile(request.transcriptPath, '{"type":');
    const partial = await capture();
    expect(partial).toEqual(empty);
});

test("bounded batches resume automatically without resetting on append", async () => {
    await fs.writeFile(request.transcriptPath, line.repeat(3));
    const first = await capture(undefined, { maxRecords: 2 });
    expect(first.records).toHaveLength(2);
    expect(first.nextCheckpoint).toEqual(
        checkpoint(Buffer.byteLength(line) * 2),
    );
    const second = await capture();
    expect(second.records).toHaveLength(1);
    expect(second.generation).toBe(first.generation);
    expect(second.records[0].source.sourceByteOffset).toBe(
        first.nextCheckpoint.sourceByteOffset,
    );
    await fs.appendFile(request.transcriptPath, line);
    const third = await capture();
    expect(third.records).toHaveLength(1);
    expect(third.generation).toBe(first.generation);
    expect(third.diagnostics).toEqual([]);
    const idle = await capture();
    expect(idle.records).toEqual([]);
    expect(idle.nextCheckpoint).toEqual(third.nextCheckpoint);
    expect(idle.generation).toBe(first.generation);
});

test("the default batch limit is 1000 complete records", async () => {
    await fs.writeFile(request.transcriptPath, line.repeat(1001));
    const batch = await capture();
    expect(batch.records).toHaveLength(1000);
    expect(batch.nextCheckpoint).toEqual(
        checkpoint(Buffer.byteLength(line) * 1000),
    );
    expect((await capture()).records).toHaveLength(1);
});

test("ID assignments are scoped to session and transcript, not payload", async () => {
    await fs.writeFile(request.transcriptPath, line);
    const first = await capture();
    const anotherSession = await captureSessionUpdates(
        { ...request, sessionId: "another-session" },
        undefined,
        options,
    );
    const transcriptPath = path.join(directory, "another.jsonl");
    await fs.writeFile(transcriptPath, line);
    const anotherTranscript = await captureSessionUpdates(
        { ...request, transcriptPath },
        undefined,
        options,
    );
    expect(
        new Set([
            first.records[0].id,
            anotherSession.records[0].id,
            anotherTranscript.records[0].id,
        ]).size,
    ).toBe(3);
    expect((await capture(checkpoint(0))).records).toEqual(first.records);
});

test("repeated native IDs are preserved rather than deduplicated at capture", async () => {
    const nativeLine = JSON.stringify({ ...payload, id: "native-id" }) + "\n";
    await fs.writeFile(request.transcriptPath, nativeLine.repeat(2));
    const result = await capture();
    expect(result.records.map((record) => record.id)).toEqual([
        "native-id",
        "native-id",
    ]);
    expect(
        result.records.map((record) => record.source.sourceByteOffset),
    ).toEqual(["0", String(Buffer.byteLength(nativeLine))]);
});

test("UTF-8 byte positions include LF and CRLF, not character counts", async () => {
    const firstLine =
        JSON.stringify({ id: "native", text: "\u00e9\u4e2d\ud83d\ude80" }) +
        "\r\n";
    const secondLine = JSON.stringify({ text: "\u4e2d" }) + "\n";
    await fs.writeFile(request.transcriptPath, firstLine + secondLine);
    const first = await capture(undefined, { maxRecords: 1 });
    expect(first.nextCheckpoint.sourceByteOffset).toBe(
        String(Buffer.byteLength(firstLine)),
    );
    expect(first.records[0].payload).toEqual(JSON.parse(firstLine));
    const second = await capture();
    expect(second.records[0].source.sourceByteOffset).toBe(
        first.nextCheckpoint.sourceByteOffset,
    );
    expect(second.nextCheckpoint.sourceByteOffset).toBe(
        String(Buffer.byteLength(firstLine + secondLine)),
    );
});

test("a tail split inside a UTF-8 character is unread until completed", async () => {
    const complete = Buffer.from('{"text":"\ud83d\ude80"}\r\n');
    const split = complete.indexOf(Buffer.from("\ud83d\ude80")) + 2;
    await fs.writeFile(
        request.transcriptPath,
        Buffer.concat([Buffer.from(line), complete.subarray(0, split)]),
    );
    const first = await capture();
    expect(first.records).toHaveLength(1);
    expect(first.diagnostics).toEqual([]);
    expect(first.nextCheckpoint).toEqual(checkpoint(Buffer.byteLength(line)));
    await fs.appendFile(
        request.transcriptPath,
        complete.subarray(split, complete.length - 1),
    );
    expect((await capture()).records).toEqual([]);
    await fs.appendFile(request.transcriptPath, complete.subarray(-1));
    const next = await capture();
    expect(next.records[0].payload).toEqual({ text: "\ud83d\ude80" });
    expect(next.generation).toBe(first.generation);
    expect(next.nextCheckpoint).toEqual(
        checkpoint(Buffer.byteLength(line) + complete.length),
    );
});

test("records spanning read chunks preserve their payloads and byte offsets", async () => {
    const large = JSON.stringify({ text: "x".repeat(140_000) }) + "\n";
    await fs.writeFile(request.transcriptPath, large + line);
    const result = await capture();
    expect(result.records.map((record) => record.payload)).toEqual([
        JSON.parse(large),
        payload,
    ]);
    expect(result.records[1].source.sourceByteOffset).toBe(
        String(Buffer.byteLength(large)),
    );
});

test.each(["arbitrary/native:id", "", "not-a-guid"])(
    "native ID %j is preserved without changing the original payload",
    async (id) => {
        const original = { ...payload, id };
        await fs.writeFile(
            request.transcriptPath,
            JSON.stringify(original) + "\n",
        );
        const result = await capture();
        expect(result.records[0]).toEqual({
            id,
            sourceEventId: id,
            source: { ...checkpoint(0), generation: result.generation },
            payload: original,
        });
        const saved = JSON.parse(await fs.readFile(stateFile, "utf8"));
        expect(saved.generatedIds).toEqual({});
    },
);

test("distinct identical ID-less records receive different persisted GUIDs", async () => {
    await fs.writeFile(request.transcriptPath, line.repeat(2));
    const result = await capture();
    const ids = result.records.map((record) => record.id);
    expect(ids[0]).toMatch(guid);
    expect(ids[1]).toMatch(guid);
    expect(ids[0]).not.toBe(ids[1]);
    for (const record of result.records) {
        expect(record).not.toHaveProperty("sourceEventId");
        expect(record.payload).toEqual(payload);
        expect(record.payload).not.toHaveProperty("id");
    }
    const savedText = await fs.readFile(stateFile, "utf8");
    expect(JSON.parse(savedText).generatedIds).toEqual({
        "0": ids[0],
        [Buffer.byteLength(line)]: ids[1],
    });
    expect(savedText).not.toContain("sanitized message");
    expect(savedText).not.toContain("lastReadEventId");
    const replay = await capture(checkpoint(0));
    expect(replay.records).toEqual(result.records);
});

test.each([null, 42, [], { id: 42, type: "event" }])(
    "valid JSON %j is captured unchanged for normalization to validate",
    async (original) => {
        await fs.writeFile(
            request.transcriptPath,
            JSON.stringify(original) + "\n",
        );
        const result = await capture();
        expect(result.records[0].payload).toEqual(original);
        expect(result.records[0].id).toMatch(guid);
        expect(result.records[0]).not.toHaveProperty("sourceEventId");
    },
);

test("malformed complete records surface safe diagnostics and count toward the batch limit", async () => {
    const malformed = '{"private":"do-not-echo" broken}\n';
    const invalidUtf8 = Buffer.from([0x22, 0xff, 0x22, 0x0a]);
    await fs.writeFile(
        request.transcriptPath,
        Buffer.concat([
            Buffer.from(malformed),
            invalidUtf8,
            Buffer.from("\n" + line),
        ]),
    );
    const first = await capture(undefined, { maxRecords: 2 });
    expect(first.records).toEqual([]);
    expect(first.diagnostics).toEqual([
        {
            code: "invalid-json",
            source: { ...checkpoint(0), generation: first.generation },
        },
        {
            code: "invalid-utf8",
            source: {
                ...checkpoint(Buffer.byteLength(malformed)),
                generation: first.generation,
            },
        },
    ]);
    expect(JSON.stringify(first)).not.toContain("do-not-echo");
    expect(first.nextCheckpoint).toEqual(
        checkpoint(Buffer.byteLength(malformed) + invalidUtf8.length),
    );
    const second = await capture();
    expect(second.records).toHaveLength(1);
    expect(second.diagnostics[0].code).toBe("invalid-json");
    const replay = await capture(checkpoint(0), { maxRecords: 2 });
    expect(replay.diagnostics).toEqual(first.diagnostics);
});

test("fresh process resumes and replays the same assigned IDs from disk", async () => {
    await fs.writeFile(request.transcriptPath, line.repeat(3));
    const first = await capture(undefined, { maxRecords: 2 });
    const moduleUrl = new URL("../sessionCapture.js", import.meta.url).href;
    const run = (from?: SessionCaptureCheckpoint): CapturedSessionUpdates => {
        const script = `
            import { captureSessionUpdates } from ${JSON.stringify(moduleUrl)};
            const result = await captureSessionUpdates(
                ${JSON.stringify(request)},
                ${JSON.stringify(from) ?? "undefined"},
                ${JSON.stringify(options)}
            );
            process.stdout.write(JSON.stringify(result));
        `;
        return JSON.parse(
            execFileSync(
                process.execPath,
                ["--input-type=module", "-e", script],
                { encoding: "utf8" },
            ),
        );
    };
    const resumed = run();
    expect(resumed.records).toHaveLength(1);
    expect(resumed.generation).toBe(first.generation);
    expect(resumed.records[0].source.sourceByteOffset).toBe(
        first.nextCheckpoint.sourceByteOffset,
    );
    const replay = run(checkpoint(0));
    expect(replay.records).toEqual([...first.records, ...resumed.records]);
});

test("generation-bound nonzero replay preserves the saved high-water checkpoint", async () => {
    await fs.writeFile(request.transcriptPath, line.repeat(3));
    const original = await capture();
    const replay = await capture(checkpoint(Buffer.byteLength(line)), {
        expectedGeneration: original.generation,
        maxRecords: 1,
    });
    expect(replay.records).toEqual([original.records[1]]);
    expect(replay.nextCheckpoint).toEqual(
        checkpoint(Buffer.byteLength(line) * 2),
    );
    expect((await capture()).nextCheckpoint).toEqual(original.nextCheckpoint);
    expect((await capture()).records).toEqual([]);
});

test.each(["replace", "truncate", "rewrite-and-regrow"] as const)(
    "%s starts a new generation rather than applying the old offset",
    async (operation) => {
        await fs.writeFile(request.transcriptPath, line.repeat(2));
        const old = await capture();
        if (operation === "replace") {
            const replacement = path.join(directory, "replacement.jsonl");
            await fs.writeFile(replacement, line.repeat(2));
            await fs.rename(replacement, request.transcriptPath);
        } else if (operation === "truncate") {
            await fs.writeFile(request.transcriptPath, line);
        } else {
            await fs.writeFile(
                request.transcriptPath,
                line.replace("sanitized", "rewritten").repeat(3),
            );
        }
        await expect(
            capture(old.nextCheckpoint, { expectedGeneration: old.generation }),
        ).rejects.toThrow("generation does not match");
        const next = await capture();
        expect(next.generation).not.toBe(old.generation);
        expect(next.records[0].source.sourceByteOffset).toBe("0");
        expect(next.records[0].id).not.toBe(old.records[0].id);
        expect(next.diagnostics).toEqual([
            {
                code: "source-reset",
                source: { ...checkpoint(0), generation: next.generation },
            },
        ]);
        await expect(
            capture(old.nextCheckpoint, { expectedGeneration: old.generation }),
        ).rejects.toThrow("generation does not match");
    },
);

test("truncation to an empty transcript is reported immediately", async () => {
    await fs.writeFile(request.transcriptPath, line);
    const old = await capture();
    await fs.truncate(request.transcriptPath, 0);
    const next = await capture();
    expect(next.nextCheckpoint).toEqual(checkpoint(0));
    expect(next.generation).not.toBe(old.generation);
    expect(next.diagnostics[0].code).toBe("source-reset");
    await fs.appendFile(request.transcriptPath, line);
    expect((await capture()).generation).toBe(next.generation);
});

test("missing state cannot authenticate an explicit nonzero checkpoint", async () => {
    await fs.writeFile(request.transcriptPath, line);
    await expect(capture(checkpoint(Buffer.byteLength(line)))).rejects.toThrow(
        "require expectedGeneration",
    );
    await expect(
        capture(checkpoint(Buffer.byteLength(line)), {
            expectedGeneration: "missing",
        }),
    ).rejects.toThrow("generation does not match");
    const first = await capture();
    await fs.unlink(stateFile);
    await expect(
        capture(first.nextCheckpoint, { expectedGeneration: first.generation }),
    ).rejects.toThrow("generation does not match");
});

test("invalid explicit cursors fail instead of skipping source records", async () => {
    await fs.writeFile(request.transcriptPath, line);
    const original = await capture();
    const bound = { expectedGeneration: original.generation };
    await expect(capture(checkpoint(1), bound)).rejects.toThrow(
        "record boundary",
    );
    await expect(capture(checkpoint(9999), bound)).rejects.toThrow(
        "unverified capture checkpoint",
    );
    await expect(
        capture({ ...checkpoint(0), sessionId: "another-session" }),
    ).rejects.toThrow("does not match");
    await expect(
        capture({
            ...checkpoint(0),
            transcriptPath: path.join(directory, "other.jsonl"),
        }),
    ).rejects.toThrow("does not match");
});

test.each(["-1", "1.5", "01", "9007199254740992", "NaN"])(
    "invalid offset %s is rejected",
    async (offset) => {
        await expect(
            capture({ ...checkpoint(0), sourceByteOffset: offset }),
        ).rejects.toThrow("safe decimal integer");
    },
);

test.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "invalid batch size %s is rejected",
    async (maxRecords) => {
        await expect(capture(undefined, { maxRecords })).rejects.toThrow(
            "positive safe integer",
        );
    },
);

test("request validation and missing source failures do not create capture state", async () => {
    await expect(
        captureSessionUpdates(
            { ...request, sessionId: "" },
            undefined,
            options,
        ),
    ).rejects.toThrow("session ID and absolute transcript path");
    await expect(
        captureSessionUpdates(
            { ...request, transcriptPath: "relative.jsonl" },
            undefined,
            options,
        ),
    ).rejects.toThrow("session ID and absolute transcript path");
    await fs.unlink(request.transcriptPath);
    await expect(capture()).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(options.stateDirectory!)).toEqual([]);
});

test.each(["invalid-json", "invalid-schema", "invalid-offset"] as const)(
    "corrupt state (%s) fails closed without echoing its contents",
    async (corruption) => {
        await fs.writeFile(request.transcriptPath, line);
        await capture();
        const saved = JSON.parse(await fs.readFile(stateFile, "utf8"));
        let corrupt: string;
        if (corruption === "invalid-json") {
            corrupt = '{"private":"do-not-echo" broken}';
        } else if (corruption === "invalid-schema") {
            corrupt = '{"private":"do-not-echo"}';
        } else {
            saved.checkpoint.sourceByteOffset = "9999999";
            corrupt = JSON.stringify(saved);
        }
        await fs.writeFile(stateFile, corrupt);
        await expect(capture()).rejects.toThrow(
            "Invalid session capture state",
        );
        expect(await fs.readFile(stateFile, "utf8")).toBe(corrupt);
    },
);

test.each(["writeFile", "sync", "rename"] as const)(
    "atomic state %s failure preserves the old checkpoint and ID assignments",
    async (operation) => {
        await fs.writeFile(request.transcriptPath, line);
        const first = await capture();
        const saved = await fs.readFile(stateFile, "utf8");
        await fs.appendFile(request.transcriptPath, line);
        const failure = new Error("injected persistence failure");
        if (operation === "rename") {
            jest.spyOn(fs, "rename").mockRejectedValueOnce(failure);
        } else {
            const open = fs.open.bind(fs);
            jest.spyOn(fs, "open").mockImplementation(async (...args) => {
                const handle = await open(...args);
                if (String(args[0]).endsWith(".tmp")) {
                    jest.spyOn(handle, operation).mockRejectedValueOnce(
                        failure,
                    );
                }
                return handle;
            });
        }
        await expect(capture()).rejects.toThrow(failure);
        expect(await fs.readFile(stateFile, "utf8")).toBe(saved);
        expect(await fs.readdir(options.stateDirectory!)).toEqual([
            path.basename(stateFile),
        ]);
        jest.restoreAllMocks();
        const retry = await capture();
        expect(retry.records).toHaveLength(1);
        expect(retry.nextCheckpoint).toEqual(
            checkpoint(Buffer.byteLength(line) * 2),
        );
        const replay = await capture(checkpoint(0));
        expect(replay.records).toEqual([...first.records, ...retry.records]);
    },
);

test("failed first publication leaves no state or returned IDs, and retries all records", async () => {
    await fs.writeFile(request.transcriptPath, line.repeat(2));
    jest.spyOn(fs, "rename").mockRejectedValueOnce(
        new Error("injected rename failure"),
    );
    await expect(capture()).rejects.toThrow("injected rename failure");
    expect(await fs.readdir(options.stateDirectory!)).toEqual([]);
    const retry = await capture();
    expect(retry.records).toHaveLength(2);
    expect((await capture(checkpoint(0))).records).toEqual(retry.records);
});

test("an existing writer lock fails explicitly without stealing it", async () => {
    await capture();
    await fs.writeFile(`${stateFile}.lock`, "");
    await expect(capture()).rejects.toThrow("Session capture state is locked");
    expect(await fs.readFile(`${stateFile}.lock`, "utf8")).toBe("");
});

test("source mutation during capture rejects the batch without advancing state", async () => {
    await fs.writeFile(request.transcriptPath, line);
    await capture();
    const saved = await fs.readFile(stateFile, "utf8");
    await fs.appendFile(request.transcriptPath, line);
    const stat = fs.stat.bind(fs);
    jest.spyOn(fs, "stat").mockImplementation(async (...args) => {
        await fs.truncate(request.transcriptPath, 0);
        return stat(...args);
    });
    await expect(capture()).rejects.toThrow(
        "Transcript changed during capture",
    );
    expect(await fs.readFile(stateFile, "utf8")).toBe(saved);
});
