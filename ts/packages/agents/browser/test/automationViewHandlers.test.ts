// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AutomationCatalogService,
    AutomationDetail,
    AutomationSummary,
} from "@typeagent/agent-flows/catalog";
import {
    createAutomationViewFunctions,
    type WebFlowSource,
} from "../src/agent/automationViewHandlers.mjs";

const webFlow = {
    name: "searchAmazon",
    description: "Search",
    scope: { type: "site", domains: ["amazon.com"] },
    source: { type: "recording" },
    script: "return 1;",
};

function webFlows(overrides: Partial<WebFlowSource> = {}): WebFlowSource {
    return {
        getAllWebFlows: async () => ({ actions: [webFlow] }),
        deleteWebFlow: async () => ({ success: true }),
        ...overrides,
    };
}

function catalogService(
    overrides: Partial<AutomationCatalogService> = {},
): AutomationCatalogService {
    const summary = { id: "toolMacro:m1" } as AutomationSummary;
    return {
        list: async () => ({
            items: [summary],
            providers: [
                { kind: "powershell", available: true },
                { kind: "taskflow", available: true },
                { kind: "toolMacro", available: true },
            ],
        }),
        get: async (id) => ({ id }) as AutomationDetail,
        validate: async () => ({ valid: true, issues: [] }),
        approve: async () => summary,
        disable: async () => summary,
        remove: async () => {},
        ...overrides,
    };
}

describe("automation view functions", () => {
    test("merges web macros with the catalog and keeps provider status", async () => {
        const functions = createAutomationViewFunctions(webFlows(), () =>
            catalogService(),
        );
        const result = await functions.listAutomations({});
        expect(result.items.map((i) => i.id)).toEqual([
            "webflow:searchAmazon",
            "toolMacro:m1",
        ]);
        expect(result.providers.map((p) => p.kind)).toEqual([
            "webflow",
            "powershell",
            "taskflow",
            "toolMacro",
        ]);
    });

    test("reports other kinds unavailable when no catalog service exists", async () => {
        const result = await createAutomationViewFunctions(
            webFlows(),
            () => undefined,
        ).listAutomations({});
        expect(result.items).toHaveLength(1);
        expect(
            result.providers
                .filter((p) => p.kind !== "webflow")
                .every((p) => !p.available),
        ).toBe(true);
    });

    test("a web macro failure does not hide the other kinds", async () => {
        const result = await createAutomationViewFunctions(
            webFlows({
                getAllWebFlows: async () => ({
                    success: false,
                    error: "No connection to browser session.",
                }),
            }),
            () => catalogService(),
        ).listAutomations({});
        expect(result.items.map((i) => i.id)).toEqual(["toolMacro:m1"]);
        expect(result.providers[0]).toEqual({
            kind: "webflow",
            available: false,
            reason: "No connection to browser session.",
        });
    });

    test("accepts the legacy array response shape", async () => {
        const result = await createAutomationViewFunctions(
            webFlows({ getAllWebFlows: async () => [webFlow] }),
            () => undefined,
        ).listAutomations({});
        expect(result.items[0].id).toBe("webflow:searchAmazon");
    });

    test("web macro detail comes from this agent, others from the catalog", async () => {
        const functions = createAutomationViewFunctions(webFlows(), () =>
            catalogService(),
        );
        expect(
            (await functions.getAutomation({ id: "webflow:searchAmazon" })).body
                ?.text,
        ).toBe("return 1;");
        expect((await functions.getAutomation({ id: "toolMacro:m1" })).id).toBe(
            "toolMacro:m1",
        );
        await expect(
            functions.getAutomation({ id: "webflow:missing" }),
        ).rejects.toThrow("not found");
        await expect(functions.getAutomation({ id: "bogus" })).rejects.toThrow(
            "Unknown automation id",
        );
    });

    test("delete routes web macros here and everything else to the catalog", async () => {
        const deleted: string[] = [];
        const removed: string[] = [];
        const functions = createAutomationViewFunctions(
            webFlows({
                deleteWebFlow: async ({ name }) => {
                    deleted.push(name);
                    return { success: true };
                },
            }),
            () =>
                catalogService({
                    remove: async (id) => {
                        removed.push(id);
                    },
                }),
        );
        await functions.deleteAutomation({ id: "webflow:searchAmazon" });
        await functions.deleteAutomation({ id: "toolMacro:m1" });
        expect(deleted).toEqual(["searchAmazon"]);
        expect(removed).toEqual(["toolMacro:m1"]);
    });

    test("deleting a missing web macro is an error", async () => {
        await expect(
            createAutomationViewFunctions(
                webFlows({
                    deleteWebFlow: async () => ({ success: false }),
                }),
                () => undefined,
            ).deleteAutomation({ id: "webflow:gone" }),
        ).rejects.toThrow("not found");
    });

    test("lifecycle verbs need the catalog service and pass its errors through", async () => {
        await expect(
            createAutomationViewFunctions(
                webFlows(),
                () => undefined,
            ).approveAutomation({ id: "toolMacro:m1" }),
        ).rejects.toThrow("not available");
        await expect(
            createAutomationViewFunctions(webFlows(), () =>
                catalogService({
                    approve: async () => {
                        throw new Error(
                            "Macro validation failed; approval was not recorded.",
                        );
                    },
                }),
            ).approveAutomation({ id: "toolMacro:m1" }),
        ).rejects.toThrow(
            "Macro validation failed; approval was not recorded.",
        );
    });
});
