// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionAction } from "../src/context/system/schema/sessionActionSchema.js";

describe("SessionAction schema types", () => {
    it("should accept newSession with name", () => {
        const action: SessionAction = {
            actionName: "newSession",
            parameters: { name: "research" },
        };
        expect(action.actionName).toBe("newSession");
        expect(action.parameters.name).toBe("research");
    });

    it("should accept newSession without name", () => {
        const action: SessionAction = {
            actionName: "newSession",
            parameters: {},
        };
        expect(action.actionName).toBe("newSession");
        expect(action.parameters.name).toBeUndefined();
    });

    it("should accept listSession", () => {
        const action: SessionAction = {
            actionName: "listSession",
        };
        expect(action.actionName).toBe("listSession");
    });

    it("should accept showSessionInfo", () => {
        const action: SessionAction = {
            actionName: "showSessionInfo",
        };
        expect(action.actionName).toBe("showSessionInfo");
    });

    it("should accept switchSession with name", () => {
        const action: SessionAction = {
            actionName: "switchSession",
            parameters: { name: "work" },
        };
        expect(action.actionName).toBe("switchSession");
        expect(action.parameters.name).toBe("work");
    });

    it("should accept deleteSession with name", () => {
        const action: SessionAction = {
            actionName: "deleteSession",
            parameters: { name: "old-project" },
        };
        expect(action.actionName).toBe("deleteSession");
        expect(action.parameters.name).toBe("old-project");
    });
});
