// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class OpenAIModel
{
    public OpenAIModel(ApiSettings settings, HttpClient ? client = null)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        Client = client ?? new HttpClient();

        ConfigureClient();

        RequestSettings = new HttpRequestSettings();
        RequestSettings.MaxRetries = settings.MaxRetries;
        RequestSettings.RetryPauseMs = settings.MaxPauseMs;
    }

    public ApiSettings Settings{ get; }

    public HttpClient Client { get; }

    protected HttpRequestSettings RequestSettings { get; }

    private void ConfigureClient()
    {
        Settings.Configure(Client);
        if (Settings.TimeoutMs > 0)
        {
            Client.Timeout = TimeSpan.FromMilliseconds(Settings.TimeoutMs);
        }
    }

}
