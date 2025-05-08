// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getAllActionConfigProvider,
    getAssistantSelectionSchemas,
} from "agent-dispatcher/internal";
import { composeTranslatorSchemas } from "common-utils";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import { createTypeScriptJsonValidator } from "typechat/ts";

const { provider, schemaNames } = await getAllActionConfigProvider(
    getDefaultAppAgentProviders(undefined),
);

describe("Schema", () => {
    it("Assistant selection schema", () => {
        // TODO: mcpfilesystem schema can't be loaded without allowDirectory to start up the server.
        const switchSchemas = schemaNames.filter((n) => n != "mcpfilesystem");

        const schemas = getAssistantSelectionSchemas(
            switchSchemas,
            provider,
        ).map((entry) => entry.schema);

        const schema = composeTranslatorSchemas(
            "AllAssistantSelection",
            schemas,
        );

        const validator = createTypeScriptJsonValidator(
            schema,
            "AllAssistantSelection",
        );

        const result = validator.validate({
            assistant: "player",
            action: "playTrack",
        });

        if (!result.success) {
            console.error(schema);
            console.error(result.message);
        }
        expect(result.success).toBe(true);
    });
});
