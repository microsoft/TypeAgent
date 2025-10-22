// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class ApiSettings
{
    public enum ApiProvider
    {
        Azure,
        OpenAI
    }

    public ApiSettings(ApiProvider provider, ModelType type, string endpoint, string apiKey)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(endpoint, nameof(endpoint));
        ArgumentVerify.ThrowIfNullOrEmpty(apiKey, nameof(apiKey));

        Provider = provider;
        Type = type;
        Endpoint = endpoint;
        ApiKey = apiKey;
        Model = string.Empty;
    }

    public ApiProvider Provider { get; }

    public ModelType Type { get; }

    public string Endpoint { get; }

    public string ApiKey { get; }

    public string Model { get; set; }
    /// <summary>
    /// Http Settings
    /// </summary>
    public int TimeoutMs { get; set; } = 15 * 1000;

    public int MaxRetries { get; set; } = 3;

    public int MaxPauseMs { get; set; } = 1000; // 1000 milliseconds

    /// <summary>
    /// When provided, gets Api token from this provider
    /// </summary>
    public IApiTokenProvider? ApiTokenProvider { get; protected set; }

    public virtual void Configure(HttpClient client) { }

}

public class AzureApiSettings : ApiSettings
{
    public const string IdentityApiKey = "identity";

    public AzureApiSettings(ModelType type, string endpoint, string apiKey)
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

    public static AzureApiSettings EmbeddingSettingsFromEnv(string? endpointName = null)
    {
        return new AzureApiSettings(
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

    private AzureApiSettings Configure()
    {
        if (ApiKey.Equals(IdentityApiKey, StringComparison.OrdinalIgnoreCase))
        {
            ApiTokenProvider = AzureTokenProvider.Default;
        }
        return this;
    }

}
