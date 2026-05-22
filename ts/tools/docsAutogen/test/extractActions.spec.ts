// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import {
    detectImplementedActionNames,
    extractActionsFromSource,
    markImplementedActions,
    type AgentAction,
} from "../src/extractActions.js";

const photoLikeSchema = `// Copyright (c) Microsoft Corporation.

// Take a photograph using the system camera.
// Sample phrases:
//   - "take a photo"
//   - "snap a picture"
export type TakePhotoAction = {
    actionName: "takePhoto";
    parameters: {
        // Optional caption to attach to the resulting image.
        caption?: string;
        // Camera identifier (defaults to system default).
        cameraId: string;
    };
};
`;

const noParamsSchema = `// Refresh the current view.
export type RefreshAction = {
    actionName: "refresh";
};
`;

const multipleActionsSchema = `// Create a new playlist.
// Sample phrases:
//   - "create a playlist called workout"
export type CreatePlaylistAction = {
    actionName: "createPlaylist";
    parameters: {
        name: string;
    };
};

// Delete a playlist.
export type DeletePlaylistAction = {
    actionName: "deletePlaylist";
    parameters: {
        // Name of the playlist to remove.
        name: string;
    };
};
`;

describe("extractActionsFromSource", () => {
    it("extracts a single action with description, sample phrases, and parameters", () => {
        const actions = extractActionsFromSource(photoLikeSchema);
        expect(actions).toHaveLength(1);
        const a = actions[0]!;
        expect(a.typeName).toBe("TakePhotoAction");
        expect(a.actionName).toBe("takePhoto");
        expect(a.description).toMatch(/Take a photograph/u);
        expect(a.samplePhrases).toEqual(["take a photo", "snap a picture"]);
        expect(a.parameters).toHaveLength(2);
        const caption = a.parameters.find((p) => p.name === "caption")!;
        expect(caption.optional).toBe(true);
        expect(caption.type).toBe("string");
        expect(caption.description).toMatch(/Optional caption/u);
        const cameraId = a.parameters.find((p) => p.name === "cameraId")!;
        expect(cameraId.optional).toBe(false);
        expect(a.implemented).toBe(true);
    });

    it("returns an action with empty parameters when none declared", () => {
        const actions = extractActionsFromSource(noParamsSchema);
        expect(actions).toHaveLength(1);
        const a = actions[0]!;
        expect(a.actionName).toBe("refresh");
        expect(a.parameters).toEqual([]);
    });

    it("extracts every action when multiple are declared", () => {
        const actions = extractActionsFromSource(multipleActionsSchema);
        expect(actions.map((a: AgentAction) => a.actionName)).toEqual([
            "createPlaylist",
            "deletePlaylist",
        ]);
        expect(actions[1]!.parameters[0]!.description).toMatch(
            /Name of the playlist/u,
        );
    });

    it("returns an empty array when the source contains no action declarations", () => {
        expect(extractActionsFromSource("export const x = 1;\n")).toEqual([]);
    });
});

describe("markImplementedActions", () => {
    const actions = extractActionsFromSource(multipleActionsSchema);

    it("returns the input unchanged when implementedNames is null", () => {
        const out = markImplementedActions(actions, null);
        expect(out.map((a) => a.implemented)).toEqual([true, true]);
    });

    it("flips implemented to false for actions not in the set", () => {
        const out = markImplementedActions(
            actions,
            new Set(["createPlaylist"]),
        );
        const map = new Map(out.map((a) => [a.actionName, a.implemented]));
        expect(map.get("createPlaylist")).toBe(true);
        expect(map.get("deletePlaylist")).toBe(false);
    });

    it("flips implemented to false for every action when set is empty", () => {
        const out = markImplementedActions(actions, new Set());
        expect(out.every((a) => a.implemented === false)).toBe(true);
    });
});

