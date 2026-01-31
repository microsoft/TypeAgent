// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


using System.Diagnostics.CodeAnalysis;
using System.Net;

namespace TypeAgent.AIClient;

public class AzureModelApiSettings : ModelApiSettings
{
    public const int DefaultTimeoutMs = 60000;

    public AzureModelApiSettings(ModelType type, string endpoint, string apiKey)
        : base(ApiProvider.Azure, type, endpoint, apiKey)
    {

    }

    public override void Configure(HttpClient client)
    {
        ArgumentVerify.ThrowIfNull(client, nameof(client));

        if (ApiTokenProvider is null)
        {
            client.DefaultRequestHeaders.Add("api-key", ApiKey);
        }
    }

    private AzureModelApiSettings Configure()
    {
        if (ApiKey.Equals(IdentityApiKey, StringComparison.OrdinalIgnoreCase))
        {
            ApiTokenProvider = AzureTokenProvider.Default;
        }
        return this;
    }

    public static new AzureModelApiSettings FromEnv(ModelType modelType, string? endpointName = null)
    {
        AzureModelApiSettings? settings = null;
        switch (modelType)
        {
            default:
                break;

            case ModelType.Chat:
                settings = ChatSettingsFromEnv(endpointName);
                break;

            case ModelType.Embedding:
                settings = EmbeddingSettingsFromEnv(endpointName);
                break;
        }

        return settings is not null
            ? settings
            : throw new NotImplementedException();
    }

    public static AzureModelApiSettings ChatSettingsFromEnv(string? endpointName = null)
    {
        string endPoint = EnvVars.Get(
            EnvVars.AZURE_OPENAI_ENDPOINT,
            endpointName,
            null,
            endpointName is not null
        );

        var settings = new AzureModelApiSettings(
            ModelType.Chat,
            endPoint,
            EnvVars.Get(
                EnvVars.AZURE_OPENAI_API_KEY,
                endpointName,
                IdentityApiKey
            )
        ).Configure();
        settings.TimeoutMs = EnvVars.GetInt(EnvVars.AZURE_OPENAI_MAX_TIMEOUT, endpointName, DefaultTimeoutMs);
        settings.Retry.MaxRetries = EnvVars.GetInt(EnvVars.AZURE_OPENAI_MAX_RETRYATTEMPTS, endpointName, settings.Retry.MaxRetries);

        // Extract deployment name from endpoint URL if possible and a name wasn't provided
        if (!string.IsNullOrEmpty(endpointName))
        {
            settings.ModelName = endpointName;
        }
        else
        {
            settings.ModelName = "DEFAULT";
        }

            return settings;
    }

    public static AzureModelApiSettings EmbeddingSettingsFromEnv(string? endpointName = null)
    {
        // TODO: Load retry settings
        return new AzureModelApiSettings(
            ModelType.Embedding,
            EnvVars.Get(
                EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING,
                endpointName
            ),
            EnvVars.Get(
                EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
                endpointName,
                IdentityApiKey
            )
        ).Configure();
    }
}
