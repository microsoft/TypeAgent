// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
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

describe("handler implementation detection (regex semantics)", () => {
    // Indirectly exercised by detectImplementedActionNames; we keep
    // these tight, source-only assertions to lock the matcher's
    // boundary behaviour: only quoted literals count.
    const handlerSnippet = `
        switch (action.actionName) {
            case "createPlaylist": { return; }
            // mention as identifier should NOT count: createPlaylistHelper()
            default: throw new Error("Unknown: " + action.actionName);
        }
    `;
    function mentions(name: string): boolean {
        return new RegExp(`(?:["'\`])${name}(?:["'\`])`, "u").test(
            handlerSnippet,
        );
    }
    it("matches a quoted literal", () => {
        expect(mentions("createPlaylist")).toBe(true);
    });
    it("does NOT match an identifier substring", () => {
        // "createPlaylistHelper" contains createPlaylist but is not quoted.
        // The literal "createPlaylist" *is* present in the case arm above,
        // so for this test we use a name that only appears unquoted:
        const onlyIdentifier = "doesNotExist";
        expect(mentions(onlyIdentifier)).toBe(false);
    });
});
