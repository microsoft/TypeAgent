// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading;
using System.Threading.Tasks;
using TypeAgent.AIClient;
using TypeAgent.KnowPro;
using Xunit;

namespace Microsoft.TypeChat.Tests;

public class SampleType : SentimentResponse
{
    public string Name { get; set; } = string.Empty;
    public int Value { get; set; }
}

public class JsonTranslatorTests : TestWithData
{

    private OpenAIChatModel _model;
    private SchemaText _schema;
    private JsonTranslator<SentimentResponse> _translator;
    private JsonSerializerTypeValidator<SentimentResponse> _validator;

    public JsonTranslatorTests() : base(true)
    {
        _model = (OpenAIChatModel)ModelUtils.CreateTestChatModel(nameof(JsonTranslatorTests));
        _schema = SchemaText.Load("./SentimentSchema.ts");
        _translator = new JsonTranslator<SentimentResponse>(
            ModelUtils.CreateTestChatModel(nameof(JsonTranslatorTests)),
            _schema
        );

        _validator = new JsonSerializerTypeValidator<SentimentResponse>(_schema);
    }

    [Fact]
    public void Constructor_InitializesProperties()
    {
        Assert.Equal(_model.Settings.ModelName, ((OpenAIChatModel)_translator.Model).Settings.ModelName);
        Assert.Equal(_model.Settings.Endpoint, ((OpenAIChatModel)_translator.Model).Settings.Endpoint);
        Assert.Equal(_validator.Schema.TypeFullName, _translator.Validator.Schema.TypeFullName);
        Assert.Equal(_validator.Schema.Schema, _translator.Validator.Schema.Schema);
        Assert.NotNull(_translator.Prompts);
        Assert.NotNull(_translator.TranslationSettings);
        Assert.Equal(JsonTranslator<SampleType>.DefaultMaxRepairAttempts, _translator.MaxRepairAttempts);
    }

    [Fact]
    public void Validator_Setter_UpdatesValidator()
    {
        var model = ModelUtils.CreateTestChatModel(nameof(JsonTranslatorTests));
        var validator = new JsonSerializerTypeValidator<SentimentResponse>(_schema);
        var translator = new JsonTranslator<SentimentResponse>(model, validator);

        translator.Validator = _validator;
        Assert.Equal(_validator, translator.Validator);
    }

    [Fact]
    public void MaxRepairAttempts_Setter_HandlesNegativeValues()
    {
        _translator.MaxRepairAttempts = -5;
        Assert.Equal(0, _translator.MaxRepairAttempts);
    }

    [Fact]
    public async Task TranslateAsync_ThrowsOnInvalidNoAsync()
    {
        var prompt = new Prompt("Test request");
        var mockModel = new MockModel_No_JSON_Response();

        var translator = new JsonTranslator<SampleType>(mockModel, _schema)
        {
            MaxRepairAttempts = 1
        };

        await Assert.ThrowsAsync<TypeChatException>(async () =>
        {
            await translator.TranslateAsync(prompt, null, null, CancellationToken.None);
        });
    }

    [Fact]
    public async Task TranslateAsync_ThrowsOnInvalidJsonAsync()
    {
        var prompt = new Prompt("Test request");
        var mockModel = new MockModel_Partial_JSON_Response();

        var translator = new JsonTranslator<SampleType>(mockModel, _schema)
        {
            MaxRepairAttempts = 1
        };

        await Assert.ThrowsAsync<TypeChatException>(async () =>
        {
            await translator.TranslateAsync(prompt, null, null, CancellationToken.None);
        });
    }
}