describe("handler implementation detection (dispatch-context regex)", () => {
    // The detector requires the action name to appear in a dispatch
    // context — `case "X":` or `=== "X"` / `"X" ===`. Mentions in
    // comments, plain strings, or guard-list `Set` literals do NOT
    // count as implementation. These tests lock in that contract by
    // invoking the actual detector via `detectImplementedActionNames`
    // through a temporary file fixture.
    const tmpdir = path.join(
        os.tmpdir(),
        `docs-autogen-extractActions-${process.pid}-${Date.now()}`,
    );
    beforeAll(() => fs.mkdirSync(tmpdir, { recursive: true }));
    afterAll(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

    async function detect(
        source: string,
        names: readonly string[],
    ): Promise<Set<string>> {
        const file = path.join(tmpdir, `handler-${Math.random()}.ts`);
        fs.writeFileSync(file, source, "utf8");
        const out = await detectImplementedActionNames(file, names);
        fs.unlinkSync(file);
        if (!out) throw new Error("expected detector to return a non-null set");
        return out;
    }

    it("accepts a switch/case arm with a quoted literal", async () => {
        const src = `switch (action.actionName) { case "createPlaylist": return; }`;
        expect(await detect(src, ["createPlaylist"])).toEqual(
            new Set(["createPlaylist"]),
        );
    });

    it("accepts === equality on the right side of the action name", async () => {
        const src = `if (action.actionName === "addItems") { /* ... */ }`;
        expect(await detect(src, ["addItems"])).toEqual(new Set(["addItems"]));
    });

    it("accepts === equality on the left side of the action name", async () => {
        const src = `if ("addItems" === action.actionName) { /* ... */ }`;
        expect(await detect(src, ["addItems"])).toEqual(new Set(["addItems"]));
    });

    it("accepts double-equals (==) as well as triple", async () => {
        const src = `if (action.actionName == "addItems") { }`;
        expect(await detect(src, ["addItems"])).toEqual(new Set(["addItems"]));
    });

    it("accepts single-quoted and backtick string literals", async () => {
        const src = `case 'a': return; if (n === \`b\`) return;`;
        expect(await detect(src, ["a", "b"])).toEqual(new Set(["a", "b"]));
    });

    it("rejects a mention inside a // line comment", async () => {
        const src = `// TODO: handle case "addItems":\nreturn;`;
        expect(await detect(src, ["addItems"])).toEqual(new Set());
    });

    it("rejects a mention inside a /* block */ comment", async () => {
        const src = `/* later: case "addItems": */\nreturn;`;
        expect(await detect(src, ["addItems"])).toEqual(new Set());
    });

    it("rejects a mention as a JSDoc example", async () => {
        const src = `/**\n * Example: action.actionName === "addItems"\n */\nreturn;`;
        expect(await detect(src, ["addItems"])).toEqual(new Set());
    });

    it("rejects a bare string in a log message or import path", async () => {
        const src = [
            `import { foo } from "./addItems";`,
            `debug("addItems is handled");`,
            `const COMMENTARY = ["addItems is fun"];`,
        ].join("\n");
        expect(await detect(src, ["addItems"])).toEqual(new Set());
    });

    it("rejects membership in a guard-list Set / array (not a dispatch)", async () => {
        // Set membership names actions that *require a guard*; the
        // actual dispatch happens via case/=== elsewhere. If the
        // case/=== isn't there, we correctly mark it unimplemented.
        const src = `const GUILD_REQUIRED_ACTIONS = new Set(["joinGuild", "leaveGuild"]);`;
        expect(await detect(src, ["joinGuild", "leaveGuild"])).toEqual(
            new Set(),
        );
    });

    it("rejects an identifier substring (createPlaylistHelper)", async () => {
        const src = `function createPlaylistHelper() { return; }`;
        expect(await detect(src, ["createPlaylist"])).toEqual(new Set());
    });

    it("returns null when the handler file does not exist", async () => {
        const missing = path.join(tmpdir, "does-not-exist.ts");
        expect(await detectImplementedActionNames(missing, ["x"])).toBeNull();
    });

    it("handles a realistic dispatcher with a mix of dispatched and stub actions", async () => {
        const src = `
            const GUARD = new Set(["joinGuild"]);
            switch (action.actionName) {
                case "createMessage": { return; }
                case "getCurrentUser": { return; }
                default:
                    // "joinGuild" is named in GUARD but not dispatched.
                    throw new Error("Unknown action: " + action.actionName);
            }
        `;
        const out = await detect(src, [
            "createMessage",
            "getCurrentUser",
            "joinGuild",
        ]);
        expect(out).toEqual(new Set(["createMessage", "getCurrentUser"]));
    });
});
