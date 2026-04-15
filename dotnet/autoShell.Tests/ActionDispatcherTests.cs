// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Logging;
using Moq;

namespace autoShell.Tests;

public class ActionDispatcherTests
{
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly ActionDispatcher _dispatcher;

    public ActionDispatcherTests()
    {
        _dispatcher = new ActionDispatcher(_loggerMock.Object);
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    /// <summary>
    /// Verifies that dispatching a JSON object with a "quit" actionName returns a quit ActionResult.
    /// </summary>
    [Fact]
    public void Dispatch_QuitKey_ReturnsQuitResult()
    {
        var json = Parse("""{"actionName":"quit","parameters":{}}""");
        ActionResult result = _dispatcher.Dispatch(json);
        Assert.NotNull(result);
        Assert.True(result.Success);
        Assert.True(result.IsQuit);
    }

    /// <summary>
    /// Verifies that dispatching a non-quit command returns a successful ActionResult.
    /// </summary>
    [Fact]
    public void Dispatch_NonQuitKey_ReturnsSuccessResult()
    {
        _dispatcher.Register(new StubHandler("TestCmd"));
        var json = Parse("""{"actionName":"TestCmd","parameters":{}}""");
        ActionResult result = _dispatcher.Dispatch(json);
        Assert.NotNull(result);
        Assert.True(result.Success);
    }

    /// <summary>
    /// Verifies that commands are routed to the correct handler with the expected key and parameters.
    /// </summary>
    [Fact]
    public void Dispatch_RoutesToCorrectHandler()
    {
        var handler = new StubHandler("Alpha", "Beta");
        _dispatcher.Register(handler);

        _dispatcher.Dispatch(Parse("""{"actionName":"Alpha","parameters":{}}"""));
        Assert.Equal("Alpha", handler.LastKey);
        Assert.NotNull(handler.LastParameters);

        _dispatcher.Dispatch(Parse("""{"actionName":"Beta","parameters":{}}"""));
        Assert.Equal("Beta", handler.LastKey);
        Assert.NotNull(handler.LastParameters);
    }

    /// <summary>
    /// Verifies that dispatching an unrecognized command returns a failure result.
    /// </summary>
    [Fact]
    public void Dispatch_UnknownCommand_ReturnsFailure()
    {
        var json = Parse("""{"actionName":"UnknownCmd","parameters":{}}""");
        ActionResult result = _dispatcher.Dispatch(json);
        Assert.NotNull(result);
        Assert.False(result.Success);
        Assert.Contains("Unknown action", result.Message);
    }

    /// <summary>
    /// Verifies that dispatching an empty JSON object returns a failure result.
    /// </summary>
    [Fact]
    public void Dispatch_EmptyObject_ReturnsFailure()
    {
        ActionResult result = _dispatcher.Dispatch(Parse("{}"));
        Assert.NotNull(result);
        Assert.False(result.Success);
    }

    /// <summary>
    /// Verifies that a quit dispatch does not invoke any registered handlers.
    /// </summary>
    [Fact]
    public void Dispatch_QuitStopsProcessingSubsequentKeys()
    {
        var handler = new StubHandler("After");
        _dispatcher.Register(handler);

        _dispatcher.Dispatch(Parse("""{"actionName":"quit","parameters":{}}"""));

        Assert.Null(handler.LastKey);
    }

    /// <summary>
    /// Verifies that an exception thrown by a handler returns a failure result.
    /// </summary>
    [Fact]
    public void Dispatch_HandlerException_ReturnsFailure()
    {
        var handler = new ThrowingHandler("Boom");
        _dispatcher.Register(handler);

        var json = Parse("""{"actionName":"Boom","parameters":{}}""");
        ActionResult result = _dispatcher.Dispatch(json);
        Assert.NotNull(result);
        Assert.False(result.Success);
        Assert.Contains("Boom", result.Message);
    }

    /// <summary>
    /// Verifies that a handler exception does not prevent subsequent dispatches from working.
    /// </summary>
    [Fact]
    public void Dispatch_HandlerException_DoesNotAffectSubsequentDispatches()
    {
        var throwing = new ThrowingHandler("Boom");
        var normal = new StubHandler("Ok");
        _dispatcher.Register(throwing, normal);

        _dispatcher.Dispatch(Parse("""{"actionName":"Boom","parameters":{}}"""));
        _dispatcher.Dispatch(Parse("""{"actionName":"Ok","parameters":{}}"""));
        Assert.Equal("Ok", normal.LastKey);
    }

    /// <summary>
    /// Verifies that registering duplicate action names throws.
    /// </summary>
    [Fact]
    public void Register_DuplicateCommand_Throws()
    {
        _dispatcher.Register(new StubHandler("Dup"));
        Assert.Throws<InvalidOperationException>(() => _dispatcher.Register(new StubHandler("Dup")));
    }

    /// <summary>
    /// Stub handler that records the last key and parameters it received.
    /// </summary>
    private class StubHandler : IActionHandler
    {
        public IEnumerable<string> SupportedActions { get; }
        public string? LastKey { get; private set; }
        public JsonElement? LastParameters { get; private set; }

        public StubHandler(params string[] commands)
        {
            SupportedActions = commands;
        }

        public ActionResult Handle(string key, JsonElement parameters)
        {
            LastKey = key;
            LastParameters = parameters;
            return ActionResult.Ok($"Handled {key}");
        }
    }

    /// <summary>
    /// Handler that always throws, for testing exception isolation.
    /// </summary>
    private class ThrowingHandler : IActionHandler
    {
        public IEnumerable<string> SupportedActions { get; }

        public ThrowingHandler(params string[] commands)
        {
            SupportedActions = commands;
        }

        public ActionResult Handle(string key, JsonElement parameters)
        {
            throw new InvalidOperationException("Test exception");
        }
    }
}
