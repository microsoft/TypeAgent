// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

public class SystemActionHandlerTests
{
    private readonly Mock<IProcessService> _processMock = new();
    private readonly Mock<IDebuggerService> _debuggerMock = new();
    private readonly SystemActionHandler _handler;

    public SystemActionHandlerTests()
    {
        _handler = new SystemActionHandler(_processMock.Object, _debuggerMock.Object);
    }

    /// <summary>
    /// Verifies that the Debug command launches the debugger.
    /// </summary>
    [Fact]
    public void Debug_LaunchesDebugger()
    {
        _handler.Handle("Debug", JsonDocument.Parse("{}").RootElement);

        _debuggerMock.Verify(d => d.Launch(), Times.Once);
    }

    /// <summary>
    /// Verifies that the ToggleNotifications command opens the Windows Action Center.
    /// </summary>
    [Fact]
    public void ToggleNotifications_OpensActionCenter()
    {
        _handler.Handle("ToggleNotifications", JsonDocument.Parse("{}").RootElement);

        _processMock.Verify(p => p.StartShellExecute("ms-actioncenter:"), Times.Once);
    }
}
