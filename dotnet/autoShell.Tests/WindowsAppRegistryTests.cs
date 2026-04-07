// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Logging;
using Moq;

namespace autoShell.Tests;

/// <summary>
/// Tests the real <see cref="WindowsAppRegistry"/> implementation to verify dictionary lookups,
/// null-return contracts, and case-insensitive matching.
/// </summary>
public class WindowsAppRegistryTests
{
    private readonly WindowsAppRegistry _registry;

    public WindowsAppRegistryTests()
    {
        _registry = new WindowsAppRegistry(new Mock<ILogger>().Object);
    }

    /// <summary>
    /// Verifies that a known hardcoded app returns its executable path.
    /// </summary>
    [Fact]
    public void GetExecutablePath_KnownApp_ReturnsPath()
    {
        string path = _registry.GetExecutablePath("notepad");

        Assert.NotNull(path);
        Assert.Contains("notepad", path, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Verifies that an unknown app returns null instead of throwing.
    /// </summary>
    [Fact]
    public void GetExecutablePath_UnknownApp_ReturnsNull()
    {
        string path = _registry.GetExecutablePath("nonexistent_app_xyz");

        Assert.Null(path);
    }

    /// <summary>
    /// Verifies that lookups are case-insensitive.
    /// </summary>
    [Theory]
    [InlineData("Notepad")]
    [InlineData("NOTEPAD")]
    [InlineData("notepad")]
    public void GetExecutablePath_CaseInsensitive_ReturnsPath(string name)
    {
        string path = _registry.GetExecutablePath(name);

        Assert.NotNull(path);
    }

    /// <summary>
    /// Verifies that an unknown app returns null for AppUserModelId instead of throwing.
    /// </summary>
    [Fact]
    public void GetAppUserModelId_UnknownApp_ReturnsNull()
    {
        string id = _registry.GetAppUserModelId("nonexistent_app_xyz");

        Assert.Null(id);
    }

    /// <summary>
    /// Verifies that <see cref="IAppRegistry.ResolveProcessName"/> returns the executable filename (without extension) for a known app.
    /// </summary>
    [Fact]
    public void ResolveProcessName_KnownApp_ReturnsProcessName()
    {
        string name = _registry.ResolveProcessName("notepad");

        Assert.Equal("notepad", name);
    }

    /// <summary>
    /// Verifies that <see cref="IAppRegistry.ResolveProcessName"/> returns the input unchanged for an unknown app.
    /// </summary>
    [Fact]
    public void ResolveProcessName_UnknownApp_ReturnsFriendlyName()
    {
        string name = _registry.ResolveProcessName("unknown_app");

        Assert.Equal("unknown_app", name);
    }

    /// <summary>
    /// Verifies that <see cref="IAppRegistry.GetWorkingDirectoryEnvVar"/> returns null for apps without a configured working directory.
    /// </summary>
    [Fact]
    public void GetWorkingDirectoryEnvVar_AppWithoutWorkDir_ReturnsNull()
    {
        string envVar = _registry.GetWorkingDirectoryEnvVar("notepad");

        Assert.Null(envVar);
    }

    /// <summary>
    /// Verifies that <see cref="IAppRegistry.GetArguments"/> returns null for apps without configured arguments.
    /// </summary>
    [Fact]
    public void GetArguments_AppWithoutArgs_ReturnsNull()
    {
        string args = _registry.GetArguments("notepad");

        Assert.Null(args);
    }
}
