// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Handlers.Settings;
using autoShell.Services;
using Microsoft.Win32;
using Moq;

namespace autoShell.Tests;

/// <summary>
/// A test subclass of <see cref="SettingsHandlerBase"/> that exposes protected
/// registration methods for unit testing the base class logic.
/// </summary>
internal class TestSettingsHandler : SettingsHandlerBase
{
    public TestSettingsHandler(IRegistryService registry, IProcessService? process = null)
        : base(registry, process) { }

    public new void AddRegistryToggleAction(string actionName, RegistryToggleConfig config) =>
        base.AddRegistryToggleAction(actionName, config);

    public new void AddRegistryMapAction(string actionName, RegistryMapConfig config) =>
        base.AddRegistryMapAction(actionName, config);

    public new void AddOpenSettingsAction(string actionName, OpenSettingsConfig config) =>
        base.AddOpenSettingsAction(actionName, config);

    public new void AddAction(string actionName, Func<JsonElement, ActionResult> handler) =>
        base.AddAction(actionName, handler);
}

public class SettingsHandlerBaseTests
{
    private readonly Mock<IRegistryService> _registryMock = new();
    private readonly Mock<IProcessService> _processMock = new();
    private readonly TestSettingsHandler _handler;

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    public SettingsHandlerBaseTests()
    {
        _handler = new TestSettingsHandler(_registryMock.Object, _processMock.Object);
    }

