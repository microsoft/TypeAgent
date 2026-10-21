// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    ManagedIdentityCredential,
    type TokenCredential,
} from "@azure/identity";
import {
    applyToProcessEnv,
    buildConfig,
    fetchKeyVaultConfig,
    flatten,
    loadConfig,
    SIMPLE_CONFIG_MAPPING_LIST,
    type Config,
    type ConfigTree,
    type FlatEnv,
    type KeyVaultFetcher,
} from "@typeagent/config";

export const HOSTED_API_PROFILE = "hosted-azure-managed-identity-v1";
export const HOSTED_API_SECRET_NAME = "typeagent-api-hosted-config";

const HOSTED_DEPLOYMENTS = new Set(["gpt_6_luna", "embedding"]);
const REQUIRED_DEPLOYMENT = "gpt_6_luna";
const LEGACY_CONFIG_FILES = [".env", "config.local.yaml"];
const AZURE_KEY_VAULT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/;
const AZURE_KEY_VAULT_SECRET_NAME_PATTERN = /^[a-z0-9-]{1,127}$/i;
const AZURE_AI_HOSTNAME_PATTERN =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/;

const SCRUBBED_ENV_PREFIXES = [
    "AWS_",
    "AZURE_AI_SEARCH_",
    "AZURE_COSMOS_",
    "AZURE_MAPS_",
    "AZURE_OPENAI_",
    "AZURE_SPEECH_",
    "AZURE_STORAGE_",
    "BING_",
    "COSMOS_",
    "COSMOSDB_",
    "GOOGLE_",
    "MONGODB_",
    "MSGRAPH_",
    "MS_GRAPH_",
    "OPENAI_",
    "SPEECH_",
    "SPOTIFY_",
    "TYPEAGENT_CONFIG_",
    "TYPEAGENT_EMBEDDING_",
    "WIKIPEDIA_",
];

const APP_SERVICE_CONNECTION_PREFIXES = [
    "CUSTOMCONNSTR_",
    "MYSQLCONNSTR_",
    "POSTGRESQLCONNSTR_",
    "SQLAZURECONNSTR_",
    "SQLCONNSTR_",
];

const STATIC_CREDENTIAL_NAMES = new Set([
    "AZURE_CLIENT_CERTIFICATE_PASSWORD",
    "AZURE_CLIENT_CERTIFICATE_PATH",
    "AZURE_CLIENT_SECRET",
    "AZURE_FEDERATED_TOKEN_FILE",
    "AZURE_PASSWORD",
    "AZURE_USERNAME",
]);

const SAFE_HOSTED_ENVIRONMENT_NAMES = new Set([
    "IDENTITY_ENDPOINT",
    "IDENTITY_HEADER",
    "IDENTITY_SERVER_THUMBPRINT",
    "IMDS_ENDPOINT",
    "MSI_ENDPOINT",
    "MSI_SECRET",
    "TYPEAGENT_API_BOOTSTRAP",
    "TYPEAGENT_API_CONFIG_SECRET",
    "TYPEAGENT_API_CONFIG_VAULT",
    "TYPEAGENT_API_MANAGED_IDENTITY_CLIENT_ID",
    "TYPEAGENT_AZURE_AUTH_MODE",
]);

const REPOSITORY_CREDENTIAL_ENVIRONMENT_NAMES = new Set(
    SIMPLE_CONFIG_MAPPING_LIST.filter(
        (mapping) =>
            mapping.valueKind === "auth" ||
            hasCredentialName(mapping.envVar) ||
            hasCredentialName(mapping.configPath),
    ).map((mapping) => mapping.envVar),
);

export type HostedEndpointValidator = (url: URL, fieldPath: string) => void;

export interface HostedApiBootstrapOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly fetcher?: KeyVaultFetcher;
    readonly credential?: TokenCredential;
    readonly log?: (message: string) => void;
    readonly getUid?: () => number | undefined;
    readonly platform?: NodeJS.Platform;
    /** @internal Test-only endpoint policy for local mocked services. */
    readonly endpointValidator?: HostedEndpointValidator;
}

