// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using TypeAgent.AIClient;

namespace Microsoft.TypeChat.Tests;

public class CompletionLimitTests
{
    [Theory]
    [InlineData(ModelApiSettings.ApiProvider.Azure)]
    [InlineData(ModelApiSettings.ApiProvider.OpenAI)]
    public async Task CompletionRequestsOmitGenerationLimitsAsync(ModelApiSettings.ApiProvider provider)
    {
        var config = new ModelApiSettings(provider, ModelType.Chat, "https://synthetic.invalid/", "synthetic-key")
        {
            ModelName = "synthetic-model"
        };
        const string jsonResponse = """
            {"choices":[{"message":{"role":"assistant","content":"answer"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}
            """;
        var handler = new CapturingHandler(jsonResponse);
        using OpenAIChatModel model = new OpenAIChatModel(config, null, new HttpClient(handler));
        foreach (var translation in new TranslationSettings?[] { null, new() { Temperature = 0.7, Seed = 123 } })
        {
            var response = await model.CompleteAsync("Answer concisely; do not limit reasoning.", translation, CancellationToken.None);
            Assert.Equal("answer", response.Trim());
            using var request = JsonDocument.Parse(handler.RequestBody);
            foreach (var field in new[] { "max_tokens", "max_completion_tokens", "max_output_tokens" })
            {
                Assert.False(request.RootElement.TryGetProperty(field, out _));
            }
            Assert.Equal(translation?.Temperature ?? 0, request.RootElement.GetProperty("temperature").GetDouble());
        }
        Assert.Null(typeof(CompletionSettings).GetProperty("MaxTokens"));
        Assert.Null(typeof(TranslationSettings).GetProperty("MaxTokens"));
    }

    private class CapturingHandler : MockHttpHandler
    {
        public CapturingHandler(string jsonResponse) : base(jsonResponse) { }

        public string RequestBody { get; private set; } = string.Empty;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            return await base.SendAsync(request, cancellationToken);
        }
    }
}
