// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DefaultAzureCredential,
    ManagedIdentityCredential,
} from "@azure/identity";
import { createDefaultCredential } from "../src/auth.js";

describe("createDefaultCredential", () => {
    const originalMode = process.env.TYPEAGENT_AZURE_AUTH_MODE;
    const originalClientId =
        process.env.TYPEAGENT_API_MANAGED_IDENTITY_CLIENT_ID;

    afterEach(() => {
        restoreEnvironment("TYPEAGENT_AZURE_AUTH_MODE", originalMode);
        restoreEnvironment(
            "TYPEAGENT_API_MANAGED_IDENTITY_CLIENT_ID",
            originalClientId,
        );
    });

    test("uses the normal Azure credential chain by default", () => {
        delete process.env.TYPEAGENT_AZURE_AUTH_MODE;
        expect(createDefaultCredential()).toBeInstanceOf(
            DefaultAzureCredential,
        );
    });

    test("selects managed identity explicitly for the hosted API", () => {
        process.env.TYPEAGENT_AZURE_AUTH_MODE = "managed-identity";
        process.env.TYPEAGENT_API_MANAGED_IDENTITY_CLIENT_ID =
            "00000000-0000-0000-0000-000000000001";
        expect(createDefaultCredential()).toBeInstanceOf(
            ManagedIdentityCredential,
        );
    });

    test("rejects unknown authentication modes", () => {
        process.env.TYPEAGENT_AZURE_AUTH_MODE = "azure-cli";
        expect(() => createDefaultCredential()).toThrow(
            "Unsupported TYPEAGENT_AZURE_AUTH_MODE 'azure-cli'.",
        );
    });
});

function restoreEnvironment(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
