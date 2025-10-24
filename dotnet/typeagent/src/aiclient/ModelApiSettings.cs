// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class ModelApiSettings : ApiSettings
{
    public enum ApiProvider
    {
        Azure,
        OpenAI
    }

    public ModelApiSettings(ApiProvider provider, ModelType type, string endpoint, string apiKey)
        : base(endpoint, apiKey)
    {
        Provider = provider;
        Type = type;
        ModelName = string.Empty;
    }

    public string ModelName { get; set; }

    public ApiProvider Provider { get; }

    public ModelType Type { get; }
}

public class AzureModelApiSettings : ModelApiSettings
{
    public AzureModelApiSettings(ModelType type, string endpoint, string apiKey)
        : base(ApiProvider.Azure, type, endpoint, apiKey)
    {

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

    private AzureModelApiSettings Configure()
    {
        if (ApiKey.Equals(IdentityApiKey, StringComparison.OrdinalIgnoreCase))
        {
            ApiTokenProvider = AzureTokenProvider.Default;
        }
        return this;
    }
}
