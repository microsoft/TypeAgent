// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpCredentialStore } from "../src/mcp/mcpCredentialStore.js";
import { McpOAuthProvider } from "../src/mcp/mcpOAuth.js";

class FakeStore implements McpCredentialStore {
    readonly values = new Map<string, string>();
    async get(ref: { name: string }) {
        return this.values.get(ref.name);
    }
    async set(name: string, value: string) {
        this.values.set(name, value);
        return { kind: "secure" as const, name };
    }
    async delete(ref: { name: string }) {
        this.values.delete(ref.name);
    }
}

describe("MCP OAuth provider", () => {
    it("persists tokens through the credential store and completes URL handoff", async () => {
        const store = new FakeStore();
        let handedOff: URL | undefined;
        const config = {
            id: "oauth",
            name: "oauth",
            enabled: true,
            trust: "trusted" as const,
            scope: "user" as const,
            provenance: { source: "test" },
            transport: {
                kind: "http" as const,
                url: "https://example.com/mcp",
            },
            oauth: {
                enabled: true,
                redirectUrl: "http://127.0.0.1/callback",
            },
        };
        const provider = new McpOAuthProvider(config, store, {
            async authorize(_name, url) {
                handedOff = url;
                return "http://127.0.0.1/callback?code=offline-code";
            },
        });
        await provider.saveTokens({
            access_token: "access-token",
            token_type: "bearer",
        });
        await expect(provider.tokens()).resolves.toMatchObject({
            access_token: "access-token",
        });
        await provider.redirectToAuthorization(
            new URL("https://login.example/authorize"),
        );
        let callbackParams: URLSearchParams | undefined;
        const finishAuth = async (params: URLSearchParams) => {
            callbackParams = params;
        };
        await expect(provider.finishAuth({ finishAuth } as any)).resolves.toBe(
            true,
        );
        expect(handedOff?.hostname).toBe("login.example");
        expect(callbackParams?.get("code")).toBe("offline-code");
        expect(JSON.stringify(config)).not.toContain("access-token");
    });
});
