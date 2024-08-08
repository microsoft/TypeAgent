// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { createLanguageModel } from "typechat";
import { createTextClassifier, TextClassifier } from "typeagent"; // Adjust the import path accordingly
import { strict as assert } from "assert";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const model = createLanguageModel(process.env);

async function runClassifierTest() {
    const classifier: TextClassifier<string> =
        await createTextClassifier<string>(model);
    classifier.addClass({
        className: "CoffeeShop",
        description:
            "Order Coffee Drinks (Italian names included) and Baked Goods",
    });
    classifier.addClass({
        className: "Bookstore",
        description: "A bookstore that sells all kinds of books",
    });
    classifier.addClass({
        className: "Mystery Bookshop",
        description: "A bookstore that specializes in mystery books",
    });
    classifier.addClass({
        className: "Drugstore",
        description: "A drugstore that sells health and beauty products",
    });

    // Classify using the added classes
    const query = "I want to buy tylenol";
    const result = await classifier.classify(query);

    // Assertions
    assert.strictEqual(
        result.success,
        true,
        "Expected result.success to be true",
    );
    assert.ok(
        result.data && result.data.className === "Drugstore",
        "Expected result.data.class.name to be defined",
    );

    console.log("Standalone classification test passed!");
}

runClassifierTest();
