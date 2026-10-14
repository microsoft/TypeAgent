// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { catalogProducts, invoke, registerPageTools } from "./registry.mjs";
import { literalSpans } from "./schema.mjs";

const registry = await registerPageTools();
const products = catalogProducts();

const adapter = document.querySelector("#adapter");
adapter.textContent = registry.adapter;
adapter.dataset.native = String(registry.native);
adapter.dataset.adapter = registry.adapter;

const toolList = document.querySelector("#tools");
for (const tool of registry.tools) {
    const item = document.createElement("li");
    item.textContent = `${tool.name} · ${tool.policy} · ${tool.registered ? "registered" : "not registered"}`;
    toolList.append(item);
}

const grid = document.querySelector("#products");
for (const product of products) {
    const article = document.createElement("article");
    const image = document.createElement("img");
    image.src = `/images/${product.image}`;
    image.alt = "";
    image.width = 64;
    image.height = 64;
    const title = document.createElement("h2");
    title.textContent = product.name;
    const meta = document.createElement("p");
    meta.textContent = `${product.department} · ${product.dietary.join(", ")} · ${product.organic ? "organic" : "not organic"}`;
    article.append(image, title, meta);
    grid.append(article);
}

const department = document.querySelector("#department");
for (const value of [
    "",
    ...new Set(products.map((product) => product.department)),
]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "Any department";
    department.append(option);
}

document.querySelector("#search").onclick = () => {
    const text = document.querySelector("#query").value;
    const spans = literalSpans(text);
    const query = spans.find((span) => span.text === text.trim());
    const dietary = [
        ...document.querySelectorAll("[data-dietary]:checked"),
    ].map((input) => input.dataset.dietary);
    const organic = document.querySelector("#organic").value;
    const args = {};
    if (department.value) args.department = department.value;
    if (dietary.length) args.dietary = dietary;
    if (organic === "true" || organic === "false")
        args.organic = organic === "true";
    if (query) args.query = query;
    show(invoke("search_products", args, text));
};

document.querySelector("#details").onclick = () => {
    const name = document.querySelector("#product-name").value;
    const product = products.find((item) => item.name === name);
    show(
        invoke(
            "get_product_details",
            product ? { product_id: product.id } : {},
            name,
        ),
    );
};

document.querySelector("#denied").onclick = () => {
    show(invoke("checkout", {}, "checkout"));
};

globalThis.__grocery = {
    discovery: () => registry,
    invoke,
    literalSpans,
};

function show(result) {
    document.querySelector("#result").textContent = JSON.stringify(
        {
            status: result.status,
            reason: result.reason,
            executed: result.executed,
            mutated: result.mutated,
            names:
                result.products?.map((product) => product.name) ??
                (result.product ? [result.product.name] : []),
        },
        null,
        2,
    );
}
