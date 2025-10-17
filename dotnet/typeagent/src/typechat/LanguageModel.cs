// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A lightweight ILanguageModel implementation over OpenAI or Azure OpenAI Chat Completion REST API endpoint
/// </summary>
public class LanguageModel : ILanguageModel, IDisposable
{
    private static readonly TranslationSettings s_defaultSettings = new TranslationSettings();

    private readonly OpenAIConfig _config;
    private readonly ModelInfo _model;
    private HttpClient _client;
    private string _endPoint;

    /// <summary>
    /// Create an OpenAILanguageModel object using the given OpenAIConfig
    /// config.EndPoint must support the Chat Completion API
    /// </summary>
    /// <param name="config">configuration to use</param>
    /// <param name="model">information about the target model</param>
    /// <param name="client">http client to use</param>
    public LanguageModel(OpenAIConfig config, ModelInfo? model = null, HttpClient? client = null)
    {
        ArgumentVerify.ThrowIfNull(config, nameof(config));
        config.Validate();

        _config = config;
        _model = model ?? _config.Model;
        _client = client ?? new HttpClient();
        ConfigureClient();
    }

    /// <summary>
    /// Information about the language model
    /// </summary>
    public ModelInfo ModelInfo => _model;

    /// <summary>
    /// Get a completion for the given prompt
    /// </summary>
    /// <param name="prompt">prompt</param>
    /// <param name="settings">translation settings such as temperature</param>
    /// <param name="cancelToken">cancellation token</param>
    /// <returns></returns>
    public async Task<string> CompleteAsync(Prompt prompt, TranslationSettings? settings = null, CancellationToken cancelToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty<IPromptSection>(prompt, nameof(prompt));

        var request = CreateRequest(prompt, settings);
        string apiToken = _config.HasTokenProvider ? await _config.ApiTokenProvider.GetAccessTokenAsync(cancelToken) : null;
        var response = await _client.GetJsonResponseAsync<Request, Response>(_endPoint, request, _config.MaxRetries, _config.MaxPauseMs, apiToken).ConfigureAwait(false);
        return response.GetText();
    }

    private Request CreateRequest(Prompt prompt, TranslationSettings? settings = null)
    {
        var request = Request.Create(prompt, settings ?? s_defaultSettings);
        if (!_config.Azure)
        {
            request.model = _model.Name;
        }
        return request;
    }

    private void ConfigureClient()
    {
        if (_config.Azure)
        {
            if (_config.Endpoint.Contains(@"chat/completions", StringComparison.OrdinalIgnoreCase))
            {
                _endPoint = _config.Endpoint;
            }
            else
            {
                string path = $"openai/deployments/{_model.Name}/chat/completions?api-version={_config.ApiVersion}";
                _endPoint = new Uri(new Uri(_config.Endpoint), path).AbsoluteUri;
            }
            if (!_config.HasTokenProvider)
            {
                _client.DefaultRequestHeaders.Add("api-key", _config.ApiKey);
            }
        }
        else
        {
            _endPoint = _config.Endpoint;
            _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _config.ApiKey);
            if (!string.IsNullOrEmpty(_config.Organization))
            {
                _client.DefaultRequestHeaders.Add("OpenAI-Organization", _config.Organization);
            }
        }
        if (_config.TimeoutMs > 0)
        {
            _client.Timeout = TimeSpan.FromMilliseconds(_config.TimeoutMs);
        }
    }

    private struct Request
    {
        public string? model { get; set; }
        public Message[] messages { get; set; }
        public double? temperature { get; set; }
        public int? max_tokens { get; set; }

        public static Request Create(Prompt prompt, TranslationSettings settings)
        {
            return new Request
            {
                messages = Message.Create(prompt),
                temperature = (settings.Temperature > 0) ? settings.Temperature : 0,
                max_tokens = (settings.MaxTokens > 0) ? settings.MaxTokens : null
            };
        }
    }

    private struct Response
    {
        public Choice[] choices { get; set; }

        public string GetText()
        {
            string response = null;
            if (choices is not null && choices.Length > 0)
            {
                response = choices[0].message.content;
            }
            return response ?? string.Empty;
        }
    }

    private struct Message
    {
        public string role { get; set; }
        public string content { get; set; }

        public static Message[] Create(Prompt prompt)
        {
            Message[] messages = new Message[prompt.Count];
            for (int i = 0; i < prompt.Count; ++i)
            {
                messages[i] = new Message { role = prompt[i].Source, content = prompt[i].GetText() };
            }
            return messages;
        }
    }

    private struct Choice
    {
        public Message message { get; set; }
    }

    protected virtual void Dispose(bool disposing)
    {
        if (disposing)
        {
            _client?.Dispose();
            _client = null;
        }
    }

    public void Dispose()
    {
        // Do not change this code. Put cleanup code in 'Dispose(bool disposing)' method
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }
}
