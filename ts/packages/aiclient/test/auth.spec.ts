// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DefaultAzureCredential,
    ManagedIdentityCredential,
} from "@azure/identity";
import {
    createDefaultCredential,
    setAzureCredentialFactory,
} from "../src/auth.js";

describe("createDefaultCredential", () => {
    afterEach(() => {
        setAzureCredentialFactory();
    });

    test("uses the normal Azure credential chain by default", () => {
        expect(createDefaultCredential()).toBeInstanceOf(
            DefaultAzureCredential,
        );
    });

    test("uses an explicitly injected hosted credential factory", () => {
        const credential = new ManagedIdentityCredential(
            "00000000-0000-0000-0000-000000000001",
        );
        setAzureCredentialFactory(() => credential);

        expect(createDefaultCredential()).toBe(credential);
    });
});
