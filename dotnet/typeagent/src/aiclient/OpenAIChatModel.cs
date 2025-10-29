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

    public async Task<string> CompleteAsync(Prompt prompt, TranslationSettings? settings, CancellationToken cancellationToken)
    {
        var request = Create(prompt);
        if (settings is not null)
        {
            if (settings.Temperature > 0)
            {
                request.temperature = settings.Temperature;
            }
            if (settings.MaxTokens > 0)
            {
                request.max_tokens = settings.MaxTokens;
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

    private Request Create(Prompt prompt)
    {
        var request = new Request
        {
            messages = Message.Create(prompt),
            temperature = CompletionSettings.Temperature,
            max_tokens = CompletionSettings.MaxTokens,
            seed = CompletionSettings.Seed,
            top_p = CompletionSettings.TopP,
        };
        if (CompletionSettings.Format == AIClient.ResponseFormat.Json)
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
