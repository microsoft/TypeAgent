// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { getLocalPlayerCommandInterface } from "../src/agent/localPlayerCommands.js";

describe("localPlayer command action links", () => {
    it("declares only action-equivalent command endpoints", async () => {
        const table = (await getLocalPlayerCommandInterface().getCommands(
            {} as any,
        )) as CommandDescriptorTable;
        const expected = {
            status: "status",
            play: "play",
            pause: "pause",
            resume: "resume",
            stop: "stop",
            next: "next",
            prev: "previous",
            folder: "showMusicFolder",
            setfolder: "setMusicFolder",
            list: "listFiles",
            queue: "showQueue",
            clear: "clearQueue",
            shuffle: "toggleShuffle",
            volume: "setVolume",
            mute: "toggleMute",
        };

        for (const [command, action] of Object.entries(expected)) {
            expect((table.commands[command] as CommandDescriptor).action).toBe(
                action,
            );
        }

        // Compare against the live table, not the literal above, so a command
        // added or removed without a matching action link fails here.
        expect(Object.keys(table.commands).sort()).toEqual(
            Object.keys(expected).sort(),
        );
    });
});
