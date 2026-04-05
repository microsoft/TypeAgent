// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers;
using autoShell.Services;
using Moq;
using Newtonsoft.Json.Linq;

namespace autoShell.Tests;

public class SystemCommandHandlerTests
{
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<IDebuggerService> _debuggerMock = new();
    private readonly SystemCommandHandler _handler;

    public SystemCommandHandlerTests()
    {
        _handler = new SystemCommandHandler(_processMock.Object, _debuggerMock.Object);
    }

    /// <summary>
    /// Verifies that the Debug command launches the debugger.
    /// </summary>
    [Fact]
    public void Debug_LaunchesDebugger()
    {
        Handle("Debug", "");

        _debuggerMock.Verify(d => d.Launch(), Times.Once);
    }

    /// <summary>
    /// Verifies that the ToggleNotifications command opens the Windows Action Center.
    /// </summary>
    [Fact]
    public void ToggleNotifications_OpensActionCenter()
    {
        Handle("ToggleNotifications", "");

        _processMock.Verify(p => p.StartShellExecute("ms-actioncenter:"), Times.Once);
    }

    private void Handle(string key, string value)
    {
        _handler.Handle(key, value, JToken.FromObject(value));
    }
}
