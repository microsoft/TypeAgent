// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the MessageGroup keying contract (Option F: Two-Phase UUID Keying).
 *
 * The shell's ChatView keys MessageGroups by requestId.requestId (a UUID
 * assigned by the dispatcher via randomUUID()). This value is guaranteed
 * unique within a session, which allows the keying strategy to change in
 * the future without breaking cross-session replay or multi-client scenarios.
 *
 * These tests validate the keying logic in a DOM-free environment by
 * simulating the Map operations that ChatView performs.
 */

import { DisplayLog } from "../src/displayLog.js";
import type { RequestId } from "@typeagent/dispatcher-types";

/** Extracts the canonical MessageGroup key from a RequestId (mirrors chatView.ts). */
function getMessageGroupId(requestId: RequestId): string | undefined {
    const id = requestId.requestId;
    return id || undefined;
}

/**
 * Simulates the chatView MessageGroup map with lazy-promotion keying logic.
 * Uses strings as stand-ins for MessageGroup objects.
 *
 * Local MGs start in pendingLocalGroups. The first call to get() that carries
 * a matching clientRequestId promotes the MG into groups under the UUID key.
 * setUserRequest (handleSetUserRequest) only creates MGs for remote/replay;
 * it is a no-op for local commands since they are already pending.
 */
class TestMessageGroupMap {
    readonly groups = new Map<string, string>();
    readonly pendingLocalGroups = new Map<string, string>();

    /** Simulate addUserMessage: hold in pending map (NOT in groups) */
    addLocal(localId: string, label: string) {
        this.pendingLocalGroups.set(localId, label);
    }

    /** Simulate addRemoteUserMessage: create directly under canonical key */
    addRemote(requestId: RequestId, label: string) {
        const id = requestId.requestId;
        if (!id || this.groups.has(id)) return;
        // Don't create if this is actually a local command still pending
        const localId = requestId.clientRequestId as string | undefined;
        if (localId && this.pendingLocalGroups.has(localId)) return;
        this.groups.set(id, label);
    }

    /**
     * Simulate getMessageGroup: look up by canonical key, with lazy
     * promotion from pendingLocalGroups on first access.
     */
    get(requestId: RequestId): string | undefined {
        const id = getMessageGroupId(requestId);
        if (!id) return undefined;

        let mg = this.groups.get(id);
        if (mg !== undefined) return mg;

        // Lazy promotion: check if clientRequestId matches a pending local
        const clientId = requestId.clientRequestId as string | undefined;
        if (clientId) {
            const pending = this.pendingLocalGroups.get(clientId);
            if (pending) {
                this.pendingLocalGroups.delete(clientId);
                this.groups.set(id, pending);
                return pending;
            }
        }

        return undefined;
    }

    /** Simulate the setUserRequest handler in main.ts */
    handleSetUserRequest(requestId: RequestId, command: string) {
        // For remote clients or replay, creates a new MessageGroup.
        // For local clients, this is a no-op because addRemote skips
        // pending locals — they get promoted lazily by get().
        this.addRemote(requestId, command);
    }
}

