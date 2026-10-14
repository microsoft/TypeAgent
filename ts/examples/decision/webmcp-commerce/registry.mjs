// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PRODUCTS, VENDOR_LABEL } from "./catalog.mjs";
import { execute } from "./execute.mjs";
import {
    deniedTools,
    eligibleTools,
    inputSchema,
    literalSpans,
} from "./schema.mjs";

export function discovery() {
    return {
        adapter: "local-registry-adapter",
        native: false,
        nativeClaim: false,
        vendorLabel: VENDOR_LABEL,
        tools: [
            ...eligibleTools().map((tool) => describe(tool, true)),
            ...deniedTools().map((tool) => describe(tool, false)),
        ],
    };
}

export async function registerPageTools(target = globalThis) {
    const adapter =
        typeof target.document?.modelContext?.registerTool === "function"
            ? "document.modelContext"
            : "navigator.modelContext";
    const native =
        adapter === "document.modelContext"
            ? target.document.modelContext
            : target.navigator?.modelContext;
    if (native && typeof native.registerTool === "function") {
        try {
            for (const tool of eligibleTools()) {
                await native.registerTool({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: inputSchema(tool),
                    execute: (input) =>
                        invoke(
                            tool.name,
                            input?.arguments ?? input,
                            input?.originalInput ?? "",
                        ),
                });
            }
            return {
                ...discovery(),
                adapter,
                native: true,
            };
        } catch {
            return discovery();
        }
    }
    return discovery();
}

export function invoke(name, args, originalInput) {
    const spans =
        typeof originalInput === "string" ? literalSpans(originalInput) : [];
    return execute(name, args, originalInput, spans);
}

export function catalogProducts() {
    return PRODUCTS.map((product) => ({
        id: product.id,
        name: product.name,
        department: product.department,
        dietary: [...product.dietary],
        organic: product.organic,
        priceCents: product.priceCents,
        image: product.image,
    }));
}

function describe(tool, registered) {
    return {
        name: tool.name,
        description: tool.description,
        policy: tool.policy,
        readOnly: tool.readOnly,
        registered,
        reason: registered ? "read_only_allow" : "denied_before_model",
        inputSchema: inputSchema(tool),
    };
}
