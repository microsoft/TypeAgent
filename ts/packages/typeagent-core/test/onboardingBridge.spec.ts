// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { routeStudioConversation } from "../src/onboardingBridge/index.js";

describe("routeStudioConversation", () => {
    it("routes create/new agent intent to onboarding", () => {
        const r = routeStudioConversation("create a new agent for jira");
        expect(r.target).toBe("onboarding");
        expect(r.reason).toBe("create-agent-intent");
    });

    it("routes schema intent to schemaAuthor", () => {
        const r = routeStudioConversation("fix schema collision in player");
        expect(r.target).toBe("schemaAuthor");
        expect(r.reason).toBe("schema-edit-intent");
    });

    it("uses panel defaults when intent is ambiguous", () => {
        const wizard = routeStudioConversation("help me", {
            activePanel: "wizard",
        });
        expect(wizard.target).toBe("onboarding");

        const schemaStudio = routeStudioConversation("help me", {
            activePanel: "schemaStudio",
        });
        expect(schemaStudio.target).toBe("schemaAuthor");
    });
});
