// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class ModelApi
{
    public ModelApi(ModelApiSettings settings, HttpClient ? client = null)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        Client = client ?? new HttpClient();

        ConfigureClient();
    }

    public ModelApiSettings Settings { get; }

    public HttpClient Client { get; }

    private void ConfigureClient()
    {
        Settings.Configure(Client);
        if (Settings.TimeoutMs > 0)
        {
            Client.Timeout = TimeSpan.FromMilliseconds(Settings.TimeoutMs);
        }
    }
}