/**
 * Load the API runtime configuration. Local development preserves the existing
 * layered loader. The production image selects the hosted profile explicitly,
 * which takes the dedicated fail-closed path below.
 */
export async function loadApiRuntimeConfig(
    options: HostedApiBootstrapOptions = {},
): Promise<Config> {
    const env = options.env ?? process.env;
    const bootstrap = env.TYPEAGENT_API_BOOTSTRAP?.trim();
    if (bootstrap === undefined || bootstrap === "") {
        if (env !== process.env) {
            throw new Error(
                "A custom environment requires an explicit API bootstrap profile.",
            );
        }
        await loadConfig({ keyVault: {}, strict: false });
        return buildConfig(processEnvironmentToFlat(process.env));
    }
    if (bootstrap !== HOSTED_API_PROFILE) {
        throw new Error(
            `Unsupported TYPEAGENT_API_BOOTSTRAP profile '${bootstrap}'.`,
        );
    }
    return loadHostedApiRuntimeConfig(options);
}

/**
 * Fetch and install the dedicated hosted API routing profile. This path never
 * reads the shared TypeAgent secret, config.local.yaml, or the legacy .env.
 */
export async function loadHostedApiRuntimeConfig(
    options: HostedApiBootstrapOptions = {},
): Promise<Config> {
    const env = options.env ?? process.env;
    prepareRuntime(env, options);
    rejectStaticCredentialEnvironment(env);

    const vaultName = validateKeyVaultName(
        requiredEnvironmentValue(env, "TYPEAGENT_API_CONFIG_VAULT"),
    );
    const secretName = validateKeyVaultSecretName(
        env.TYPEAGENT_API_CONFIG_SECRET?.trim() || HOSTED_API_SECRET_NAME,
    );
    const clientId = env.TYPEAGENT_API_MANAGED_IDENTITY_CLIENT_ID?.trim();
    const credential =
        options.credential ??
        (clientId
            ? new ManagedIdentityCredential(clientId)
            : new ManagedIdentityCredential());

    let tree: ConfigTree | null;
    try {
        tree = await fetchKeyVaultConfig({
            vaultName,
            secretName,
            credential,
            ...(options.fetcher !== undefined
                ? { fetcher: options.fetcher }
                : {}),
            failOnError: true,
        });
    } catch {
        throw new Error(
            "Failed to fetch or validate the dedicated hosted API configuration secret.",
        );
    }
    if (tree === null) {
        throw new Error(
            "Dedicated hosted API configuration secret is missing or empty.",
        );
    }

    rejectCredentialFields(tree);
    const selected = selectHostedApiConfig(
        tree,
        options.endpointValidator ?? validateProductionEndpoint,
    );
    const flat = flatten(selected);
    const config = buildConfig(flat);
    validateRuntimeConfig(config);

    scrubLegacyConfiguration(env);
    applyToProcessEnv(config, { target: env, overwrite: true });
    env.TYPEAGENT_AZURE_AUTH_MODE = "managed-identity";
    if (clientId !== undefined) {
        env.AZURE_CLIENT_ID = clientId;
    }

    options.log?.(
        `Loaded hosted API profile '${HOSTED_API_PROFILE}' with managed identity.`,
    );
    return config;
}

