// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DispatcherName } from "../src/context/dispatcher/dispatcherUtils.js";
import type { UnknownAction } from "../src/context/dispatcher/schema/dispatcherActionSchema.js";
import { resolveTranslatedActionSchemaName } from "../src/translation/translateRequest.js";

describe("unknown action finalization", () => {
    it("resolves UnknownAction to the dispatcher schema", () => {
        const action: UnknownAction = {
            actionName: "unknown",
            parameters: {
                request: "do something unsupported",
                reason: "No matching action.",
            },
        };
        const translator = {
            getSchemaName: () => undefined,
        };

        expect(resolveTranslatedActionSchemaName(action, translator)).toBe(
            DispatcherName,
        );
    });
});
