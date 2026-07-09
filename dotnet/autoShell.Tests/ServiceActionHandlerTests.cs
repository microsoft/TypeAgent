// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers;
using autoShell.Logging;
using autoShell.Services;
using Moq;

namespace autoShell.Tests;

public class ServiceActionHandlerTests
{
    private readonly Mock<IServiceControlService> _serviceMock = new();
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly ServiceActionHandler _handler;

    public ServiceActionHandlerTests()
    {
        _handler = new ServiceActionHandler(_serviceMock.Object, _loggerMock.Object);
    }

    /// <summary>
    /// Verifies that RestartService with matchBy "name" locates the service by name.
    /// </summary>
    [Fact]
    public void RestartService_MatchByName_CallsServiceByName()
    {
        _serviceMock
            .Setup(s => s.RestartService("Spooler", false))
            .Returns(ServiceControlResult.Ok("Print Spooler"));

        var json = JsonDocument.Parse("""{"service":"Spooler","matchBy":"name"}""").RootElement;
        var result = _handler.Handle("RestartService", json);

        Assert.True(result.Success);
        _serviceMock.Verify(s => s.RestartService("Spooler", false), Times.Once);
    }

    /// <summary>
    /// Verifies that RestartService with matchBy "description" locates the service by description.
    /// </summary>
    [Fact]
    public void RestartService_MatchByDescription_CallsServiceByDescription()
    {
        _serviceMock
            .Setup(s => s.RestartService("windows update", true))
            .Returns(ServiceControlResult.Ok("Windows Update"));

        var json = JsonDocument.Parse("""{"service":"windows update","matchBy":"description"}""").RootElement;
        var result = _handler.Handle("RestartService", json);

        Assert.True(result.Success);
        _serviceMock.Verify(s => s.RestartService("windows update", true), Times.Once);
    }

    /// <summary>
    /// Verifies that RestartService without matchBy defaults to matching by name.
    /// </summary>
    [Fact]
    public void RestartService_NoMatchBy_DefaultsToName()
    {
        _serviceMock
            .Setup(s => s.RestartService("Audiosrv", false))
            .Returns(ServiceControlResult.Ok("Windows Audio"));

        var json = JsonDocument.Parse("""{"service":"Audiosrv"}""").RootElement;
        _handler.Handle("RestartService", json);

        _serviceMock.Verify(s => s.RestartService("Audiosrv", false), Times.Once);
    }

    /// <summary>
    /// Verifies that the resolved service display name is included in the success message.
    /// </summary>
    [Fact]
    public void RestartService_Success_ReturnsDisplayNameInMessage()
    {
        _serviceMock
            .Setup(s => s.RestartService(It.IsAny<string>(), It.IsAny<bool>()))
            .Returns(ServiceControlResult.Ok("Print Spooler"));

        var json = JsonDocument.Parse("""{"service":"Spooler"}""").RootElement;
        var result = _handler.Handle("RestartService", json);

        Assert.True(result.Success);
        Assert.Contains("Print Spooler", result.Message);
    }

    /// <summary>
    /// Verifies that a failure from the service is surfaced as a failed result with its error message.
    /// </summary>
    [Fact]
    public void RestartService_ServiceFails_ReturnsFailureWithError()
    {
        _serviceMock
            .Setup(s => s.RestartService(It.IsAny<string>(), It.IsAny<bool>()))
            .Returns(ServiceControlResult.Fail("No Windows service found with the name or display name 'bogus'."));

        var json = JsonDocument.Parse("""{"service":"bogus"}""").RootElement;
        var result = _handler.Handle("RestartService", json);

        Assert.False(result.Success);
        Assert.Contains("bogus", result.Message);
    }

    /// <summary>
    /// Verifies that an empty service identifier returns a failure without calling the service.
    /// </summary>
    [Fact]
    public void RestartService_EmptyService_ReturnsFailure()
    {
        var json = JsonDocument.Parse("""{"service":""}""").RootElement;
        var result = _handler.Handle("RestartService", json);

        Assert.False(result.Success);
        _serviceMock.Verify(s => s.RestartService(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
    }

    /// <summary>
    /// Verifies that a fuzzy match returns a success result carrying a confirmation payload
    /// (rather than restarting anything) so the agent can confirm the target with the user.
    /// </summary>
    [Fact]
    public void RestartService_FuzzyMatch_ReturnsConfirmationData()
    {
        _serviceMock
            .Setup(s => s.RestartService("spool", false))
            .Returns(ServiceControlResult.Confirm("Spooler", "Print Spooler"));

        var json = JsonDocument.Parse("""{"service":"spool"}""").RootElement;
        var result = _handler.Handle("RestartService", json);

        Assert.True(result.Success);
        Assert.NotNull(result.Data);
        JsonElement data = result.Data.Value;
        Assert.True(data.GetProperty("needsConfirmation").GetBoolean());
        Assert.Equal("Spooler", data.GetProperty("resolvedServiceName").GetString());
        Assert.Equal("Print Spooler", data.GetProperty("resolvedDisplayName").GetString());
        Assert.Equal("restart", data.GetProperty("operation").GetString());
    }
}