function prepareRuntime(
    env: NodeJS.ProcessEnv,
    options: HostedApiBootstrapOptions,
): void {
    const getUid = options.getUid ?? (() => process.getuid?.());
    const uid = getUid();
    if (uid === undefined) {
        throw new Error(
            "Hosted API startup requires operating-system account inspection.",
        );
    }
    if (uid === 0) {
        throw new Error("Hosted API startup refuses to run as root.");
    }

    const home = requiredEnvironmentValue(env, "HOME");
    if (!path.isAbsolute(home)) {
        throw new Error("HOME must be an absolute path for hosted startup.");
    }
    if (fs.existsSync(path.join(home, ".azure"))) {
        throw new Error(
            "Hosted API startup refuses persistent Azure CLI credential state.",
        );
    }

    const userDataDir = requiredEnvironmentValue(
        env,
        "TYPEAGENT_USER_DATA_DIR",
    );
    if (
        path.resolve(userDataDir) !==
        path.resolve(path.join(home, ".typeagent"))
    ) {
        throw new Error(
            "TYPEAGENT_USER_DATA_DIR must be the dedicated runtime directory under HOME.",
        );
    }

    fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    const stats = fs.lstatSync(userDataDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error("TYPEAGENT_USER_DATA_DIR must be a real directory.");
    }
    fs.chmodSync(userDataDir, 0o700);
    const securedStats = fs.statSync(userDataDir);
    const platform = options.platform ?? process.platform;
    if (platform !== "win32") {
        if ((securedStats.mode & 0o777) !== 0o700) {
            throw new Error("TYPEAGENT_USER_DATA_DIR must have mode 0700.");
        }
        if (securedStats.uid !== uid) {
            throw new Error(
                "TYPEAGENT_USER_DATA_DIR must be owned by the runtime account.",
            );
        }
    }
    for (const fileName of LEGACY_CONFIG_FILES) {
        if (fs.existsSync(path.join(userDataDir, fileName))) {
            throw new Error(
                `Hosted API startup refuses stale ${fileName} configuration.`,
            );
        }
    }
}

function selectHostedApiConfig(
    tree: ConfigTree,
    endpointValidator: HostedEndpointValidator,
): ConfigTree {
    const root = expectRecord(tree, "<root>");
    rejectUnknownFields(
        root,
        new Set(["profile", "modelProvider", "azureOpenAI"]),
        "<root>",
    );
    if (expectString(root.profile, "profile") !== HOSTED_API_PROFILE) {
        throw new Error(`profile must be '${HOSTED_API_PROFILE}'.`);
    }
    if (expectString(root.modelProvider, "modelProvider") !== "azure") {
        throw new Error("modelProvider must be 'azure'.");
    }

    const azure = expectRecord(root.azureOpenAI, "azureOpenAI");
    rejectUnknownFields(
        azure,
        new Set([
            "defaultAuth",
            "maxConcurrency",
            "maxTimeoutMs",
            "maxRetryAttempts",
            "responseFormat",
            "maxPromptChars",
            "deployments",
        ]),
        "azureOpenAI",
    );
    if (
        expectString(azure.defaultAuth, "azureOpenAI.defaultAuth") !==
        "identity"
    ) {
        throw new Error("azureOpenAI.defaultAuth must be 'identity'.");
    }

    const deployments = expectRecord(
        azure.deployments,
        "azureOpenAI.deployments",
    );
    if (
        !Object.prototype.hasOwnProperty.call(deployments, REQUIRED_DEPLOYMENT)
    ) {
        throw new Error(
            `azureOpenAI.deployments.${REQUIRED_DEPLOYMENT} is required.`,
        );
    }

    const selectedDeployments: ConfigTree = {};
    for (const [name, value] of Object.entries(deployments)) {
        if (!HOSTED_DEPLOYMENTS.has(name)) {
            throw new Error(`Unsupported hosted API deployment '${name}'.`);
        }
        selectedDeployments[name] = selectDeployment(
            value,
            `azureOpenAI.deployments.${name}`,
            endpointValidator,
        );
    }

    const selectedAzure: ConfigTree = {
        defaultAuth: "identity",
        deployments: selectedDeployments,
    };
    copyOptionalPositiveInteger(
        azure,
        selectedAzure,
        "maxConcurrency",
        "azureOpenAI",
    );
    copyOptionalPositiveInteger(
        azure,
        selectedAzure,
        "maxTimeoutMs",
        "azureOpenAI",
    );
    copyOptionalNonNegativeInteger(
        azure,
        selectedAzure,
        "maxRetryAttempts",
        "azureOpenAI",
    );
    copyOptionalPositiveInteger(
        azure,
        selectedAzure,
        "maxPromptChars",
        "azureOpenAI",
    );
    if (azure.responseFormat !== undefined) {
        selectedAzure.responseFormat = expectBoolean(
            azure.responseFormat,
            "azureOpenAI.responseFormat",
        );
    }

    return {
        modelProvider: "azure",
        azureOpenAI: selectedAzure,
    };
}

