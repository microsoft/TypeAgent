// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Logging;

/// <summary>
/// Logger that writes all messages to the diagnostics output.
/// Errors (red), warnings (yellow), and info (cyan) are written to stderr
/// to prevent interleaving with JSON protocol responses on stdout.
/// Debug messages are written to diagnostics output only.
/// </summary>
internal class ConsoleLogger : ILogger
{
    /// <inheritdoc/>
    public void Error(Exception ex)
    {
        System.Diagnostics.Debug.WriteLine(ex);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Red;
        Console.Error.WriteLine("Error: " + ex.Message);
        Console.ForegroundColor = previousColor;
    }

    /// <inheritdoc/>
    public void Warning(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.Error.WriteLine("Warning: " + message);
        Console.ForegroundColor = previousColor;
    }

    /// <inheritdoc/>
    public void Info(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.Error.WriteLine("Info: " + message);
        Console.ForegroundColor = previousColor;
    }

    /// <inheritdoc/>
    public void Debug(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
    }
}
