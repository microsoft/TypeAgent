// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Logging;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class CommandDispatcherTests
{
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly CommandDispatcher _dispatcher;

    public CommandDispatcherTests()
    {
        _dispatcher = new CommandDispatcher(_loggerMock.Object);
    }

    /// <summary>
    /// Verifies that dispatching a JSON object with a "quit" key returns true.
    /// </summary>
    [Fact]
    public void Dispatch_QuitKey_ReturnsTrue()
    {
        var json = JObject.Parse("""{"quit": true}""");
        bool result = _dispatcher.Dispatch(json);
        Assert.True(result);
    }

    /// <summary>
    /// Verifies that dispatching a non-quit command returns false.
    /// </summary>
    [Fact]
    public void Dispatch_NonQuitKey_ReturnsFalse()
    {
        _dispatcher.Register(new StubHandler("TestCmd"));
        var json = JObject.Parse("""{"TestCmd": "value"}""");
        bool result = _dispatcher.Dispatch(json);
        Assert.False(result);
    }

    /// <summary>
    /// Verifies that commands are routed to the correct handler with the expected key and value.
    /// </summary>
    [Fact]
    public void Dispatch_RoutesToCorrectHandler()
    {
        var handler = new StubHandler("Alpha", "Beta");
        _dispatcher.Register(handler);

        _dispatcher.Dispatch(JObject.Parse("""{"Alpha": "1"}"""));
        Assert.Equal("Alpha", handler.LastKey);
        Assert.Equal("1", handler.LastValue);

        _dispatcher.Dispatch(JObject.Parse("""{"Beta": "2"}"""));
        Assert.Equal("Beta", handler.LastKey);
        Assert.Equal("2", handler.LastValue);
    }

    /// <summary>
    /// Verifies that dispatching an unrecognized command does not throw an exception.
    /// </summary>
    [Fact]
    public void Dispatch_UnknownCommand_DoesNotThrow()
    {
        var json = JObject.Parse("""{"UnknownCmd": "value"}""");
        var ex = Record.Exception(() => _dispatcher.Dispatch(json));
        Assert.Null(ex);
    }

    /// <summary>
    /// Verifies that dispatching an empty JSON object returns false.
    /// </summary>
    [Fact]
    public void Dispatch_EmptyObject_ReturnsFalse()
    {
        bool result = _dispatcher.Dispatch([]);
        Assert.False(result);
    }

    /// <summary>
    /// Verifies that a "quit" key stops processing of any subsequent keys in the same JSON object.
    /// </summary>
    [Fact]
    public void Dispatch_QuitStopsProcessingSubsequentKeys()
    {
        var handler = new StubHandler("After");
        _dispatcher.Register(handler);

        // quit comes first — handler for "After" should not be called
        var json = JObject.Parse("""{"quit": true, "After": "value"}""");
        bool result = _dispatcher.Dispatch(json);

        Assert.True(result);
        Assert.Null(handler.LastKey);
    }

    /// <summary>
    /// Verifies that an exception thrown by a handler does not propagate to the caller.
    /// </summary>
    [Fact]
    public void Dispatch_HandlerException_DoesNotBubbleUp()
    {
        var handler = new ThrowingHandler("Boom");
        _dispatcher.Register(handler);

        var json = JObject.Parse("""{"Boom": "value"}""");
        var ex = Record.Exception(() => _dispatcher.Dispatch(json));
        Assert.Null(ex);
    }

    /// <summary>
    /// Verifies that after a handler throws, subsequent keys in the same dispatch are still processed.
    /// </summary>
    [Fact]
    public void Dispatch_HandlerException_ContinuesToNextKey()
    {
        var throwing = new ThrowingHandler("Boom");
        var normal = new StubHandler("Ok");
        _dispatcher.Register(throwing, normal);

        _dispatcher.Dispatch(JObject.Parse("""{"Boom": "x", "Ok": "y"}"""));
        Assert.Equal("Ok", normal.LastKey);
    }

    /// <summary>
    /// Stub handler that records the last key/value it received.
    /// </summary>
    private class StubHandler : ICommandHandler
    {
        public IEnumerable<string> SupportedCommands { get; }
        public string? LastKey { get; private set; }
        public string? LastValue { get; private set; }

        public StubHandler(params string[] commands)
        {
            SupportedCommands = commands;
        }

        public void Handle(string key, string value, JToken rawValue)
        {
            LastKey = key;
            LastValue = value;
        }
    }

    /// <summary>
    /// Handler that always throws, for testing exception isolation.
    /// </summary>
    private class ThrowingHandler : ICommandHandler
    {
        public IEnumerable<string> SupportedCommands { get; }

        public ThrowingHandler(params string[] commands)
        {
            SupportedCommands = commands;
        }

        public void Handle(string key, string value, JToken rawValue)
        {
            throw new InvalidOperationException("Test exception");
        }
    }
}
