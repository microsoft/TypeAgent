// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.AIClient;

public class OpenAIChatModel : ModelApi, IChatModel
{
    public OpenAIChatModel()
        : this(ModelApiSettings.FromEnv(ModelType.Chat))
    {

    }

    public OpenAIChatModel(ModelApiSettings settings, CompletionSettings? completionSettings = null)
        : base(settings)
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

        Response response = await Client.GetJsonResponseAsync<Request, Response>(
            Settings.Endpoint,
            request,
            apiToken,
            Settings.Retry,
            cancellationToken
        ).ConfigureAwait(false);

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

    private struct Response
    {
        public Choice[] choices { get; set; }

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
}
