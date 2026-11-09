// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    OAuthClientMetadata,
    OAuthClientProvider,
    StoredOAuthClientInformation,
    StoredOAuthTokens,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { McpCredentialStore } from "./mcpCredentialStore.js";
import type {
    CredentialRef,
    NormalizedMcpServerConfig,
} from "./mcpServerConfig.js";

export interface McpOAuthInteraction {
    authorize(serverName: string, authorizationUrl: URL): Promise<string | URL>;
}

export type McpAuthState =
    | "not-configured"
    | "signed-out"
    | "authorization-required"
    | "authenticated";

async function readJson<T>(
    store: McpCredentialStore,
    ref: CredentialRef | undefined,
): Promise<T | undefined> {
    if (ref === undefined) return undefined;
    const value = await store.get(ref);
    return value === undefined ? undefined : (JSON.parse(value) as T);
}

export class McpOAuthProvider implements OAuthClientProvider {
    private authorizationUrl: URL | undefined;
    private codeVerifierValue: string | undefined;
    private stateValue: string | undefined;

    public constructor(
        private readonly config: NormalizedMcpServerConfig,
        private readonly store: McpCredentialStore,
        private readonly interaction?: McpOAuthInteraction,
    ) {}

    get redirectUrl(): URL {
        return new URL(
            this.config.oauth?.redirectUrl ??
                "http://127.0.0.1/typeagent-mcp-oauth",
        );
    }

    get clientMetadata(): OAuthClientMetadata {
        return {
            client_name: "TypeAgent",
            redirect_uris: [this.redirectUrl.toString()],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
            ...(this.config.oauth?.scopes === undefined
                ? {}
                : { scope: this.config.oauth.scopes.join(" ") }),
        };
    }

    async clientInformation(): Promise<
        StoredOAuthClientInformation | undefined
    > {
        const stored = await readJson<StoredOAuthClientInformation>(
            this.store,
            this.config.oauth?.clientInformationRef ?? {
                kind: "secure",
                name: `mcp:${this.config.id}:oauth-client`,
            },
        );
        if (stored !== undefined) return stored;
        const clientId = this.config.oauth?.clientId;
        return clientId === undefined ? undefined : { client_id: clientId };
    }

    async saveClientInformation(
        value: StoredOAuthClientInformation,
    ): Promise<void> {
        await this.store.set(
            `mcp:${this.config.id}:oauth-client`,
            JSON.stringify(value),
            { durable: true },
        );
    }

    async tokens(): Promise<StoredOAuthTokens | undefined> {
        return readJson(
            this.store,
            this.config.oauth?.tokensRef ?? {
                kind: "secure",
                name: `mcp:${this.config.id}:oauth-tokens`,
            },
        );
    }

    async saveTokens(value: StoredOAuthTokens): Promise<void> {
        await this.store.set(
            `mcp:${this.config.id}:oauth-tokens`,
            JSON.stringify(value),
            { durable: true },
        );
    }

    async redirectToAuthorization(url: URL): Promise<void> {
        this.authorizationUrl = url;
    }

    async saveCodeVerifier(value: string): Promise<void> {
        this.codeVerifierValue = value;
        try {
            await this.store.set(`mcp:${this.config.id}:oauth-verifier`, value);
        } catch {}
    }

    async codeVerifier(): Promise<string> {
        const value =
            this.codeVerifierValue ??
            (this.config.oauth?.verifierRef === undefined
                ? await this.store.get({
                      kind: "secure",
                      name: `mcp:${this.config.id}:oauth-verifier`,
                  })
                : await this.store.get(this.config.oauth.verifierRef));
        if (value === undefined) {
            throw new Error("OAuth PKCE verifier is unavailable.");
        }
        return value;
    }

    async finishAuth(
        transport: StreamableHTTPClientTransport,
    ): Promise<boolean> {
        if (this.authorizationUrl === undefined) return false;
        if (this.interaction === undefined) {
            throw new Error(
                `MCP server '${this.config.name}' requires OAuth authorization. Run '@package mcp auth ${this.config.name}' on a host with an OAuth interaction provider.`,
            );
        }
        const callback = await this.interaction.authorize(
            this.config.name,
            this.authorizationUrl,
        );
        const callbackParams = new URL(callback.toString(), this.redirectUrl)
            .searchParams;
        if (
            this.stateValue !== undefined &&
            callbackParams.get("state") !== this.stateValue
        ) {
            throw new Error("OAuth callback state did not match the request.");
        }
        await transport.finishAuth(callbackParams);
        return true;
    }

    async state(): Promise<string> {
        this.stateValue = crypto.randomUUID();
        return this.stateValue;
    }
}

export async function getMcpAuthState(
    config: NormalizedMcpServerConfig,
    store: McpCredentialStore,
): Promise<McpAuthState> {
    if (config.oauth?.enabled !== true) return "not-configured";
    return (await readJson(
        store,
        config.oauth.tokensRef ?? {
            kind: "secure",
            name: `mcp:${config.id}:oauth-tokens`,
        },
    )) === undefined
        ? "signed-out"
        : "authenticated";
}
