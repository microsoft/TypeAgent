// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Persist references, never resolved secrets; only the host resolves credentials.
export type CredentialRef = {
    kind: "env" | "input" | "secure";
    name: string;
};

// Preserve template variables rather than baking credentials into config.
export type ValueTemplate = {
    value: string;
    variables: Record<string, string | CredentialRef>;
};

export type EnvValue = string | CredentialRef | ValueTemplate;
export type TrustLevel = "untrusted" | "trusted";
export type ConfigScope = "user" | "workspace" | "shipped";

export type McpInstallProvenance = {
    source: string;
    sourceKind?: string;
    ref?: string;
    version?: string;
    digest?: string;
    ownedPaths?: string[];
    registryBaseUrl?: string;
    npmRegistryUrl?: string;
    canonicalServerName?: string;
    serverVersion?: string;
    publisher?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    packageIdentifier?: string;
    packageVersion?: string;
    packageHash?: string;
    transportType?: string;
};

export type StdioTransport = {
    kind: "stdio";
    command: string;
    args?: EnvValue[];
    env?: Record<string, EnvValue>;
    cwd?: string;
};

export type HttpTransport = {
    kind: "http";
    url: string;
    urlVariables?: Record<string, string | CredentialRef>;
    headers?: Record<string, EnvValue>;
    timeoutMs?: number;
};

export type TransportConfig = StdioTransport | HttpTransport;

// Sources normalize this shape; trust, launch and credential policy stay in the host.
export type NormalizedMcpServerConfig = {
    id: string;
    name: string;
    description?: string;
    emojiChar?: string;
    transport: TransportConfig;
    enabledTools?: string[];
    deniedTools?: string[];
    toolApproval?: {
        prompt?: string[];
        allow?: string[];
        deny?: string[];
        persisted?: Record<string, "allow" | "deny">;
    };
    oauth?: {
        enabled: boolean;
        clientId?: string;
        scopes?: string[];
        redirectUrl?: string;
        tokensRef?: CredentialRef;
        clientInformationRef?: CredentialRef;
        verifierRef?: CredentialRef;
    };
    enabled: boolean;
    trust: TrustLevel;
    scope: ConfigScope;
    provenance: McpInstallProvenance;
};
