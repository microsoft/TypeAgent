import assert from "node:assert/strict";
import test from "node:test";
import { createGenerativeClient } from "./client.mjs";

test("schema appears in context and structured parameter; JSON and usage pass through", async () => {
    const schema = {
        type: "object",
        properties: { choice: { enum: ["ref", "no_fit"] } },
        required: ["choice"],
        additionalProperties: false,
    };
    const usage = { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 };
    const client = createGenerativeClient(
        {},
        { model: "test-model" },
        {
            async complete(prompt, callback, structured) {
                assert.ok(prompt[0].content.includes(JSON.stringify(schema)));
                assert.deepEqual(JSON.parse(prompt[1].content), {
                    task: "select",
                    evidence: ["ref"],
                });
                assert.deepEqual(structured, {
                    name: "generated_result",
                    strict: true,
                    schema,
                });
                callback(usage);
                return { success: true, data: '{"choice":"ref"}' };
            },
        },
    );
    const result = await client.generate("select", ["ref"], schema);
    assert.deepEqual(result.value, { choice: "ref" });
    assert.deepEqual(result.usage, usage);
    assert.equal(result.requestedModel, "test-model");
    assert.ok(result.latencyMs >= 0);
});

test("provider failures are sanitized and non-JSON is not repaired", async () => {
    for (const complete of [
        async () => {
            throw new Error("private provider credential body");
        },
        async () => ({ success: false, message: "private provider body" }),
        async () => ({ success: true, data: "```json\n{}\n```" }),
    ]) {
        const client = createGenerativeClient({}, {}, { complete });
        await assert.rejects(
            client.generate("task", {}, {}),
            /^Error: generative_(provider_failed|invalid_json)$/,
        );
    }
});
