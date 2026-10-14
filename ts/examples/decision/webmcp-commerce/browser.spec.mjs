// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { openBrowser } from "../web-shopping/browser.mjs";
import { mutationCount, resetMutations } from "./execute.mjs";
import { startServer } from "./server.mjs";

let server;
let browser;

before(async () => {
    server = await startServer();
    browser = await openBrowser();
    await browser.page.goto(`${server.url}/`);
});

after(async () => {
    await browser?.close();
    await server?.close();
});

test("local page reports the registry adapter and does not claim native WebMCP", async () => {
    const discovery = await browser.page.evaluate(() =>
        window.__grocery.discovery(),
    );
    assert.equal(discovery.adapter, "local-registry-adapter");
    assert.equal(discovery.native, false);
    assert.equal(discovery.nativeClaim, false);
    assert.deepEqual(
        discovery.tools
            .filter((tool) => tool.registered)
            .map((tool) => tool.name),
        ["search_products", "get_product_details"],
    );
    assert.equal(
        discovery.tools.find((tool) => tool.name === "checkout").registered,
        false,
    );
    const schema = discovery.tools.find(
        (tool) => tool.name === "search_products",
    ).inputSchema;
    assert.deepEqual(schema.properties.department.enum, [
        "produce",
        "bakery",
        "dairy",
        "pantry",
    ]);
    assert.equal(schema.properties.dietary.uniqueItems, true);
    assert.equal(schema.properties.organic.type, "boolean");
    assert.equal(schema.additionalProperties, false);
});

test("document modelContext registers only allowed tools", async () => {
    const page = await browser.context.newPage();
    try {
        await page.addInitScript(() => {
            globalThis.registeredToolNames = [];
            Object.defineProperty(document, "modelContext", {
                value: {
                    registerTool(tool) {
                        globalThis.registeredToolNames.push(tool.name);
                    },
                },
            });
        });
        await page.goto(`${server.url}/`);
        const result = await page.evaluate(() => ({
            discovery: window.__grocery.discovery(),
            names: globalThis.registeredToolNames,
        }));
        assert.equal(result.discovery.adapter, "document.modelContext");
        assert.equal(result.discovery.native, true);
        assert.deepEqual(result.names, [
            "search_products",
            "get_product_details",
        ]);
        assert.equal(
            await page.locator("#adapter").innerText(),
            "document.modelContext",
        );
    } finally {
        await page.close();
    }
});

test("browser can invoke read-only tools and rejects invalid enums, spans, and checkout", async () => {
    resetMutations();
    const search = await browser.page.evaluate(() => {
        const request = "Show organic kale";
        const span = window.__grocery
            .literalSpans(request)
            .find((item) => item.text === "kale");
        return window.__grocery.invoke(
            "search_products",
            {
                department: "produce",
                dietary: ["vegan", "gluten-free"],
                organic: true,
                query: span,
            },
            request,
        );
    });
    assert.equal(search.status, "ok");
    assert.deepEqual(
        search.products.map((product) => product.name),
        ["Kale Bunch"],
    );
    assert.equal(search.arguments.query.text, "kale");
    const invalid = await browser.page.evaluate(() =>
        window.__grocery.invoke(
            "search_products",
            { department: "weapons", dietary: ["vegan", "vegan"] },
            "kale",
        ),
    );
    assert.equal(invalid.executed, false);
    const longSpan = "a".repeat(49);
    const length = await browser.page.evaluate((text) => {
        return window.__grocery.invoke(
            "search_products",
            { query: { id: "span:0:49", text, start: 0, end: 49 } },
            text,
        );
    }, longSpan);
    assert.equal(length.executed, false);
    const denied = await browser.page.evaluate(() =>
        window.__grocery.invoke("checkout", {}, "checkout"),
    );
    assert.equal(denied.status, "declined");
    assert.equal(denied.mutated, false);
    assert.equal(mutationCount(), 0);
    assert.equal(browser.page.url().startsWith(server.url), true);
});