describe("MessageGroup keying contract", () => {
    describe("getMessageGroupId", () => {
        it("should return requestId.requestId as canonical key", () => {
            const reqId: RequestId = {
                requestId: "uuid-abc",
                clientRequestId: "cmd-0",
            };
            expect(getMessageGroupId(reqId)).toBe("uuid-abc");
        });

        it("should return undefined for empty requestId", () => {
            const reqId: RequestId = { requestId: "" };
            expect(getMessageGroupId(reqId)).toBeUndefined();
        });

        it("should ignore clientRequestId", () => {
            const reqId: RequestId = {
                requestId: "uuid-def",
                clientRequestId: "cmd-99",
            };
            // getMessageGroupId should NOT return cmd-99
            expect(getMessageGroupId(reqId)).toBe("uuid-def");
        });
    });

    describe("lazy promotion of local commands", () => {
        it("should promote from pending on first output lookup", () => {
            const map = new TestMessageGroupMap();

            // Phase 1: User types command → held in pending
            map.addLocal("cmd-0", "user-command-1");
            expect(map.pendingLocalGroups.has("cmd-0")).toBe(true);
            expect(map.groups.has("cmd-0")).toBe(false);

            // Phase 2: setUserRequest arrives — no-op for local client
            const reqId: RequestId = {
                requestId: "uuid-aaa",
                connectionId: "conn-1",
                clientRequestId: "cmd-0",
            };
            map.handleSetUserRequest(reqId, "user-command-1");
            // Still pending — not yet promoted
            expect(map.pendingLocalGroups.has("cmd-0")).toBe(true);
            expect(map.groups.has("uuid-aaa")).toBe(false);

            // Phase 3: First output message triggers lazy promotion
            const result = map.get(reqId);
            expect(result).toBe("user-command-1");

            // Now promoted: in groups under UUID, removed from pending
            expect(map.groups.has("uuid-aaa")).toBe(true);
            expect(map.pendingLocalGroups.has("cmd-0")).toBe(false);
        });

        it("should allow output lookup by UUID after promotion", () => {
            const map = new TestMessageGroupMap();

            map.addLocal("cmd-0", "my-command");
            map.handleSetUserRequest(
                {
                    requestId: "uuid-bbb",
                    clientRequestId: "cmd-0",
                },
                "my-command",
            );

            // First output triggers promotion
            const outputReqId: RequestId = {
                requestId: "uuid-bbb",
                clientRequestId: "cmd-0",
            };
            expect(map.get(outputReqId)).toBe("my-command");

            // Subsequent lookups by UUID only (no clientRequestId) still work
            expect(map.get({ requestId: "uuid-bbb" })).toBe("my-command");
        });

        it("should handle multiple commands without cross-contamination", () => {
            const map = new TestMessageGroupMap();

            // Two commands in sequence
            map.addLocal("cmd-0", "first");
            map.handleSetUserRequest(
                { requestId: "uuid-1", clientRequestId: "cmd-0" },
                "first",
            );

            map.addLocal("cmd-1", "second");
            map.handleSetUserRequest(
                { requestId: "uuid-2", clientRequestId: "cmd-1" },
                "second",
            );

            // Promote both via output lookup
            expect(
                map.get({ requestId: "uuid-1", clientRequestId: "cmd-0" }),
            ).toBe("first");
            expect(
                map.get({ requestId: "uuid-2", clientRequestId: "cmd-1" }),
            ).toBe("second");

            expect(map.groups.has("cmd-0")).toBe(false);
            expect(map.groups.has("cmd-1")).toBe(false);
            expect(map.pendingLocalGroups.size).toBe(0);
        });
    });

    describe("remote client flow", () => {
        it("should create MessageGroup directly with UUID", () => {
            const map = new TestMessageGroupMap();

            map.handleSetUserRequest(
                {
                    requestId: "uuid-remote-1",
                    connectionId: "other-conn",
                    clientRequestId: "their-cmd-0",
                },
                "remote command",
            );

            expect(map.groups.has("uuid-remote-1")).toBe(true);
            expect(map.groups.get("uuid-remote-1")).toBe("remote command");
            // Should NOT store under their clientRequestId
            expect(map.groups.has("their-cmd-0")).toBe(false);
        });

        it("should not duplicate on repeated setUserRequest", () => {
            const map = new TestMessageGroupMap();
            const reqId: RequestId = {
                requestId: "uuid-dupe",
                clientRequestId: "x",
            };

            map.handleSetUserRequest(reqId, "first");
            map.handleSetUserRequest(reqId, "second");

            expect(map.groups.get("uuid-dupe")).toBe("first");
        });
    });

    describe("cross-session replay (no collisions)", () => {
        it("should not collide when replayed clientRequestIds match current session", () => {
            const map = new TestMessageGroupMap();

            // Current session: user types a command → "cmd-0" temp key
            map.addLocal("cmd-0", "current-session-cmd");
            map.handleSetUserRequest(
                {
                    requestId: "uuid-current",
                    clientRequestId: "cmd-0",
                },
                "current-session-cmd",
            );

            // Promote via output lookup
            map.get({ requestId: "uuid-current", clientRequestId: "cmd-0" });

            // Replay from previous session: also had "cmd-0" as clientRequestId
            // but different UUID
            map.handleSetUserRequest(
                {
                    requestId: "uuid-previous-session",
                    clientRequestId: "cmd-0",
                },
                "old-session-cmd",
            );

            // Both exist as separate entries keyed by their unique UUIDs
            expect(map.get({ requestId: "uuid-current" })).toBe(
                "current-session-cmd",
            );
            expect(map.get({ requestId: "uuid-previous-session" })).toBe(
                "old-session-cmd",
            );
        });

        it("should replay full command sequence from DisplayLog", () => {
            // Simulate a previous session's display log
            const log = new DisplayLog(undefined);
            const req1: RequestId = {
                requestId: "uuid-old-1",
                connectionId: "old-conn",
                clientRequestId: "cmd-0",
            };
            const req2: RequestId = {
                requestId: "uuid-old-2",
                connectionId: "old-conn",
                clientRequestId: "cmd-1",
            };

            log.logUserRequest(req1, "first command");
            log.logSetDisplay({
                message: "response 1",
                requestId: req1,
                source: "agent",
            });
            log.logUserRequest(req2, "second command");
            log.logSetDisplay({
                message: "response 2",
                requestId: req2,
                source: "agent",
            });

            // Replay into a new session's map
            const map = new TestMessageGroupMap();
            const entries = log.getEntries();
            for (const entry of entries) {
                switch (entry.type) {
                    case "user-request":
                        map.handleSetUserRequest(
                            entry.requestId,
                            entry.command,
                        );
                        break;
                    case "set-display":
                        // Verify output can find its MessageGroup
                        expect(map.get(entry.message.requestId)).toBeDefined();
                        break;
                }
            }

            expect(map.groups.size).toBe(2);
            expect(map.get({ requestId: "uuid-old-1" })).toBe("first command");
            expect(map.get({ requestId: "uuid-old-2" })).toBe("second command");
        });
    });

    describe("mixed local + remote + replay", () => {
        it("should correctly route all message types simultaneously", () => {
            const map = new TestMessageGroupMap();

            // Replay from previous session
            map.handleSetUserRequest(
                { requestId: "uuid-replay-1", clientRequestId: "cmd-0" },
                "replayed",
            );

            // Local user types a command (same clientRequestId as replayed)
            map.addLocal("cmd-0", "local-cmd");
            map.handleSetUserRequest(
                { requestId: "uuid-local-1", clientRequestId: "cmd-0" },
                "local-cmd",
            );

            // Promote local via output
            map.get({ requestId: "uuid-local-1", clientRequestId: "cmd-0" });

            // Remote user's command
            map.handleSetUserRequest(
                {
                    requestId: "uuid-remote-1",
                    connectionId: "other",
                    clientRequestId: "their-cmd-0",
                },
                "remote-cmd",
            );

            // All three are separate MessageGroups
            expect(map.groups.size).toBe(3);
            expect(map.get({ requestId: "uuid-replay-1" })).toBe("replayed");
            expect(map.get({ requestId: "uuid-local-1" })).toBe("local-cmd");
            expect(map.get({ requestId: "uuid-remote-1" })).toBe("remote-cmd");
        });
    });
});
