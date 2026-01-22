// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.AIClient;

public class OpenAIChatModel : ModelApi, IChatModel
{
    public TokenCounter TokenCounter { get; private set; } = new TokenCounter();

    public OpenAIChatModel()
        : this(ModelApiSettings.FromEnv(ModelType.Chat))
    {
    }

    public OpenAIChatModel(ModelApiSettings settings, CompletionSettings? completionSettings = null, HttpClient? client = null)
        : base(settings, client)
    {
        CompletionSettings = completionSettings ?? CompletionSettings.CreateDefault();
    }

    public CompletionSettings CompletionSettings { get; }

    public Task<string> CompleteAsync(
        Prompt prompt,
        TranslationSettings? translationSettings,
        CancellationToken cancellationToken
    )
    {
        return CompleteAsync(
            prompt,
            translationSettings,
            CompletionSettings.Format,
            cancellationToken
        );
    }

    public Task<string> CompleteTextAsync(
        Prompt prompt,
        TranslationSettings? translationSettings,
        CancellationToken cancellationToken
    )
    {
        return CompleteAsync(
            prompt,
            translationSettings,
            AIClient.ResponseFormat.Text,
            cancellationToken
        );
    }

    public async Task<string> CompleteAsync(
        Prompt prompt,
        TranslationSettings? translationSettings,
        AIClient.ResponseFormat? format,
        CancellationToken cancellationToken
    )
    {
        var request = Create(prompt, format);
        if (translationSettings is not null)
        {
            if (translationSettings.Temperature >= 0)
            {
                request.temperature = translationSettings.Temperature;
            }
            if (translationSettings.MaxTokens > 0)
            {
                request.max_tokens = translationSettings.MaxTokens;
            }
            if (translationSettings.Seed != 0)
            {
                request.seed = translationSettings.Seed;
            }
        }
        string? apiToken = Settings.ApiTokenProvider is not null
                    ? await Settings.ApiTokenProvider.GetAccessTokenAsync(cancellationToken).ConfigureAwait(false)
                    : null;

        Stopwatch timeTaken = Stopwatch.StartNew();
        Response response = await Client.GetJsonResponseAsync<Request, Response>(
            Settings.Endpoint,
            request,
            apiToken,
            Settings.Retry,
            cancellationToken
        ).ConfigureAwait(false);

        // Track usage
        this.TokenCounter.Add(response.usage, timeTaken.Elapsed);

        response.ThrowIfInvalid();

        return response.GetText();
    }

    private Request Create(Prompt prompt, AIClient.ResponseFormat? format)
    {
        var request = new Request
        {
            messages = Message.Create(prompt),
            temperature = CompletionSettings.Temperature,
            max_tokens = CompletionSettings.MaxTokens,
            seed = CompletionSettings.Seed,
            top_p = CompletionSettings.TopP,
        };
        if (format is not null && format.Value == AIClient.ResponseFormat.Json)
        {
            request.response_format = ResponseFormat.Json;
        }
        if (!string.IsNullOrEmpty(Settings.ModelName))
        {
            request.model = Settings.ModelName;
        }
        return request;
    }

    private class Request
    {
        public string? model { get; set; }
        public Message[]? messages { get; set; }
        public double? temperature { get; set; }
        public int? max_tokens { get; set; }
        public ResponseFormat? response_format { get; set; }
        public double? seed { get; set; }
        public int? top_p { get; set; }
    }

    // TODO: Add prompt_filter_results for content moderation results
    // TODO: track other meta data? object, id, created, etc.
    private struct Response
    {
        public string id { get; set; }

        public Choice[] choices { get; set; }

        public Usage usage { get; set; }

        public string GetText()
        {
            string? response = null;
            if (choices is not null && choices.Length > 0)
            {
                response = choices[0].message.content;
            }
            return response ?? string.Empty;
        }

        public void ThrowIfInvalid()
        {
            if (choices.IsNullOrEmpty())
            {
                throw new AIClientException(AIClientException.ErrorCode.InvalidChatResponse);
            }
        }
    }

    private class ResponseFormat
    {
        public static readonly ResponseFormat Json = new ResponseFormat() { type = "json_object" };

        public string? type { get; set; }
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
                messages[i] = new Message
                {
                    role = prompt[i].Source ?? PromptSection.Sources.User,
                    content = prompt[i].GetText()
                };
            }
            return messages;
        }
    }

    private struct Choice
    {
        public Message message { get; set; }
    }

    internal struct Usage
    {
        [JsonPropertyName("completion_tokens")]
        public uint CompletionTokens { get; set; }
        [JsonPropertyName("completion_tokens_details")]
        public TokenDetails CompletionTokenDetails { get; set; }
        [JsonPropertyName("prompt_tokens")]
        public uint PromptTokens { get; set; }
        [JsonPropertyName("prompt_tokens_details")]
        public TokenDetails PromptTokenDetails { get; set; }
        [JsonPropertyName("total_tokens")]
        public uint TotalTokens { get; set; }
    }

    public struct TokenDetails
    {
        [JsonPropertyName("accepted_prediction_tokens")]
        public uint? AcceptedPredictionTokens { get; set; }
        [JsonPropertyName("audio_tokens")]
        public uint? AudioTokens { get; set; }
        [JsonPropertyName("reasoning_tokens")]
        public uint? ReasoningTokens { get; set; }
        [JsonPropertyName("rejected_prediction_tokens")]
        public uint? RejectedPredictionTokens { get; set; }
        [JsonPropertyName("cached_tokens")]
        public uint? CachedTokens { get; set; }
    }
}
