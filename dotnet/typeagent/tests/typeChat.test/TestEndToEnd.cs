// Copyright (c) Microsoft. All rights reserved.

namespace Microsoft.TypeChat.Tests;

public class TestEndToEnd : TypeChatTest, IClassFixture<OpenAIConfig>
{
    private readonly OpenAIConfig _config;

    public TestEndToEnd(OpenAIConfig config, ITestOutputHelper output)
        : base(output)
    {
        _config = config;
    }

    //[SkippableFact]
    //public async Task TranslateSentiment_ChatModel()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));
    //    await TranslateSentiment(new ChatLanguageModel(_config.OpenAI));
    //}

    //[SkippableFact]
    //public async Task TranslateSentiment_CompletionModel()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    await TranslateSentiment(new TextCompletionModel(_config.OpenAI));
    //}

    //private async Task TranslateSentiment(ILanguageModel model)
    //{
    //    var translator = new JsonTranslator<SentimentResponse>(
    //        model,
    //        new TypeValidator<SentimentResponse>()
    //    );
    //    SentimentResponse response = await translator.TranslateAsync("Tonights gonna be a good night! A good good night!");
    //    Assert.NotNull(response);
    //    Assert.NotNull(response.Sentiment);

    //    response = await translator.TranslateAsync("Its been a long days night, and I've been working like a dog");
    //    Assert.NotNull(response);
    //    Assert.NotNull(response.Sentiment);
    //}

    //[SkippableFact]
    //public async Task Translate_Polymorphic()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    var translator = new JsonTranslator<Drawing>(new ChatLanguageModel(_config.OpenAI));
    //    string request = "Add a circle of radius 4.5 at 30, 30 and\n" +
    //                     "Add a rectangle at 5, 5 with height 10 and width 15";

    //    var canvas = await translator.TranslateAsync(request);
    //    Assert.True(canvas.Shapes.Length == 2);

    //    Circle circle = canvas.GetShape<Circle>();
    //    Assert.Equal(4.5, circle.Radius);
    //    Assert.Equal(30, circle.CenterX);
    //    Assert.Equal(30, circle.CenterY);

    //    Rectangle rect = canvas.GetShape<Rectangle>();
    //    Assert.Equal(5, rect.TopX);
    //    Assert.Equal(5, rect.TopY);
    //    Assert.Equal(10, rect.Height);
    //    Assert.Equal(15, rect.Width);
    //}

    ///// <summary>
    ///// This one loads the schema from a TS file
    //[SkippableFact]
    //public async Task TranslateWithTSFileSchema()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    SchemaText schema = SchemaText.Load("./SentimentSchema.ts");
    //    var translator = new JsonTranslator<SentimentResponse>(
    //        new ChatLanguageModel(_config.OpenAI),
    //        schema
    //    );
    //    SentimentResponse response = await translator.TranslateAsync("Tonights gonna be a good night! A good good night!");
    //    Assert.NotNull(response);
    //    Assert.NotNull(response.Sentiment);

    //    response = await translator.TranslateAsync("Its been a long days night, and I've been working like a dog");
    //    Assert.NotNull(response);
    //    Assert.NotNull(response.Sentiment);
    //}

    //[SkippableFact]
    //public async Task ProgramMath()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    await ProgramMath(new ChatLanguageModel(_config.OpenAI));
    //}

    //[SkippableFact]
    //public async Task ProgramMath_Completion()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    await ProgramMath(new TextCompletionModel(_config.OpenAI));
    //}

    //private async Task ProgramMath(ILanguageModel model)
    //{
    //    string request = "3 * 5 + 2 * 7";
    //    double expectedResult = 29.0;

    //    Api<IMathAPI> api = MathAPI.Default;
    //    var translator = new ProgramTranslator<IMathAPI>(model, api);
    //    var program = await translator.TranslateAsync(request);
    //    Assert.NotNull(program);
    //    Assert.True(program.IsComplete);
    //    dynamic result = program.Run(api);
    //    Assert.True(result == expectedResult);
    //}

    //[SkippableFact]
    //public async Task TestSentiment_ChatModel()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    ChatLanguageModel lm = new ChatLanguageModel(_config.OpenAI);
    //    string response = await lm.CompleteAsync("Is Venus a planet?");
    //    Assert.NotNull(response);
    //    Assert.NotEmpty(response);
    //}

    //[SkippableFact]
    //public async Task TranslateSentiment_LanguageModel()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    using LanguageModel lm = new LanguageModel(_config.OpenAI);
    //    await TranslateSentiment(lm);
    //}

    //[Fact]
    //public async Task Test_Preamble()
    //{
    //    Skip.If(!CanRunEndToEndTest(_config));

    //    Prompt prompt = new Prompt();
    //    prompt.AppendInstruction("Help the user translate approximate date ranges into precise ones");
    //    prompt.Add(PromptLibrary.Now());
    //    prompt.AppendResponse("Give me a time range, like fortnight");
    //    prompt.Append("What is the date in a fortnight?");

    //    LanguageModel lm = new LanguageModel(_config.OpenAI);
    //    TranslationSettings settings = new TranslationSettings
    //    {
    //        MaxTokens = 1000,
    //        Temperature = 0.5,
    //    };

    //    var response = await lm.CompleteAsync(prompt, settings, CancellationToken.None);
    //    Assert.NotEmpty(response);
    //}
}
