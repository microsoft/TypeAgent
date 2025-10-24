// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class ApiSettings
{
    public const string IdentityApiKey = "identity";

    public ApiSettings(string endpoint, string apiKey)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(endpoint, nameof(endpoint));
        ArgumentVerify.ThrowIfNullOrEmpty(apiKey, nameof(apiKey));

        Endpoint = endpoint;
        ApiKey = apiKey;
        Retry = new RetrySettings();
    }

    public string Endpoint { get; }

    public string ApiKey { get; }

    public int TimeoutMs { get; set; } = 15 * 1000;

    public RetrySettings Retry { get; set; }

    /// <summary>
    /// When provided, gets Api token from this provider
    /// </summary>
    public IApiTokenProvider? ApiTokenProvider { get; protected set; }

    public virtual void Configure(HttpClient client)
    {
        ArgumentVerify.ThrowIfNull(client, nameof(client));

        if (ApiTokenProvider is null)
        {
            client.DefaultRequestHeaders.Add("api-key", ApiKey);
        }
    }
}
