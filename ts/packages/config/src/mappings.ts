// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SimpleConfigValueKind = "string" | "number" | "auth";

export interface SimpleConfigMapping {
    readonly envVar: string;
    readonly configPath: string;
    readonly valueKind: SimpleConfigValueKind;
    readonly omitEmptyInProjection?: boolean;
}

/**
 * Static leaf mappings shared by setup hints and the typed runtime converters.
 * Complex and pattern-based sections, such as Azure OpenAI deployments, remain
 * in their procedural converters.
 */
export const SIMPLE_CONFIG_MAPPINGS = {
    spotifyClientId: {
        envVar: "SPOTIFY_APP_CLI",
        configPath: "spotify.clientId",
        valueKind: "string",
    },
    spotifyClientSecret: {
        envVar: "SPOTIFY_APP_CLISEC",
        configPath: "spotify.clientSecret",
        valueKind: "string",
    },
    spotifyPort: {
        envVar: "SPOTIFY_APP_PORT",
        configPath: "spotify.port",
        valueKind: "number",
    },
    msGraphClientId: {
        envVar: "MSGRAPH_APP_CLIENTID",
        configPath: "msGraph.clientId",
        valueKind: "string",
    },
    msGraphClientSecret: {
        envVar: "MSGRAPH_APP_CLIENTSECRET",
        configPath: "msGraph.clientSecret",
        valueKind: "string",
    },
    msGraphTenantId: {
        envVar: "MSGRAPH_APP_TENANTID",
        configPath: "msGraph.tenantId",
        valueKind: "string",
    },
    msGraphUsername: {
        envVar: "MSGRAPH_APP_USERNAME",
        configPath: "msGraph.username",
        valueKind: "string",
    },
    msGraphPassword: {
        envVar: "MSGRAPH_APP_PASSWD",
        configPath: "msGraph.password",
        valueKind: "string",
    },
    googleCalendarClientId: {
        envVar: "GOOGLE_CALENDAR_CLIENT_ID",
        configPath: "googleCalendar.clientId",
        valueKind: "string",
    },
    googleCalendarClientSecret: {
        envVar: "GOOGLE_CALENDAR_CLIENT_SECRET",
        configPath: "googleCalendar.clientSecret",
        valueKind: "string",
    },
    speechAuth: {
        envVar: "SPEECH_SDK_KEY",
        configPath: "speech.auth",
        valueKind: "auth",
    },
    speechRegion: {
        envVar: "SPEECH_SDK_REGION",
        configPath: "speech.region",
        valueKind: "string",
    },
    speechEndpoint: {
        envVar: "SPEECH_SDK_ENDPOINT",
        configPath: "speech.endpoint",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
    mapsClientId: {
        envVar: "AZURE_MAPS_CLIENTID",
        configPath: "maps.clientId",
        valueKind: "string",
    },
    mapsEndpoint: {
        envVar: "AZURE_MAPS_ENDPOINT",
        configPath: "maps.endpoint",
        valueKind: "string",
    },
    wikipediaClientId: {
        envVar: "WIKIPEDIA_CLIENT_ID",
        configPath: "wikipedia.clientId",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
    wikipediaClientSecret: {
        envVar: "WIKIPEDIA_CLIENT_SECRET",
        configPath: "wikipedia.clientSecret",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
    wikipediaEndpoint: {
        envVar: "WIKIPEDIA_ENDPOINT",
        configPath: "wikipedia.endpoint",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
    azureStorageAccount: {
        envVar: "AZURE_STORAGE_ACCOUNT",
        configPath: "storage.azure.account",
        valueKind: "string",
    },
    azureStorageContainer: {
        envVar: "AZURE_STORAGE_CONTAINER",
        configPath: "storage.azure.container",
        valueKind: "string",
    },
    awsStorageBucketName: {
        envVar: "AWS_S3_BUCKET_NAME",
        configPath: "storage.aws.bucketName",
        valueKind: "string",
    },
    awsStorageRegion: {
        envVar: "AWS_S3_REGION",
        configPath: "storage.aws.region",
        valueKind: "string",
    },
    awsStorageAccessKeyId: {
        envVar: "AWS_ACCESS_KEY_ID",
        configPath: "storage.aws.accessKeyId",
        valueKind: "string",
    },
    awsStorageSecretAccessKey: {
        envVar: "AWS_SECRET_ACCESS_KEY",
        configPath: "storage.aws.secretAccessKey",
        valueKind: "string",
    },
    cosmosDbConnectionString: {
        envVar: "COSMOSDB_CONNECTION_STRING",
        configPath: "storage.database.cosmosDbConnectionString",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
    mongoDbConnectionString: {
        envVar: "MONGODB_CONNECTION_STRING",
        configPath: "storage.database.mongoDbConnectionString",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
    sharedVault: {
        envVar: "TYPEAGENT_SHAREDVAULT",
        configPath: "vault.shared",
        valueKind: "string",
        omitEmptyInProjection: true,
    },
} as const satisfies Record<string, SimpleConfigMapping>;

export const SIMPLE_CONFIG_MAPPING_LIST: readonly SimpleConfigMapping[] =
    Object.values(SIMPLE_CONFIG_MAPPINGS);

const CONFIG_MAPPING_BY_ENV_VAR = new Map(
    SIMPLE_CONFIG_MAPPING_LIST.map((mapping) => [mapping.envVar, mapping]),
);

export function simpleConfigMappingForEnvVar(
    envVar: string,
): SimpleConfigMapping | undefined {
    return CONFIG_MAPPING_BY_ENV_VAR.get(envVar);
}

export function simpleConfigMappingsForSection(
    section: string,
): readonly SimpleConfigMapping[] {
    const prefix = `${section}.`;
    return SIMPLE_CONFIG_MAPPING_LIST.filter((mapping) =>
        mapping.configPath.startsWith(prefix),
    );
}