    /// <summary>
    /// Verifies that a toggle action writes the OnValue when the parameter is true.
    /// </summary>
    [Fact]
    public void Toggle_EnableTrue_WritesOnValue()
    {
        _handler.AddRegistryToggleAction("TestToggle", new RegistryToggleConfig(
            @"Software\Test", "Enabled", "enable", OnValue: 1, OffValue: 0));

        var result = _handler.Handle("TestToggle", Parse("""{"enable":true}"""));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test", "Enabled", 1, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that a toggle action writes the OffValue when the parameter is false.
    /// </summary>
    [Fact]
    public void Toggle_EnableFalse_WritesOffValue()
    {
        _handler.AddRegistryToggleAction("TestToggle", new RegistryToggleConfig(
            @"Software\Test", "Enabled", "enable", OnValue: 1, OffValue: 0));

        var result = _handler.Handle("TestToggle", Parse("""{"enable":false}"""));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test", "Enabled", 0, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that inverted toggles (e.g., ShowFileExtensions where enable=0) work correctly.
    /// </summary>
    [Fact]
    public void Toggle_Inverted_WritesInvertedValues()
    {
        _handler.AddRegistryToggleAction("ShowFileExtensions", new RegistryToggleConfig(
            @"Software\Test", "HideFileExt", "enable", OnValue: 0, OffValue: 1));

        var result = _handler.Handle("ShowFileExtensions", Parse("""{"enable":true}"""));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test", "HideFileExt", 0, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that a toggle with UseLocalMachine writes to HKLM instead of HKCU.
    /// </summary>
    [Fact]
    public void Toggle_UseLocalMachine_WritesToHKLM()
    {
        _handler.AddRegistryToggleAction("DSTToggle", new RegistryToggleConfig(
            @"SYSTEM\Test", "Disabled", "enable", OnValue: 0, OffValue: 1, UseLocalMachine: true));

        _handler.Handle("DSTToggle", Parse("""{"enable":true}"""));

        _registryMock.Verify(r => r.SetValueLocalMachine(@"SYSTEM\Test", "Disabled", 0, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that a toggle defaults to true when the parameter is missing.
    /// </summary>
    [Fact]
    public void Toggle_MissingParameter_DefaultsToTrue()
    {
        _handler.AddRegistryToggleAction("TestToggle", new RegistryToggleConfig(
            @"Software\Test", "Enabled", "enable", OnValue: 1, OffValue: 0));

        var result = _handler.Handle("TestToggle", Parse("{}"));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test", "Enabled", 1, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that a map action writes the mapped DWord value for a known parameter value.
    /// </summary>
    [Fact]
    public void Map_KnownValue_WritesMappedValue()
    {
        _handler.AddRegistryMapAction("TaskbarAlignment", new RegistryMapConfig(
            @"Software\Test", "TaskbarAl", "alignment",
            new Dictionary<string, object> { ["left"] = 0, ["center"] = 1 },
            DefaultValue: 1));

        var result = _handler.Handle("TaskbarAlignment", Parse("""{"alignment":"left"}"""));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test", "TaskbarAl", 0, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that a map action writes the default value for an unknown parameter value.
    /// </summary>
    [Fact]
    public void Map_UnknownValue_WritesDefault()
    {
        _handler.AddRegistryMapAction("TaskbarAlignment", new RegistryMapConfig(
            @"Software\Test", "TaskbarAl", "alignment",
            new Dictionary<string, object> { ["left"] = 0, ["center"] = 1 },
            DefaultValue: 1));

        var result = _handler.Handle("TaskbarAlignment", Parse("""{"alignment":"unknown"}"""));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test", "TaskbarAl", 1, RegistryValueKind.DWord));
    }

    /// <summary>
    /// Verifies that a map action can write string registry values (e.g., privacy "Allow"/"Deny").
    /// </summary>
    [Fact]
    public void Map_StringValueKind_WritesStringValue()
    {
        _handler.AddRegistryMapAction("ManageCameraAccess", new RegistryMapConfig(
            @"Software\Test\webcam", "Value", "accessSetting",
            new Dictionary<string, object> { ["deny"] = "Deny" },
            DefaultValue: "Allow",
            ValueKind: RegistryValueKind.String));

        var result = _handler.Handle("ManageCameraAccess", Parse("""{"accessSetting":"deny"}"""));

        Assert.True(result.Success);
        _registryMock.Verify(r => r.SetValue(@"Software\Test\webcam", "Value", "Deny", RegistryValueKind.String));
    }

    /// <summary>
    /// Verifies that an open-settings action calls StartShellExecute with the configured URI.
    /// </summary>
    [Fact]
    public void OpenSettings_CallsStartShellExecute()
    {
        _handler.AddOpenSettingsAction("EnableGameMode", new OpenSettingsConfig(
            "ms-settings:gaming-gamemode", "Game Mode settings"));

        var result = _handler.Handle("EnableGameMode", Parse("{}"));

        Assert.True(result.Success);
        Assert.Contains("Game Mode settings", result.Message);
        _processMock.Verify(p => p.StartShellExecute("ms-settings:gaming-gamemode"));
    }

    /// <summary>
    /// Verifies that an unknown action name returns a failure result.
    /// </summary>
    [Fact]
    public void Handle_UnknownAction_ReturnsFailure()
    {
        var result = _handler.Handle("NonexistentAction", Parse("{}"));

        Assert.False(result.Success);
        Assert.Contains("Unknown", result.Message);
    }

    /// <summary>
    /// Verifies that SupportedActions returns all registered action names across all patterns.
    /// </summary>
    [Fact]
    public void SupportedActions_ReturnsAllRegisteredActions()
    {
        _handler.AddRegistryToggleAction("Toggle1", new RegistryToggleConfig("k", "v", "p", 1, 0));
        _handler.AddRegistryMapAction("Map1", new RegistryMapConfig("k", "v", "p", [], 0));
        _handler.AddOpenSettingsAction("Open1", new OpenSettingsConfig("ms-settings:test"));

        var commands = new HashSet<string>(_handler.SupportedActions);

        Assert.Equal(3, commands.Count);
        Assert.Contains("Toggle1", commands);
        Assert.Contains("Map1", commands);
        Assert.Contains("Open1", commands);
    }

    /// <summary>
    /// Verifies that SupportedActions includes both AddAction and registered actions.
    /// </summary>
    [Fact]
    public void SupportedActions_IncludesSpecializedAndRegistered()
    {
        _handler.AddRegistryToggleAction("Toggle1", new RegistryToggleConfig("k", "v", "p", 1, 0));
        _handler.AddAction("Custom1", _ => ActionResult.Ok("custom"));

        var commands = new HashSet<string>(_handler.SupportedActions);

        Assert.Equal(2, commands.Count);
        Assert.Contains("Toggle1", commands);
        Assert.Contains("Custom1", commands);
    }

    /// <summary>
    /// Verifies that registering the same action name twice throws InvalidOperationException.
    /// </summary>
    [Fact]
    public void DuplicateRegistration_Throws()
    {
        _handler.AddRegistryToggleAction("Duplicate", new RegistryToggleConfig("k", "v", "p", 1, 0));

        Assert.Throws<InvalidOperationException>(() =>
            _handler.AddRegistryMapAction("Duplicate", new RegistryMapConfig("k", "v", "p", [], 0)));
    }

    /// <summary>
    /// Verifies that registering an AddAction with the same name as a registered action throws.
    /// </summary>
    [Fact]
    public void DuplicateSpecializedRegistration_Throws()
    {
        _handler.AddRegistryToggleAction("Duplicate", new RegistryToggleConfig("k", "v", "p", 1, 0));

        Assert.Throws<InvalidOperationException>(() =>
            _handler.AddAction("Duplicate", _ => ActionResult.Ok("dup")));
    }

    /// <summary>
    /// Verifies that registering an open-settings action without IProcessService throws.
    /// </summary>
    [Fact]
    public void AddOpenSettingsAction_WithoutProcess_Throws()
    {
        var handler = new TestSettingsHandler(_registryMock.Object);

        Assert.Throws<InvalidOperationException>(() =>
            handler.AddOpenSettingsAction("Test", new OpenSettingsConfig("ms-settings:test")));
    }
}
