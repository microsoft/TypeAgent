// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using autoShell.Handlers;

namespace autoShell.Tests;

/// <summary>
/// Tests for <see cref="ActionHandlerBase"/> deserialization and error handling in AddAction&lt;T&gt;.
/// </summary>
public class ActionHandlerBaseTests
{
    private record TestParams
    {
        [JsonPropertyName("name")]
        public string Name { get; init; } = "";

        [JsonPropertyName("count")]
        public int Count { get; init; } = 0;
    }

    private class TestHandler : ActionHandlerBase
    {
        public TestParams? LastParams { get; private set; }

        public TestHandler()
        {
            AddAction<TestParams>("TypedAction", p =>
            {
                LastParams = p;
                return ActionResult.Ok("ok");
            });
        }
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    /// <summary>
    /// Verifies that AddAction&lt;T&gt; correctly deserializes valid JSON to the typed parameter record.
    /// </summary>
    [Fact]
    public void TypedAction_ValidJson_DeserializesToTypedParams()
    {
        var handler = new TestHandler();
        var result = handler.Handle("TypedAction", Parse("""{"name":"test","count":5}"""));

        Assert.True(result.Success);
        Assert.NotNull(handler.LastParams);
        Assert.Equal("test", handler.LastParams!.Name);
        Assert.Equal(5, handler.LastParams.Count);
    }

    /// <summary>
    /// Verifies that AddAction&lt;T&gt; returns a failure when the JSON is "null".
    /// JsonSerializer.Deserialize returns null for the JSON literal "null".
    /// </summary>
    [Fact]
    public void TypedAction_NullJson_ReturnsFailure()
    {
        var handler = new TestHandler();
        var result = handler.Handle("TypedAction", Parse("null"));

        Assert.False(result.Success);
        Assert.Contains("null", result.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Verifies that AddAction&lt;T&gt; returns a failure when JSON has a type mismatch
    /// (e.g., string where int is expected).
    /// </summary>
    [Fact]
    public void TypedAction_TypeMismatch_ReturnsFailure()
    {
        var handler = new TestHandler();
        var result = handler.Handle("TypedAction", Parse("""{"name":"test","count":"notAnInt"}"""));

        Assert.False(result.Success);
        Assert.Contains("Invalid parameters", result.Message);
    }
}
