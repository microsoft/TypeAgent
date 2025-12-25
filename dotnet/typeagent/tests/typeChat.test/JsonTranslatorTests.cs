// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading;
using System.Threading.Tasks;
using TypeAgent.AIClient;
using TypeAgent.KnowPro;
using Xunit;

namespace Microsoft.TypeChat.Tests;

public class SampleType
{
    public string Name { get; set; } = string.Empty;
    public int Value { get; set; }
}

public class JsonTranslatorTests : TestWithData
{
    public JsonTranslatorTests() : base(true) { }

    //[Fact]
    //public void Constructor_InitializesProperties()
    //{
    //    IChatModel model = ModelUtils.CreateTestChatModel(nameof(JsonTranslatorTests));
    //    SchemaText schema = SchemaText.Load("./SentimentSchema.ts");
    //    var translator = new JsonTranslator<SentimentResponse>(
    //        new OpenAIChatModel(),
    //        schema
    //    );

    //    var validator = new JsonSerializerTypeValidator<SentimentResponse>(schema);

    //    Assert.Equal(model, translator.Model);
    //    Assert.Equal(validator.Schema, translator.Validator.Schema);
    //    Assert.NotNull(translator.Prompts);
    //    Assert.NotNull(translator.TranslationSettings);
    //    Assert.Equal(JsonTranslator<SampleType>.DefaultMaxRepairAttempts, translator.MaxRepairAttempts);
    //}

    //[Fact]
    //public void Validator_Setter_UpdatesValidator()
    //{
    //    var model = new Mock<ILanguageModel>().Object;
    //    var validator1 = new Mock<IJsonTypeValidator<SampleType>>().Object;
    //    var validator2 = new Mock<IJsonTypeValidator<SampleType>>().Object;
    //    var translator = new JsonTranslator<SampleType>(model, validator1);

    //    translator.Validator = validator2;
    //    Assert.Equal(validator2, translator.Validator);
    //}

    //[Fact]
    //public void MaxRepairAttempts_Setter_HandlesNegativeValues()
    //{
    //    var model = new Mock<ILanguageModel>().Object;
    //    var validator = new Mock<IJsonTypeValidator<SampleType>>().Object;
    //    var translator = new JsonTranslator<SampleType>(model, validator);

    //    translator.MaxRepairAttempts = -5;
    //    Assert.Equal(0, translator.MaxRepairAttempts);
    //}

    //[Fact]
    //public async Task TranslateAsync_ThrowsOnInvalidJson()
    //{
    //    var modelMock = new Mock<ILanguageModel>();
    //    var validatorMock = new Mock<IJsonTypeValidator<SampleType>>();
    //    var promptsMock = new Mock<IJsonTranslatorPrompts>();

    //    var prompt = new Prompt("Test request");
    //    var invalidJson = "{ invalid json }";
    //    var result = Result.Error<SampleType>("Invalid JSON");

    //    modelMock.Setup(m => m.CompleteAsync(It.IsAny<Prompt>(), It.IsAny<TranslationSettings>(), It.IsAny<CancellationToken>()))
    //        .ReturnsAsync(invalidJson);

    //    validatorMock.Setup(v => v.Validate(It.IsAny<string>())).Returns(result);

    //    promptsMock.Setup(p => p.CreateRequestPrompt(It.IsAny<TypeSchema>(), It.IsAny<Prompt>(), It.IsAny<IList<IPromptSection>>()))
    //        .Returns(prompt);

    //    promptsMock.Setup(p => p.CreateRepairPrompt(It.IsAny<TypeSchema>(), It.IsAny<string>(), It.IsAny<string>()))
    //        .Returns(new PromptSection(PromptSection.Sources.System, "Repair"));

    //    var translator = new JsonTranslator<SampleType>(modelMock.Object, validatorMock.Object, promptsMock.Object)
    //    {
    //        MaxRepairAttempts = 1
    //    };

    //    await Assert.ThrowsAsync<TypeChatException>(async () =>
    //    {
    //        await translator.TranslateAsync(prompt, null, null, CancellationToken.None);
    //    });
    //}
}
