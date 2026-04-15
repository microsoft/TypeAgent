// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayLog } from "../src/displayLog.js";
import type {
    IAgentMessage,
    RequestId,
    PendingInteractionRequest,
} from "@typeagent/dispatcher-types";
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

    describe("logPendingInteraction", () => {
        it("should log question with correct fields and omit defaultId when not provided", () => {
            const log = new DisplayLog(undefined);
            const interaction = {
                interactionId: "int-1",
                type: "question",
                source: "agent-a",
                timestamp: Date.now(),
                message: "Do you want to proceed?",
                choices: ["Yes", "No"],
            } as unknown as PendingInteractionRequest;

            log.logPendingInteraction(interaction);

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].type).toBe("pending-interaction");
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].interactionId).toBe("int-1");
                expect(entries[0].interactionType).toBe("question");
                expect(entries[0].source).toBe("agent-a");
                expect(entries[0].message).toBe("Do you want to proceed?");
                expect(entries[0].choices).toEqual(["Yes", "No"]);
                expect(entries[0].defaultId).toBeUndefined();
            }
        });

        it("should include defaultId for question when provided", () => {
            const log = new DisplayLog(undefined);
            const interaction = {
                interactionId: "int-2",
                type: "question",
                source: "agent-b",
                timestamp: Date.now(),
                message: "Continue?",
                choices: ["Yes", "No"],
                defaultId: 0,
            } as unknown as PendingInteractionRequest;

            log.logPendingInteraction(interaction);

            const entries = log.getEntries();
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].defaultId).toBe(0);
            }
        });

        it("should include requestId when provided and omit when not", () => {
            const log = new DisplayLog(undefined);
            const reqId = makeRequestId("req-abc");
            const withReqId = {
                interactionId: "int-3",
                type: "question",
                source: "agent-c",
                timestamp: Date.now(),
                message: "Yes?",
                choices: ["Yes", "No"],
                requestId: reqId,
            } as unknown as PendingInteractionRequest;
            const withoutReqId = {
                interactionId: "int-4",
                type: "question",
                source: "agent-d",
                timestamp: Date.now(),
                message: "No?",
                choices: ["Yes", "No"],
            } as unknown as PendingInteractionRequest;

            log.logPendingInteraction(withReqId);
            log.logPendingInteraction(withoutReqId);

            const entries = log.getEntries();
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].requestId).toBe(reqId);
            }
            if (entries[1].type === "pending-interaction") {
                expect(entries[1].requestId).toBeUndefined();
            }
        });

        it("should log question with message and choices, omit defaultId when not provided", () => {
            const log = new DisplayLog(undefined);
            const interaction = {
                interactionId: "int-5",
                type: "question",
                source: "agent-e",
                timestamp: Date.now(),
                message: "Pick one",
                choices: ["alpha", "beta", "gamma"],
            } as unknown as PendingInteractionRequest;

            log.logPendingInteraction(interaction);

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].interactionType).toBe("question");
                expect(entries[0].message).toBe("Pick one");
                expect(entries[0].choices).toEqual(["alpha", "beta", "gamma"]);
                expect(entries[0].defaultId).toBeUndefined();
            }
        });

        it("should include defaultId for multi-choice question when provided", () => {
            const log = new DisplayLog(undefined);
            const interaction = {
                interactionId: "int-6",
                type: "question",
                source: "agent-f",
                timestamp: Date.now(),
                message: "Choose",
                choices: ["x", "y"],
                defaultId: 1,
            } as unknown as PendingInteractionRequest;

            log.logPendingInteraction(interaction);

            const entries = log.getEntries();
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].defaultId).toBe(1);
            }
        });

        it("should log proposeAction with actionTemplates", () => {
            const log = new DisplayLog(undefined);
            const templates = {
                templateAgentName: "calendar",
                templateName: "createEvent",
                preface: "Here is the proposed action:",
                templates: [{ data: "some-template-data" }],
            };
            const interaction: PendingInteractionRequest = {
                interactionId: "int-7",
                type: "proposeAction",
                source: "agent-g",
                timestamp: Date.now(),
                actionTemplates: templates as any,
            };

            log.logPendingInteraction(interaction);

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].interactionType).toBe("proposeAction");
                expect(entries[0].actionTemplates).toEqual(templates);
            }
        });

        it("should increment seq correctly across interaction and other entry types", () => {
            const log = new DisplayLog(undefined);
            const msg = makeMessage("test");

            log.logSetDisplay(msg); // seq 0
            log.logPendingInteraction({
                interactionId: "int-a",
                type: "question",
                source: "src",
                timestamp: Date.now(),
                message: "q?",
                choices: ["Yes", "No"],
            } as unknown as PendingInteractionRequest); // seq 1
            log.logAppendDisplay(msg, "block"); // seq 2
            log.logPendingInteraction({
                interactionId: "int-b",
                type: "question",
                source: "src",
                timestamp: Date.now(),
                message: "pick",
                choices: ["a"],
            } as unknown as PendingInteractionRequest); // seq 3
            log.logNotify(undefined, "evt", {}, "src"); // seq 4

            const entries = log.getEntries();
            expect(entries.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
        });

        it("should return the assigned seq number", () => {
            const log = new DisplayLog(undefined);

            const seq0 = log.logSetDisplay(makeMessage("first"));
            const seq1 = log.logPendingInteraction({
                interactionId: "int-ret",
                type: "question",
                source: "src",
                timestamp: Date.now(),
                message: "q?",
                choices: ["Yes", "No"],
            } as unknown as PendingInteractionRequest);
            const seq2 = log.logPendingInteraction({
                interactionId: "int-ret-2",
                type: "proposeAction",
                source: "src",
                timestamp: Date.now(),
                actionTemplates: {} as any,
            });

            expect(seq0).toBe(0);
            expect(seq1).toBe(1);
            expect(seq2).toBe(2);
        });
    });

    describe("logInteractionResolved", () => {
        it("should log correct type, interactionId, and response", () => {
            const log = new DisplayLog(undefined);

            log.logInteractionResolved("int-100", true);

            const entries = log.getEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].type).toBe("interaction-resolved");
            if (entries[0].type === "interaction-resolved") {
                expect(entries[0].interactionId).toBe("int-100");
                expect(entries[0].response).toBe(true);
            }
        });

        it("should accept any response value", () => {
            const log = new DisplayLog(undefined);

            log.logInteractionResolved("int-bool", false);
            log.logInteractionResolved("int-num", 42);
            log.logInteractionResolved("int-obj", {
                key: "value",
                nested: [1, 2],
            });
            log.logInteractionResolved("int-null", null);

            const entries = log.getEntries();
            expect(entries).toHaveLength(4);
            if (entries[0].type === "interaction-resolved") {
                expect(entries[0].response).toBe(false);
            }
            if (entries[1].type === "interaction-resolved") {
                expect(entries[1].response).toBe(42);
            }
            if (entries[2].type === "interaction-resolved") {
                expect(entries[2].response).toEqual({
                    key: "value",
                    nested: [1, 2],
                });
            }
            if (entries[3].type === "interaction-resolved") {
                expect(entries[3].response).toBeNull();
            }
        });

        it("should increment seq correctly", () => {
            const log = new DisplayLog(undefined);

            log.logSetDisplay(makeMessage("a")); // seq 0
            log.logInteractionResolved("int-x", true); // seq 1
            log.logInteractionResolved("int-y", 7); // seq 2
            log.logSetDisplay(makeMessage("b")); // seq 3

            const entries = log.getEntries();
            expect(entries.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
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

        it("should round-trip pending-interaction and interaction-resolved entries", async () => {
            const log = new DisplayLog(tmpDir);
            const reqId = makeRequestId("r-int");

            log.logPendingInteraction({
                interactionId: "int-p1",
                type: "question",
                source: "agent-a",
                timestamp: Date.now(),
                message: "Proceed?",
                choices: ["Yes", "No"],
                defaultId: 1,
                requestId: reqId,
            } as unknown as PendingInteractionRequest);
            log.logPendingInteraction({
                interactionId: "int-p2",
                type: "question",
                source: "agent-b",
                timestamp: Date.now(),
                message: "Choose",
                choices: ["opt1", "opt2", "opt3"],
                defaultId: 2,
            } as unknown as PendingInteractionRequest);
            log.logPendingInteraction({
                interactionId: "int-p3",
                type: "proposeAction",
                source: "agent-c",
                timestamp: Date.now(),
                actionTemplates: { tpl: "data" } as any,
            });
            log.logInteractionResolved("int-p1", 1);
            log.logInteractionResolved("int-p2", 1);
            log.logInteractionResolved("int-p3", { accepted: true });

            await log.save();
            const loaded = await DisplayLog.load(tmpDir);
            const entries = loaded.getEntries();

            expect(entries).toHaveLength(6);
            expect(entries.map((e) => e.type)).toEqual([
                "pending-interaction",
                "pending-interaction",
                "pending-interaction",
                "interaction-resolved",
                "interaction-resolved",
                "interaction-resolved",
            ]);

            // Verify first question fields survived round-trip
            if (entries[0].type === "pending-interaction") {
                expect(entries[0].interactionId).toBe("int-p1");
                expect(entries[0].interactionType).toBe("question");
                expect(entries[0].message).toBe("Proceed?");
                expect(entries[0].choices).toEqual(["Yes", "No"]);
                expect(entries[0].defaultId).toBe(1);
                expect(entries[0].source).toBe("agent-a");
                expect(entries[0].requestId).toEqual(reqId);
            }

            // Verify second question fields survived round-trip
            if (entries[1].type === "pending-interaction") {
                expect(entries[1].interactionId).toBe("int-p2");
                expect(entries[1].interactionType).toBe("question");
                expect(entries[1].message).toBe("Choose");
                expect(entries[1].choices).toEqual(["opt1", "opt2", "opt3"]);
                expect(entries[1].defaultId).toBe(2);
            }

            // Verify proposeAction fields survived round-trip
            if (entries[2].type === "pending-interaction") {
                expect(entries[2].interactionId).toBe("int-p3");
                expect(entries[2].interactionType).toBe("proposeAction");
                expect(entries[2].actionTemplates).toEqual({ tpl: "data" });
            }

            // Verify interaction-resolved entries survived round-trip
            if (entries[3].type === "interaction-resolved") {
                expect(entries[3].interactionId).toBe("int-p1");
                expect(entries[3].response).toBe(1);
            }
            if (entries[4].type === "interaction-resolved") {
                expect(entries[4].interactionId).toBe("int-p2");
                expect(entries[4].response).toBe(1);
            }
            if (entries[5].type === "interaction-resolved") {
                expect(entries[5].interactionId).toBe("int-p3");
                expect(entries[5].response).toEqual({ accepted: true });
            }

            // Verify seq numbering resumes correctly after load
            loaded.logPendingInteraction({
                interactionId: "int-p4",
                type: "question",
                source: "agent-d",
                timestamp: Date.now(),
                message: "Another?",
                choices: ["Yes", "No"],
            } as unknown as PendingInteractionRequest);
            const allEntries = loaded.getEntries();
            expect(allEntries).toHaveLength(7);
            expect(allEntries[6].seq).toBe(6);
        });
    });
});