function selectDeployment(
    value: unknown,
    fieldPath: string,
    endpointValidator: HostedEndpointValidator,
): ConfigTree {
    const deployment = expectRecord(value, fieldPath);
    rejectUnknownFields(
        deployment,
        new Set(["defaultCapacity", "endpoints"]),
        fieldPath,
    );
    if (
        !Array.isArray(deployment.endpoints) ||
        deployment.endpoints.length < 1
    ) {
        throw new Error(`${fieldPath}.endpoints must be a non-empty array.`);
    }

    const selected: ConfigTree = {
        endpoints: deployment.endpoints.map((endpoint, index) =>
            selectEndpoint(
                endpoint,
                `${fieldPath}.endpoints.${index}`,
                endpointValidator,
            ),
        ),
    };
    if (deployment.defaultCapacity !== undefined) {
        selected.defaultCapacity = expectPositiveInteger(
            deployment.defaultCapacity,
            `${fieldPath}.defaultCapacity`,
        );
    }
    return selected;
}

function selectEndpoint(
    value: unknown,
    fieldPath: string,
    endpointValidator: HostedEndpointValidator,
): ConfigTree {
    const endpoint = expectRecord(value, fieldPath);
    rejectUnknownFields(
        endpoint,
        new Set([
            "endpoint",
            "region",
            "mode",
            "priority",
            "capacity",
            "wireApi",
            "auth",
        ]),
        fieldPath,
    );

    const endpointUrl = expectString(
        endpoint.endpoint,
        `${fieldPath}.endpoint`,
    );
    validateEndpointUrl(endpointUrl, fieldPath, endpointValidator);
    const selected: ConfigTree = {
        endpoint: endpointUrl,
        region: expectString(endpoint.region, `${fieldPath}.region`),
    };

    if (endpoint.auth !== undefined) {
        if (expectString(endpoint.auth, `${fieldPath}.auth`) !== "identity") {
            throw new Error(`${fieldPath}.auth must be 'identity'.`);
        }
        selected.auth = "identity";
    }
    if (endpoint.mode !== undefined) {
        const mode = expectString(endpoint.mode, `${fieldPath}.mode`);
        if (mode !== "PAYG" && mode !== "PTU") {
            throw new Error(`${fieldPath}.mode must be PAYG or PTU.`);
        }
        selected.mode = mode;
    }
    if (endpoint.priority !== undefined) {
        selected.priority = expectPositiveInteger(
            endpoint.priority,
            `${fieldPath}.priority`,
        );
    }
    if (endpoint.capacity !== undefined) {
        selected.capacity =
            endpoint.capacity === null
                ? null
                : expectPositiveInteger(
                      endpoint.capacity,
                      `${fieldPath}.capacity`,
                  );
    }
    if (endpoint.wireApi !== undefined) {
        const wireApi = expectString(endpoint.wireApi, `${fieldPath}.wireApi`);
        if (
            wireApi !== "chat_completions" &&
            wireApi !== "responses" &&
            wireApi !== "messages"
        ) {
            throw new Error(
                `${fieldPath}.wireApi must be chat_completions, responses, or messages.`,
            );
        }
        selected.wireApi = wireApi;
    }
    return selected;
}

