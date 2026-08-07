// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { executeLocalPlayerAction } from "../src/agent/localPlayerHandlers.js";

function makeContext(service: object) {
    return {
        sessionContext: {
            agentContext: { playerService: service, storage: undefined },
        },
    } as any;
}

function makeService(overrides: Record<string, unknown> = {}) {
    const state = {
        isPaused: false,
        isMuted: false,
        shuffle: false,
        currentIndex: 0,
        queue: [] as object[],
        ...((overrides.state as object | undefined) ?? {}),
    };
    const calls = {
        playFile: [] as unknown[][],
        playFolder: [] as unknown[][],
        playFromQueue: [] as unknown[][],
        resume: [] as unknown[][],
        setShuffle: [] as unknown[][],
        mute: [] as unknown[][],
        unmute: [] as unknown[][],
    };
    return {
        state,
        calls,
        getState: () => state,
        playFile: async (...args: unknown[]) => {
            calls.playFile.push(args);
            return true;
        },
        playFolder: async (...args: unknown[]) => {
            calls.playFolder.push(args);
            return true;
        },
        playFromQueue: async (...args: unknown[]) => {
            calls.playFromQueue.push(args);
            return true;
        },
        resume: (...args: unknown[]) => {
            calls.resume.push(args);
            return true;
        },
        setShuffle: (on: boolean) => {
            calls.setShuffle.push([on]);
            state.shuffle = on;
            return true;
        },
        mute: (...args: unknown[]) => {
            calls.mute.push(args);
            state.isMuted = true;
            return true;
        },
        unmute: (...args: unknown[]) => {
            calls.unmute.push(args);
            state.isMuted = false;
            return true;
        },
        ...overrides,
    };
}

async function run(service: object, action: object) {
    return executeLocalPlayerAction(
        { schemaName: "localPlayer", ...action } as any,
        makeContext(service),
    );
}

describe("localPlayer command-equivalent actions", () => {
    it("plays a named file when play includes fileName", async () => {
        const service = makeService();

        await run(service, {
            actionName: "play",
            parameters: { fileName: "sunrise.mp3" },
        });

        expect(service.calls.playFile).toEqual([["sunrise.mp3"]]);
    });

    it("resumes paused playback when play has no file", async () => {
        const service = makeService({ state: { isPaused: true } });

        await run(service, { actionName: "play" });

        expect(service.calls.resume).toHaveLength(1);
        expect(service.calls.playFolder).toHaveLength(0);
    });

    it("plays the current queue position when a queue exists", async () => {
        const service = makeService({
            state: { currentIndex: 2, queue: [{}, {}, {}] },
        });

        await run(service, { actionName: "play" });

        expect(service.calls.playFromQueue).toEqual([[3]]);
        expect(service.calls.playFolder).toHaveLength(0);
    });

    it("plays the music folder when there is no paused track or queue", async () => {
        const service = makeService();

        await run(service, { actionName: "play" });

        expect(service.calls.playFolder).toEqual([[undefined, false]]);
    });

    it("toggles shuffle in both directions", async () => {
        const service = makeService();

        await run(service, { actionName: "toggleShuffle" });
        await run(service, { actionName: "toggleShuffle" });

        expect(service.calls.setShuffle).toEqual([[true], [false]]);
    });

    it("toggles mute in both directions", async () => {
        const service = makeService();

        await run(service, { actionName: "toggleMute" });
        await run(service, { actionName: "toggleMute" });

        expect(service.calls.mute).toHaveLength(1);
        expect(service.calls.unmute).toHaveLength(1);
    });
});
