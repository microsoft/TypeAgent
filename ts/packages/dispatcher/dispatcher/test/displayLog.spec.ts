// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayLog } from "../src/displayLog.js";
import type { IAgentMessage, RequestId } from "@typeagent/dispatcher-types";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeRequestId(requestId: string = "req-1"): RequestId {
    return { requestId, connectionId: "0" };
}

function makeMessage(
    text: string,
    source: string = "test-agent",
    requestId: RequestId = makeRequestId(),
): IAgentMessage {
    return {
        message: text,
        requestId,
        source,
    };
}

describe("DisplayLog", () => {
    describe("in-memory operations (no dirPath)", () => {
        it("should start empty", () => {
            const log = new DisplayLog(undefined);
            expect(log.getEntries()).toEqual([]);
        });

        it("should log setDisplay entries with incrementing seq", () => {
            const log = new DisplayLog(undefined);
            const msg1 = makeMessage("hello");
            const msg2 = makeMessage("world");

            log.logSetDisplay(msg1);
            log.logSetDisplay(msg2);

            const entries = log.getEntries();
            expect(entries).toHaveLength(2);
            expect(entries[0].type).toBe("set-display");
            expect(entries[0].seq).toBe(0);
            expect(entries[1].seq).toBe(1);
            if (entries[0].type === "set-display") {
                expect(entries[0].message.message).toBe("hello");
            }
        });

        it("should log appendDisplay entries", () => {
            const log = new DisplayLog(undefined);
            const msg = makeMessage("appended");

            log.logAppendDisplay(msg, "block");

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].type).toBe("append-display");
            if (entries[0].type === "append-display") {
                expect(entries[0].mode).toBe("block");
                expect(entries[0].message.message).toBe("appended");
            }
        });

        it("should log setDisplayInfo entries", () => {
            const log = new DisplayLog(undefined);
            const reqId = makeRequestId();

            log.logSetDisplayInfo(reqId, "agent-a", 0);

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].type).toBe("set-display-info");
            if (entries[0].type === "set-display-info") {
                expect(entries[0].source).toBe("agent-a");
                expect(entries[0].actionIndex).toBe(0);
            }
        });

        it("should log setDisplayInfo without optional fields", () => {
            const log = new DisplayLog(undefined);
            const reqId = makeRequestId();

            log.logSetDisplayInfo(reqId, "agent-b");

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            if (entries[0].type === "set-display-info") {
                expect(entries[0].actionIndex).toBeUndefined();
                expect(entries[0].action).toBeUndefined();
            }
        });

        it("should log notify entries", () => {
            const log = new DisplayLog(undefined);

            log.logNotify(
                "notif-1",
                "explained",
                { fromCache: false, fromUser: true, time: "1s" },
                "agent-x",
            );

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].type).toBe("notify");
            if (entries[0].type === "notify") {
                expect(entries[0].event).toBe("explained");
                expect(entries[0].source).toBe("agent-x");
            }
        });

        it("should assign monotonically increasing seq across entry types", () => {
            const log = new DisplayLog(undefined);
            const msg = makeMessage("test");
            const reqId = makeRequestId();

            log.logSetDisplay(msg);
            log.logAppendDisplay(msg, "inline");
            log.logSetDisplayInfo(reqId, "src");
            log.logNotify(undefined, "evt", {}, "src");
            log.logUserRequest(reqId, "hello world");

            const entries = log.getEntries();
            expect(entries.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
        });

        it("should include timestamps", () => {
            const log = new DisplayLog(undefined);
            const before = Date.now();
            log.logSetDisplay(makeMessage("test"));
            const after = Date.now();

            const entries = log.getEntries();
            expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
            expect(entries[0].timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe("getEntries with afterSeq", () => {
        it("should return all entries when afterSeq is undefined", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a"));
            log.logSetDisplay(makeMessage("b"));
            log.logSetDisplay(makeMessage("c"));

            expect(log.getEntries()).toHaveLength(3);
            expect(log.getEntries(undefined)).toHaveLength(3);
        });

        it("should return entries after the given seq", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logSetDisplay(makeMessage("b")); // seq 1
            log.logSetDisplay(makeMessage("c")); // seq 2

            const entries = log.getEntries(0);
            expect(entries).toHaveLength(2);
            expect(entries[0].seq).toBe(1);
            expect(entries[1].seq).toBe(2);
        });

        it("should return empty when afterSeq >= last seq", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logSetDisplay(makeMessage("b")); // seq 1

            expect(log.getEntries(1)).toHaveLength(0);
            expect(log.getEntries(2)).toHaveLength(0);
            expect(log.getEntries(100)).toHaveLength(0);
        });

        it("should return all entries when afterSeq is before first seq", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logSetDisplay(makeMessage("b")); // seq 1

            // afterSeq = -1 means "give me everything from seq 0 onward"
            expect(log.getEntries(-1)).toHaveLength(2);
        });

        it("should return only the last entry", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logSetDisplay(makeMessage("b")); // seq 1
            log.logSetDisplay(makeMessage("c")); // seq 2

            const entries = log.getEntries(1);
            expect(entries).toHaveLength(1);
            expect(entries[0].seq).toBe(2);
        });
    });

    describe("clear", () => {
        it("should remove all entries", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a"));
            log.logSetDisplay(makeMessage("b"));
            expect(log.getEntries()).toHaveLength(2);

            log.clear();
            expect(log.getEntries()).toHaveLength(0);
        });

        it("should reset seq numbering after clear", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logSetDisplay(makeMessage("b")); // seq 1
            log.clear();

            log.logSetDisplay(makeMessage("c"));
            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].seq).toBe(0);
        });
    });

    describe("getEntries returns copies", () => {
        it("should return a new array each time", () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("a"));

            const entries1 = log.getEntries();
            const entries2 = log.getEntries();
            expect(entries1).not.toBe(entries2);
            expect(entries1).toEqual(entries2);
        });
    });

    describe("logUserRequest", () => {
        it("should log user-request entries", () => {
            const log = new DisplayLog(undefined);
            const reqId = makeRequestId("uuid-123");

            log.logUserRequest(reqId, "play some music");

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].type).toBe("user-request");
            if (entries[0].type === "user-request") {
                expect(entries[0].command).toBe("play some music");
                expect(entries[0].requestId).toBe(reqId);
            }
        });

        it("should preserve full RequestId including clientRequestId", () => {
            const log = new DisplayLog(undefined);
            const reqId: RequestId = {
                requestId: "uuid-456",
                connectionId: "conn-1",
                clientRequestId: "cmd-0",
            };

            log.logUserRequest(reqId, "test command");

            const entries = log.getEntries();
            if (entries[0].type === "user-request") {
                expect(entries[0].requestId.requestId).toBe("uuid-456");
                expect(entries[0].requestId.connectionId).toBe("conn-1");
                expect(entries[0].requestId.clientRequestId).toBe("cmd-0");
            }
        });

        it("should interleave with setDisplay entries using same requestId", () => {
            const log = new DisplayLog(undefined);
            const reqId = makeRequestId("uuid-789");
            const msg = makeMessage("response", "agent", reqId);

            log.logUserRequest(reqId, "ask something");
            log.logSetDisplay(msg);

            const entries = log.getEntries();
            expect(entries).toHaveLength(2);
            expect(entries[0].type).toBe("user-request");
            expect(entries[1].type).toBe("set-display");

            // Both reference the same requestId — this is how clients
            // associate output with the originating request.
            if (
                entries[0].type === "user-request" &&
                entries[1].type === "set-display"
            ) {
                expect(entries[0].requestId.requestId).toBe(
                    entries[1].message.requestId.requestId,
                );
            }
        });
    });

    describe("disk persistence", () => {
        let tmpDir: string;

        beforeEach(async () => {
            tmpDir = await fs.promises.mkdtemp(
                path.join(os.tmpdir(), "displaylog-test-"),
            );
        });

        afterEach(async () => {
            await fs.promises.rm(tmpDir, { recursive: true, force: true });
        });

        it("should save and load round-trip", async () => {
            const log = new DisplayLog(tmpDir);
            const msg = makeMessage("persisted", "agent-p");
            log.logSetDisplay(msg);
            log.logAppendDisplay(makeMessage("appended"), "block");
            log.logNotify("n", "event", { key: "val" }, "src");
            await log.save();

            const loaded = await DisplayLog.load(tmpDir);
            const entries = loaded.getEntries();
            expect(entries).toHaveLength(3);
            expect(entries[0].type).toBe("set-display");
            expect(entries[0].seq).toBe(0);
            expect(entries[1].type).toBe("append-display");
            expect(entries[1].seq).toBe(1);
            expect(entries[2].type).toBe("notify");
            expect(entries[2].seq).toBe(2);
        });

        it("should resume seq numbering after load", async () => {
            const log = new DisplayLog(tmpDir);
            log.logSetDisplay(makeMessage("first")); // seq 0
            log.logSetDisplay(makeMessage("second")); // seq 1
            await log.save();

            const loaded = await DisplayLog.load(tmpDir);
            loaded.logSetDisplay(makeMessage("third")); // should be seq 2

            const entries = loaded.getEntries();
            expect(entries).toHaveLength(3);
            expect(entries[2].seq).toBe(2);
        });

        it("should load empty when file does not exist", async () => {
            const loaded = await DisplayLog.load(tmpDir);
            expect(loaded.getEntries()).toHaveLength(0);
        });

        it("should load empty when dirPath is undefined", async () => {
            const loaded = await DisplayLog.load(undefined);
            expect(loaded.getEntries()).toHaveLength(0);
        });

        it("should not save when dirPath is undefined", async () => {
            const log = new DisplayLog(undefined);
            log.logSetDisplay(makeMessage("test"));
            await log.save(); // should be a no-op
            // No file created — no assertion needed, just verifying no error
        });

        it("should not save when not dirty", async () => {
            const log = new DisplayLog(tmpDir);
            log.logSetDisplay(makeMessage("test"));
            await log.save();

            // Read file modification time
            const stat1 = await fs.promises.stat(
                path.join(tmpDir, "displayLog.json"),
            );

            // save again without changes
            await log.save();

            const stat2 = await fs.promises.stat(
                path.join(tmpDir, "displayLog.json"),
            );
            expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
        });

        it("should handle malformed JSON on load", async () => {
            await fs.promises.writeFile(
                path.join(tmpDir, "displayLog.json"),
                "not valid json{{{",
                "utf-8",
            );
            const loaded = await DisplayLog.load(tmpDir);
            expect(loaded.getEntries()).toHaveLength(0);
        });

        it("should handle non-array JSON on load", async () => {
            await fs.promises.writeFile(
                path.join(tmpDir, "displayLog.json"),
                JSON.stringify({ not: "an array" }),
                "utf-8",
            );
            const loaded = await DisplayLog.load(tmpDir);
            expect(loaded.getEntries()).toHaveLength(0);
        });

        it("should preserve all entry types through save/load", async () => {
            const log = new DisplayLog(tmpDir);
            const reqId = makeRequestId("r1");

            log.logSetDisplay(makeMessage("msg1", "src1", reqId));
            log.logAppendDisplay(makeMessage("msg2", "src2", reqId), "inline");
            log.logSetDisplayInfo(reqId, "src3", 5);
            log.logNotify(
                reqId,
                "explained",
                { fromCache: false, fromUser: true, time: "2s" },
                "src4",
            );
            log.logUserRequest(reqId, "original command");

            await log.save();
            const loaded = await DisplayLog.load(tmpDir);
            const entries = loaded.getEntries();

            expect(entries).toHaveLength(5);
            expect(entries.map((e) => e.type)).toEqual([
                "set-display",
                "append-display",
                "set-display-info",
                "notify",
                "user-request",
            ]);
        });

        it("should support incremental getEntries after load", async () => {
            const log = new DisplayLog(tmpDir);
            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logSetDisplay(makeMessage("b")); // seq 1
            log.logSetDisplay(makeMessage("c")); // seq 2
            await log.save();

            const loaded = await DisplayLog.load(tmpDir);
            const entries = loaded.getEntries(1);
            expect(entries).toHaveLength(1);
            expect(entries[0].seq).toBe(2);
        });
    });
});
