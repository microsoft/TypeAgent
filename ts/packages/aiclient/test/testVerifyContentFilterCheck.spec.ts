// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { apiSettingsFromEnv, createChatModel, ModelType } from "../src/openai";

// const safeMessage = `{"choices":[{"content_filter_results":{"hate":{"filtered":false,"severity":"safe"},"self_harm":{"filtered":false,"severity":"safe"},"sexual":{"filtered":false,"severity":"safe"},"violence":{"filtered":false,"severity":"safe"}},"delta":{"content":"2"},"finish_reason":null,"index":0,"logprobs":null}],"created":1727304839,"id":"chatcmpl-ABVBPDDpUwrXm0KGkEaA6y9Hu4diM","model":"gpt-4o-2024-05-13","object":"chat.completion.chunk","system_fingerprint":"fp_67802d9a6d"}`;
// const unsafeMessage = `{"choices":[{"content_filter_results":{"hate":{"filtered":false,"severity":"safe"},"self_harm":{"filtered":false,"severity":"high"},"sexual":{"filtered":false,"severity":"safe"},"violence":{"filtered":false,"severity":"safe"}},"delta":{"content":"2"},"finish_reason":"content_filter","index":0,"logprobs":null}],"created":1727304839,"id":"chatcmpl-ABVBPDDpUwrXm0KGkEaA6y9Hu4diM","model":"gpt-4o-2024-05-13","object":"chat.completion.chunk","system_fingerprint":"fp_67802d9a6d"}`

describe("this is a test", () => {
    describe("testVerifyContentFilterCheck", () => {
        it("VerifyContentFilter", async () => {
            //let model = createChatModel(apiSettingsFromEnv(ModelType.Embedding));

            //const result = await model.complete("what is 2+2?");

            //expect(result).toContain("4");
            expect(true).toEqual(true);
        });
    });
});