function validateEndpointUrl(
    value: string,
    fieldPath: string,
    endpointValidator: HostedEndpointValidator,
): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${fieldPath}.endpoint must be an absolute URL.`);
    }
    if (url.username !== "" || url.password !== "") {
        throw new Error(`${fieldPath}.endpoint must not contain credentials.`);
    }
    for (const key of url.searchParams.keys()) {
        if (/^(api[-_]?key|key|sig|secret|token)$/i.test(key)) {
            throw new Error(
                `${fieldPath}.endpoint must not contain credential query parameters.`,
            );
        }
    }
    endpointValidator(url, fieldPath);
}

function validateProductionEndpoint(url: URL, fieldPath: string): void {
    if (url.protocol !== "https:") {
        throw new Error(`${fieldPath}.endpoint must use HTTPS.`);
    }
    if (url.port !== "") {
        throw new Error(
            `${fieldPath}.endpoint must use the default HTTPS port.`,
        );
    }
    if (!AZURE_AI_HOSTNAME_PATTERN.test(url.hostname)) {
        throw new Error(
            `${fieldPath}.endpoint must use a supported Azure OpenAI or Azure AI Services hostname.`,
        );
    }
}

function validateRuntimeConfig(config: Config): void {
    if (config.modelProvider !== "azure") {
        throw new Error("Hosted API runtime provider validation failed.");
    }
    if (config.azureOpenAI.defaultAuth.kind !== "identity") {
        throw new Error("Hosted API runtime auth validation failed.");
    }
    const deployment = config.azureOpenAI.deployments.get(REQUIRED_DEPLOYMENT);
    if (deployment === undefined || deployment.endpoints.length === 0) {
        throw new Error("Hosted API runtime routing validation failed.");
    }
    for (const endpoint of config.azureOpenAI.deployments.values()) {
        if (
            endpoint.endpoints.some((entry) => entry.auth.kind !== "identity")
        ) {
            throw new Error("Hosted API endpoint auth validation failed.");
        }
    }
    if (
        config.openAI !== undefined ||
        config.speech !== undefined ||
        config.msGraph !== undefined ||
        config.googleCalendar !== undefined ||
        config.spotify !== undefined ||
        config.extra.size !== 0
    ) {
        throw new Error(
            "Hosted API runtime contains unsupported configuration.",
        );
    }
}

function rejectStaticCredentialEnvironment(env: NodeJS.ProcessEnv): void {
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined || value.trim() === "") {
            continue;
        }
        if (isSafeHostedEnvironmentVariable(key, value)) {
            continue;
        }
        if (isCredentialVariableName(key)) {
            delete env[key];
            rejected.push(key);
        }
    }
    if (rejected.length !== 0) {
        throw new Error(
            `Static credential environment variable '${rejected[0]}' is not allowed.`,
        );
    }
}

function isSafeHostedEnvironmentVariable(key: string, value: string): boolean {
    return (
        SAFE_HOSTED_ENVIRONMENT_NAMES.has(key) ||
        (key === "AZURE_OPENAI_API_KEY" && value.toLowerCase() === "identity")
    );
}

function scrubLegacyConfiguration(env: NodeJS.ProcessEnv): void {
    for (const key of Object.keys(env)) {
        const value = env[key] ?? "";
        if (isSafeHostedEnvironmentVariable(key, value)) {
            continue;
        }
        if (
            SCRUBBED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
            isCredentialVariableName(key) ||
            key === "TYPEAGENT_DEFAULT_EMBEDDING_MODEL" ||
            key === "TYPEAGENT_DOTENV" ||
            key === "TYPEAGENT_MODEL_PROVIDER" ||
            key === "TYPEAGENT_SHAREDVAULT" ||
            key === "AZURE_CLIENT_ID" ||
            key === "AZURE_TENANT_ID"
        ) {
            delete env[key];
        }
    }
}

function isCredentialVariableName(key: string): boolean {
    return (
        STATIC_CREDENTIAL_NAMES.has(key) ||
        REPOSITORY_CREDENTIAL_ENVIRONMENT_NAMES.has(key) ||
        APP_SERVICE_CONNECTION_PREFIXES.some((prefix) =>
            key.startsWith(prefix),
        ) ||
        hasCredentialName(key)
    );
}

function hasCredentialName(name: string): boolean {
    const normalized = name
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^a-z0-9]+/gi, "_")
        .toUpperCase();
    return /(?:^|_)(?:API_KEY|ACCESS_KEY|ACCOUNT_KEY|PRIVATE_KEY|KEY|SECRET|PASSWORD|PASSWD|TOKEN|CREDENTIAL|CONNECTION_STRING|SAS)(?:_|$)/.test(
        normalized,
    );
}

function rejectCredentialFields(value: unknown, fieldPath = "<root>"): void {
    if (Array.isArray(value)) {
        value.forEach((entry, index) =>
            rejectCredentialFields(entry, `${fieldPath}.${index}`),
        );
        return;
    }
    if (value === null || typeof value !== "object") {
        return;
    }
    for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
    )) {
        const pathName = fieldPath === "<root>" ? key : `${fieldPath}.${key}`;
        if (
            APP_SERVICE_CONNECTION_PREFIXES.some((prefix) =>
                key.toUpperCase().startsWith(prefix),
            ) ||
            hasCredentialName(key)
        ) {
            throw new Error(
                `Static credential field '${pathName}' is not allowed.`,
            );
        }
        rejectCredentialFields(child, pathName);
    }
}

function rejectUnknownFields(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    fieldPath: string,
): void {
    for (const key of Object.keys(value)) {
        if (allowed.has(key)) {
            continue;
        }
        const pathName = fieldPath === "<root>" ? key : `${fieldPath}.${key}`;
        if (hasCredentialName(key)) {
            throw new Error(
                `Static credential field '${pathName}' is not allowed.`,
            );
        }
        throw new Error(`Unsupported hosted API field '${pathName}'.`);
    }
}

function validateKeyVaultName(value: string): string {
    const normalized = value.toLowerCase();
    if (
        !AZURE_KEY_VAULT_NAME_PATTERN.test(normalized) ||
        normalized.includes("--")
    ) {
        throw new Error(
            "TYPEAGENT_API_CONFIG_VAULT must be a valid Azure Key Vault resource name.",
        );
    }
    return normalized;
}

function validateKeyVaultSecretName(value: string): string {
    if (!AZURE_KEY_VAULT_SECRET_NAME_PATTERN.test(value)) {
        throw new Error(
            "TYPEAGENT_API_CONFIG_SECRET must be a valid Azure Key Vault secret name.",
        );
    }
    return value;
}

function requiredEnvironmentValue(
    env: NodeJS.ProcessEnv,
    name: string,
): string {
    const value = env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required for hosted API startup.`);
    }
    return value;
}

