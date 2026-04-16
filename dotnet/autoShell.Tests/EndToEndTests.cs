// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;

namespace autoShell.Tests;

/// <summary>
/// End-to-end tests that launch autoShell.exe as a child process and communicate
/// via the stdin/stdout JSON protocol. Tests the full pipeline including process
/// startup, JSON parsing, command dispatch, and response serialization.
/// </summary>
[Trait("Category", "E2E")]
public sealed class EndToEndTests : IDisposable
{
    private readonly AutoShellProcess _process;

    public EndToEndTests()
    {
        _process = AutoShellProcess.StartInteractive();
    }

    public void Dispose()
    {
        _process.Dispose();
    }

    // --- Query commands (assert JSON stdout) ---

    /// <summary>
    /// Verifies that ListAppNames returns a valid JSON array of app names via stdout.
    /// </summary>
    [Fact]
    public async Task ListAppNames_ReturnsJsonArray()
    {
        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");

        string? response = await _process.ReadLineAsync();

        Assert.NotNull(response);
        var result = JsonDocument.Parse(response).RootElement;
        Assert.True(result.GetProperty("success").GetBoolean());
        var data = result.GetProperty("data");
        Assert.True(data.GetArrayLength() > 0);
    }

    /// <summary>
    /// Verifies that ListThemes returns a valid JSON array of theme file paths via stdout.
    /// </summary>
    [Fact]
    public async Task ListThemes_ReturnsJsonArray()
    {
        _process.SendCommand("""{"actionName":"ListThemes","parameters":{}}""");

        // Theme scanning involves disk I/O; allow extra time
        string? response = await _process.ReadLineAsync(10000);

        Assert.NotNull(response);
        var result = JsonDocument.Parse(response).RootElement;
        Assert.True(result.GetProperty("success").GetBoolean());
        var data = result.GetProperty("data");
        Assert.True(data.GetArrayLength() > 0);
    }

    /// <summary>
    /// Verifies that multiple sequential query commands each return a separate response.
    /// </summary>
    [Fact]
    public async Task MultipleQueries_EachReturnsResponse()
    {
        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        string? response1 = await _process.ReadLineAsync();

        _process.SendCommand("""{"actionName":"ListThemes","parameters":{}}""");
        string? response2 = await _process.ReadLineAsync();

        Assert.NotNull(response1);
        Assert.NotNull(response2);
        _ = JsonDocument.Parse(response1);
        _ = JsonDocument.Parse(response2);
    }

    /// </summary>
    [Fact]
    public async Task ListResolutions_ReturnsResponse()
    {
        _process.SendCommand("""{"actionName":"ListResolutions","parameters":{}}""");

        string? response = await _process.ReadLineAsync(10000);

        Assert.NotNull(response);
        Assert.NotEmpty(response);
    }

    /// <summary>
    /// Verifies that ListWifiNetworks returns a response via stdout.
    /// </summary>
    [Fact]
    public async Task ListWifiNetworks_ReturnsResponse()
    {
        _process.SendCommand("""{"actionName":"ListWifiNetworks","parameters":{}}""");

        string? response = await _process.ReadLineAsync(10000);

        Assert.NotNull(response);
        Assert.NotEmpty(response);
    }

