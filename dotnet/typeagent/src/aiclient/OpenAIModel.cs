// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class OpenAIModel
{
    public OpenAIModel(OpenAIConfig config, HttpClient ? client = null)
    {
        ArgumentVerify.ThrowIfNull(config, nameof(config));
        config.Validate();

        Config = config;
        Client = client ?? new HttpClient();
        Model = config.Model!;
        Endpoint = string.Empty;

        ConfigureClient();


        RequestSettings = new HttpRequestSettings();
        RequestSettings.MaxRetries = config.MaxRetries;
        RequestSettings.RetryPauseMs = config.MaxPauseMs;
    }

    public OpenAIConfig Config { get; }

    public string Endpoint { get; private set; }

    public ModelInfo Model { get; }

    public HttpClient Client { get; }

    protected HttpRequestSettings RequestSettings { get; }


    private void ConfigureClient()
    {
        if (Config.Azure)
        {
            if (Config.Endpoint.Contains(@"chat/completions", StringComparison.OrdinalIgnoreCase))
            {
                Endpoint = Config.Endpoint;
            }
            else
            {
                string path = $"openai/deployments/{Model.Name}/chat/completions?api-version={Config.ApiVersion}";
                Endpoint = new Uri(new Uri(Config.Endpoint), path).AbsoluteUri;
            }
            if (!Config.HasTokenProvider)
            {
                Client.DefaultRequestHeaders.Add("api-key", Config.ApiKey);
            }
        }
        else
        {
            Endpoint = Config.Endpoint;
            Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Config.ApiKey);
            if (!string.IsNullOrEmpty(Config.Organization))
            {
                Client.DefaultRequestHeaders.Add("OpenAI-Organization", Config.Organization);
            }
        }
        if (Config.TimeoutMs > 0)
        {
            Client.Timeout = TimeSpan.FromMilliseconds(Config.TimeoutMs);
        }
    }

}
