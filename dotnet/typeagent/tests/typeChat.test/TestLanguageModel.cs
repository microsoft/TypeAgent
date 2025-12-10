// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.CompilerServices;
using TypeAgent.AIClient;

namespace Microsoft.TypeChat.Tests;

public class TestLanguageModel : TypeChatTest
{
    [Fact]
    public async Task TestRetryAsync()
    {
        var handler = MockHttpHandler.ErrorResponder(429);
        var config = MockOpenAISettings();
        config.Retry = new RetrySettings(2);
        await RunRetryAsync(config);

        config.TimeoutMs = 0;
        await RunRetryAsync(config);

        config.Retry.MaxRetries = 0;
        await RunRetryAsync(config);
    }

    private async Task RunRetryAsync(OpenAIModelApiSettings config)
    {
        var handler = MockHttpHandler.ErrorResponder(429);
        using OpenAIChatModel model = new OpenAIChatModel(config, null, new HttpClient(handler));
        await Assert.ThrowsAnyAsync<Exception>(() => model.CompleteAsync("Hello", null, CancellationToken.None));
        Assert.Equal(config.Retry.MaxRetries + 1, handler.RequestCount);
    }

    [Fact]
    public async Task TestResponseAsync()
    {
        var config = MockOpenAISettings();
        var (jsonResponse, expected) = CannedResponse();
        var handler = new MockHttpHandler(jsonResponse);
        using OpenAIChatModel model = new OpenAIChatModel(config, null, new HttpClient(handler));
        var modelResponse = await model.CompleteAsync("Hello", null, CancellationToken.None);
        Assert.Equal(expected, modelResponse.Trim());
    }

    //[Fact]
    //public async Task TestConfig_AzureAsync()
    //{
    //    OpenAIModelApiSettings config = MockOpenAISettings();
    //    config.Configure()
    //    config.Endpoint = "https://yourresourcename.openai.azure.com/openai/deployments/deploymentid/chat/completions?api-version=";
    //    config.Model = "YOUR_MODEL";
    //    config.ApiVersion = "53";

    //    var (jsonResponse, expected) = CannedResponse();
    //    var handler = new MockHttpHandler(jsonResponse);
    //    OpenAIChatModel model = new OpenAIChatModel(config, null, new HttpClient(handler));
    //    await model.CompleteAsync("Hello", null, CancellationToken.None);

    //    Assert.Equal(config.Endpoint.ToLower(), handler.LastRequest.RequestUri.AbsoluteUri.ToLower());

    //    model.Dispose();

    //    config.Endpoint = "https://yourresourcename.openai.azure.com/";
    //    model = new OpenAIChatModel(config, null, new HttpClient(handler));
    //    await model.CompleteAsync("Hello", null, CancellationToken.None);

    //    string requestUrl = handler.LastRequest.RequestUri.AbsoluteUri.ToLower();
    //    string expectedUrl = $"{config.Endpoint}openai/deployments/{config.Model}/chat/completions?api-version={config.ApiVersion}".ToLower();
    //    Assert.Equal(expectedUrl, requestUrl);
    //}

    //[Fact]
    //public async Task TestConfig_OAIAsync()
    //{
    //    OpenAIModelApiSettings config = MockOpenAISettings();
    //    config.Azure = false;
    //    config.Endpoint = "https://api.openai.com/v1/chat/completions";
    //    config.Model = "yourmodel";
    //    config.Organization = "yourorg";

    //    var (jsonResponse, expected) = CannedResponse();
    //    var handler = new MockHttpHandler(jsonResponse);
    //    using OpenAIChatModel model = new OpenAIChatModel(config, null, new HttpClient(handler));
    //    await model.CompleteAsync("Hello");

    //    HttpRequestMessage? lastRequest = handler.LastRequest;
    //    lastRequest?.Headers.Contains("OpenAI-Organization");
    //    lastRequest?.Headers.Contains("Bearer");

    //    string? requestUrl = handler.LastRequest?.RequestUri?.AbsoluteUri.ToLower();
    //    Assert.Equal(config.Endpoint.ToLower(), requestUrl);
    //}

    private (string, string) CannedResponse()
    {
        const string JsonResponse = /*lang=json*/ @"{
          ""id"": ""chatcmpl-123"",
          ""object"": ""chat.completion"",
          ""created"": 1677652288,
          ""model"": ""gpt-3.5-turbo-0613"",
          ""choices"": [{
            ""index"": 0,
            ""message"": {
              ""role"": ""assistant"",
              ""content"": ""\n\nHello there!"",
            },
            ""finish_reason"": ""stop""
          }],
          ""usage"": {
            ""prompt_tokens"": 9,
            ""completion_tokens"": 12,
            ""total_tokens"": 21
          }
        }";
        return (JsonResponse, "Hello there!");
    }

    [Fact]
    public void Test_Prompt()
    {
        Prompt prompt = new Prompt();
        prompt.AppendInstruction("Help the user translate approximate date ranges into precise ones");
        prompt.Add(PromptLibrary.Now());
        prompt.AppendResponse("OK, thank you");

        Assert.Equal(PromptSection.Sources.System, prompt[0].Source);
        Assert.Equal(PromptSection.Sources.User, prompt[1].Source);
        Assert.Equal(PromptSection.Sources.Assistant, prompt[2].Source);

    }

}
