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
    private readonly SystemCommandHandler _handler;

    public SystemCommandHandlerTests()
    {
        _handler = new SystemCommandHandler(_processMock.Object);
    }

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
