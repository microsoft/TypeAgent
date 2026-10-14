// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { productById, PRODUCTS } from "./catalog.mjs";
import { productGrounded, toolByName, validateArguments } from "./schema.mjs";

let mutations = 0;

export function resetMutations() {
    mutations = 0;
}

export function mutationCount() {
    return mutations;
}

export function searchProducts(args) {
    return PRODUCTS.filter((product) => {
        if (args.department && product.department !== args.department) {
            return false;
        }
        if (args.organic !== undefined && product.organic !== args.organic) {
            return false;
        }
        if (
            args.dietary?.length &&
            !args.dietary.every((tag) => product.dietary.includes(tag))
        ) {
            return false;
        }
        if (args.query?.text) {
            const query = args.query.text.toLowerCase();
            if (!product.name.toLowerCase().includes(query)) return false;
        }
        return true;
    }).map(publicProduct);
}

export function execute(name, args, original, candidates) {
    const tool = toolByName(name);
    if (!tool || tool.policy !== "allow" || tool.readOnly !== true) {
        return {
            status: "declined",
            reason: "policy_denied_before_execution",
            executed: false,
            mutated: false,
        };
    }
    const validated = validateArguments(tool, args, original, candidates);
    if (!validated.ok) {
        return {
            status: "failed_closed",
            reason: validated.reason,
            field: validated.field,
            executed: false,
            mutated: false,
        };
    }
    if (name === "search_products") {
        if (!Object.keys(validated.value).length) {
            return {
                status: "manual_handoff",
                reason: "missing_required",
                executed: false,
                mutated: false,
            };
        }
        return {
            status: "ok",
            tool: name,
            arguments: validated.value,
            products: searchProducts(validated.value),
            executed: true,
            mutated: false,
        };
    }
    if (
        !productGrounded(original, validated.value.product_id, candidates ?? [])
    ) {
        return {
            status: "manual_handoff",
            reason: "ungrounded_product",
            executed: false,
            mutated: false,
        };
    }
    const product = productById(validated.value.product_id);
    if (!product) {
        return {
            status: "failed_closed",
            reason: "unknown_product",
            executed: false,
            mutated: false,
        };
    }
    return {
        status: "ok",
        tool: name,
        arguments: validated.value,
        product: publicProduct(product),
        executed: true,
        mutated: false,
    };
}

function publicProduct(product) {
    return {
        id: product.id,
        name: product.name,
        department: product.department,
        dietary: [...product.dietary],
        organic: product.organic,
        priceCents: product.priceCents,
        image: product.image,
    };
}
