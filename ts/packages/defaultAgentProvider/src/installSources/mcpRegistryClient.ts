// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type RegistryStatus = "active" | "deprecated" | "deleted";

export interface RegistryInput {
    value?: string | undefined;
    default?: string | undefined;
    isRequired?: boolean | undefined;
    isSecret?: boolean | undefined;
    format?: string | undefined;
}

export interface RegistryArgument extends RegistryInput {
    type: string;
    name?: string | undefined;
    valueHint?: string | undefined;
    variables?: Record<string, RegistryInput> | undefined;
}

export interface RegistryKeyValue extends RegistryInput {
    name: string;
    variables?: Record<string, RegistryInput> | undefined;
}

export interface RegistryTransport {
    type: string;
    url?: string | undefined;
    headers?: RegistryKeyValue[] | undefined;
    variables?: Record<string, RegistryInput> | undefined;
}

export interface RegistryPackage {
    registryType: string;
    identifier: string;
    version?: string | undefined;
    registryBaseUrl?: string | undefined;
    fileSha256?: string | undefined;
    runtimeHint?: string | undefined;
    runtimeArguments?: RegistryArgument[] | undefined;
    packageArguments?: RegistryArgument[] | undefined;
    environmentVariables?: RegistryKeyValue[] | undefined;
    transport: RegistryTransport;
}

export interface RegistryServer {
    name: string;
    title?: string | undefined;
    description: string;
    version: string;
    repository?: Record<string, unknown> | undefined;
    packages?: RegistryPackage[] | undefined;
    remotes?: RegistryTransport[] | undefined;
    publisher?: Record<string, unknown> | undefined;
}

export interface RegistryServerEntry {
    server: RegistryServer;
    meta: {
        status: RegistryStatus;
        statusMessage?: string | undefined;
        updatedAt?: string | undefined;
        publishedAt: string;
        isLatest: boolean;
    };
}

export interface RegistryListOptions {
    search?: string | undefined;
    version?: string | undefined;
    updatedSince?: string | undefined;
    includeDeleted?: boolean | undefined;
    limit?: number | undefined;
    maxPages?: number | undefined;
}

export interface McpRegistryClient {
    list(options?: RegistryListOptions): Promise<RegistryServerEntry[]>;
    get(
        name: string,
        version?: string,
    ): Promise<RegistryServerEntry | undefined>;
}

type FetchFn = typeof fetch;

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`MCP Registry returned invalid ${label}`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`MCP Registry returned invalid ${label}`);
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function parseInput(value: unknown): RegistryInput {
    const raw = object(value, "input");
    return {
        ...(optionalString(raw.value) === undefined
            ? {}
            : { value: optionalString(raw.value) }),
        ...(optionalString(raw.default) === undefined
            ? {}
            : { default: optionalString(raw.default) }),
        ...(typeof raw.isRequired === "boolean"
            ? { isRequired: raw.isRequired }
            : {}),
        ...(typeof raw.isSecret === "boolean"
            ? { isSecret: raw.isSecret }
            : {}),
        ...(optionalString(raw.format) === undefined
            ? {}
            : { format: optionalString(raw.format) }),
    };
}

function parseVariables(
    value: unknown,
): Record<string, RegistryInput> | undefined {
    if (value === undefined) {
        return undefined;
    }
    const raw = object(value, "variables");
    return Object.fromEntries(
        Object.entries(raw).map(([name, input]) => [name, parseInput(input)]),
    );
}

function parseKeyValues(value: unknown): RegistryKeyValue[] | undefined {
    if (value == null) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error("MCP Registry returned invalid key/value inputs");
    }
    return value.map((entry) => {
        const raw = object(entry, "key/value input");
        return {
            ...parseInput(raw),
            name: string(raw.name, "key/value input name"),
            ...(parseVariables(raw.variables) === undefined
                ? {}
                : { variables: parseVariables(raw.variables) }),
        };
    });
}

function parseArguments(value: unknown): RegistryArgument[] | undefined {
    if (value == null) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error("MCP Registry returned invalid arguments");
    }
    return value.map((entry) => {
        const raw = object(entry, "argument");
        return {
            ...parseInput(raw),
            type: string(raw.type, "argument type"),
            ...(optionalString(raw.name) === undefined
                ? {}
                : { name: optionalString(raw.name) }),
            ...(optionalString(raw.valueHint) === undefined
                ? {}
                : { valueHint: optionalString(raw.valueHint) }),
            ...(parseVariables(raw.variables) === undefined
                ? {}
                : { variables: parseVariables(raw.variables) }),
        };
    });
}

function parseTransport(value: unknown): RegistryTransport {
    const raw = object(value, "transport");
    return {
        type: string(raw.type, "transport type"),
        ...(optionalString(raw.url) === undefined
            ? {}
            : { url: optionalString(raw.url) }),
        ...(parseKeyValues(raw.headers) === undefined
            ? {}
            : { headers: parseKeyValues(raw.headers) }),
        ...(parseVariables(raw.variables) === undefined
            ? {}
            : { variables: parseVariables(raw.variables) }),
    };
}