function expectRecord(
    value: unknown,
    fieldPath: string,
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${fieldPath} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function expectString(value: unknown, fieldPath: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${fieldPath} must be a non-empty string.`);
    }
    return value;
}

function expectBoolean(value: unknown, fieldPath: string): boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${fieldPath} must be a boolean.`);
    }
    return value;
}

function expectPositiveInteger(value: unknown, fieldPath: string): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value <= 0
    ) {
        throw new Error(`${fieldPath} must be a positive integer.`);
    }
    return value;
}

function copyOptionalPositiveInteger(
    source: Record<string, unknown>,
    target: ConfigTree,
    key: string,
    parentPath: string,
): void {
    if (source[key] !== undefined) {
        target[key] = expectPositiveInteger(
            source[key],
            `${parentPath}.${key}`,
        );
    }
}

function copyOptionalNonNegativeInteger(
    source: Record<string, unknown>,
    target: ConfigTree,
    key: string,
    parentPath: string,
): void {
    if (source[key] === undefined) {
        return;
    }
    const value = source[key];
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new Error(`${parentPath}.${key} must be a non-negative integer.`);
    }
    target[key] = value;
}

function processEnvironmentToFlat(env: NodeJS.ProcessEnv): FlatEnv {
    const flat: FlatEnv = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            flat[key] = value;
        }
    }
    return flat;
}