    /// <summary>
    /// Verifies that SetScreenResolution with an invalid value produces a response without crashing.
    /// Uses an intentionally invalid resolution to avoid changing the actual display.
    /// </summary>
    [Fact]
    public async Task SetScreenResolution_InvalidValue_ReturnsResponse()
    {
        _process.SendCommand("""{"actionName":"SetScreenResolution","parameters":{"width":99999,"height":99999}}""");

        // May produce an error message or status — just verify the process survives
        // and we can still send commands
        await _process.ReadLineAsync();

        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    // --- Protocol edge cases ---

    /// <summary>
    /// Verifies that two separate commands each produce a response.
    /// </summary>
    [Fact]
    public async Task MultiCommandObject_ProducesMultipleResponses()
    {
        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        _process.SendCommand("""{"actionName":"ListThemes","parameters":{}}""");

        string? response1 = await _process.ReadLineAsync();
        string? response2 = await _process.ReadLineAsync(10000);

        Assert.NotNull(response1);
        Assert.NotNull(response2);
        _ = JsonDocument.Parse(response1);
        _ = JsonDocument.Parse(response2);
    }

    /// <summary>
    /// Verifies that sending a quit command causes the process to exit.
    /// </summary>
    [Fact]
    public async Task Quit_StopsMidBatch()
    {
        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        string? response1 = await _process.ReadLineAsync();
        Assert.NotNull(response1);
        _ = JsonDocument.Parse(response1);

        _process.SendCommand("""{"actionName":"quit","parameters":{}}""");
        _process.WaitForExit(10000);
        Assert.True(_process.HasExited);
    }

    /// <summary>
    /// Verifies that sending {"quit":""} causes the process to exit cleanly.
    /// </summary>
    [Fact]
    public void Quit_ProcessExits()
    {
        _process.SendQuit();

        Assert.True(_process.HasExited);
    }

    /// <summary>
    /// Verifies that malformed JSON does not crash the process.
    /// Sends invalid JSON followed by a valid query to confirm the process is still alive.
    /// </summary>
    [Fact]
    public async Task MalformedJson_ProcessSurvives()
    {
        _process.SendCommand("this is not json");

        // Process should still be alive — send a valid command to verify
        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    /// <summary>
    /// Verifies that an empty line does not crash the process.
    /// The error message goes to stdout (known protocol limitation), so we
    /// consume it before verifying the process is still responsive.
    /// </summary>
    [Fact]
    public async Task EmptyLine_ProcessSurvives()
    {
        _process.SendCommand("");
        // Consume the error/status message that goes to stdout.
        // Allow extra time since empty-line handling may be slow.
        string? errorLine = await _process.ReadLineAsync();

        // Ensure the first read completed before starting a second one
        Assert.False(_process.HasExited);

        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    /// <summary>
    /// Verifies that an unknown command does not crash the process.
    /// </summary>
    [Fact]
    public async Task UnknownCommand_ProcessSurvives()
    {
        _process.SendCommand("""{"actionName":"NonExistentCommand","parameters":{}}""");

        _process.SendCommand("""{"actionName":"ListAppNames","parameters":{}}""");
        string? response = await _process.ReadLineAsync();

        Assert.False(_process.HasExited);
        Assert.NotNull(response);
    }

    /// <summary>
    /// Verifies that closing stdin (EOF) causes the process to exit cleanly.
    /// </summary>
    [Fact]
    public void StdinClosed_ProcessExits()
    {
        _process.CloseStdin();
        _process.WaitForExit(5000);

        Assert.True(_process.HasExited);
    }

    // --- Command-line mode ---

    /// <summary>
    /// Verifies that passing a single JSON command as a command-line argument
    /// executes it and exits (non-interactive mode).
    /// </summary>
    [Fact]
    public void CommandLineMode_SingleObject_ExecutesAndExits()
    {
        var (output, exitCode) = AutoShellProcess.RunWithArgs(
            """{"actionName":"ListAppNames","parameters":{}}""");

        Assert.Equal(0, exitCode);
        Assert.NotEmpty(output);
        _ = JsonDocument.Parse(output.Trim());
    }

    /// <summary>
    /// Verifies that passing a JSON array of commands as command-line arguments
    /// executes all of them and exits.
    /// </summary>
    [Fact]
    public void CommandLineMode_JsonArray_ExecutesAllAndExits()
    {
        var (output, exitCode) = AutoShellProcess.RunWithArgs(
            """[{"actionName":"ListAppNames","parameters":{}},{"actionName":"ListThemes","parameters":{}}]""");

        Assert.Equal(0, exitCode);
        Assert.NotEmpty(output);
    }
}