function parsePackage(value: unknown): RegistryPackage {
    const raw = object(value, "package");
    return {
        registryType: string(raw.registryType, "package registryType"),
        identifier: string(raw.identifier, "package identifier"),
        transport: parseTransport(raw.transport),
        ...(optionalString(raw.version) === undefined
            ? {}
            : { version: optionalString(raw.version) }),
        ...(optionalString(raw.registryBaseUrl) === undefined
            ? {}
            : { registryBaseUrl: optionalString(raw.registryBaseUrl) }),
        ...(optionalString(raw.fileSha256) === undefined
            ? {}
            : { fileSha256: optionalString(raw.fileSha256) }),
        ...(optionalString(raw.runtimeHint) === undefined
            ? {}
            : { runtimeHint: optionalString(raw.runtimeHint) }),
        ...(parseArguments(raw.runtimeArguments) === undefined
            ? {}
            : { runtimeArguments: parseArguments(raw.runtimeArguments) }),
        ...(parseArguments(raw.packageArguments) === undefined
            ? {}
            : { packageArguments: parseArguments(raw.packageArguments) }),
        ...(parseKeyValues(raw.environmentVariables) === undefined
            ? {}
            : {
                  environmentVariables: parseKeyValues(
                      raw.environmentVariables,
                  ),
              }),
    };
}

export function parseRegistryEntry(value: unknown): RegistryServerEntry {
    const raw = object(value, "server entry");
    const serverRaw = object(raw.server, "server");
    const responseMeta = object(raw._meta, "server metadata");
    const metaRaw = object(
        responseMeta["io.modelcontextprotocol.registry/official"],
        "official registry metadata",
    );
    const status = string(metaRaw.status, "server status");
    if (!["active", "deprecated", "deleted"].includes(status)) {
        throw new Error(
            `MCP Registry returned unknown server status '${status}'`,
        );
    }
    const packages = serverRaw.packages;
    const remotes = serverRaw.remotes;
    return {
        server: {
            name: string(serverRaw.name, "server name"),
            description: string(serverRaw.description, "server description"),
            version: string(serverRaw.version, "server version"),
            ...(optionalString(serverRaw.title) === undefined
                ? {}
                : { title: optionalString(serverRaw.title) }),
            ...(serverRaw.repository === undefined
                ? {}
                : { repository: object(serverRaw.repository, "repository") }),
            ...(serverRaw._meta === undefined
                ? {}
                : {
                      publisher: object(serverRaw._meta, "publisher metadata"),
                  }),
            ...(packages == null
                ? {}
                : Array.isArray(packages)
                  ? { packages: packages.map(parsePackage) }
                  : (() => {
                        throw new Error(
                            "MCP Registry returned invalid packages",
                        );
                    })()),
            ...(remotes == null
                ? {}
                : Array.isArray(remotes)
                  ? { remotes: remotes.map(parseTransport) }
                  : (() => {
                        throw new Error(
                            "MCP Registry returned invalid remotes",
                        );
                    })()),
        },
        meta: {
            status: status as RegistryStatus,
            statusMessage: optionalString(metaRaw.statusMessage),
            updatedAt: optionalString(metaRaw.updatedAt),
            publishedAt: string(metaRaw.publishedAt, "publishedAt"),
            isLatest: metaRaw.isLatest === true,
        },
    };
}

export function createMcpRegistryClient(
    baseUrl: string,
    fetchFn: FetchFn = fetch,
    defaultMaxPages = 20,
): McpRegistryClient {
    const base = new URL(baseUrl);
    async function request(url: URL): Promise<unknown | undefined> {
        const response = await fetchFn(url, {
            headers: { accept: "application/json" },
        });
        if (response.status === 404) {
            return undefined;
        }
        if (!response.ok) {
            throw new Error(
                `MCP Registry request failed (${response.status} ${response.statusText})`,
            );
        }
        return response.json();
    }
    return {
        async list(options = {}) {
            const entries: RegistryServerEntry[] = [];
            let cursor: string | undefined;
            const maxPages = options.maxPages ?? defaultMaxPages;
            for (let page = 0; page < maxPages; page++) {
                const url = new URL("v0.1/servers", base);
                if (options.search !== undefined)
                    url.searchParams.set("search", options.search);
                if (options.version !== undefined)
                    url.searchParams.set("version", options.version);
                if (options.updatedSince !== undefined)
                    url.searchParams.set("updated_since", options.updatedSince);
                if (options.includeDeleted !== undefined)
                    url.searchParams.set(
                        "include_deleted",
                        String(options.includeDeleted),
                    );
                url.searchParams.set("limit", String(options.limit ?? 100));
                if (cursor !== undefined)
                    url.searchParams.set("cursor", cursor);
                const body = object(await request(url), "list response");
                if (!Array.isArray(body.servers)) {
                    throw new Error(
                        "MCP Registry returned invalid servers list",
                    );
                }
                entries.push(...body.servers.map(parseRegistryEntry));
                const metadata = object(body.metadata, "pagination metadata");
                cursor = optionalString(metadata.nextCursor);
                if (cursor === undefined) return entries;
            }
            throw new Error(
                `MCP Registry pagination exceeded the ${maxPages}-page limit`,
            );
        },
        async get(name, version = "latest") {
            const url = new URL(
                `v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
                base,
            );
            const body = await request(url);
            return body === undefined ? undefined : parseRegistryEntry(body);
        },
    };
}
