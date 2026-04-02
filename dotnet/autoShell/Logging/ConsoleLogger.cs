// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Logging;

/// <summary>
/// Logger that writes errors and warnings to the console with color formatting,
/// and debug messages to the diagnostics output.
/// </summary>
internal class ConsoleLogger : ILogger
{
    /// <inheritdoc/>
    public void Error(Exception ex)
    {
        System.Diagnostics.Debug.WriteLine(ex);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine("Error: " + ex.Message);
        Console.ForegroundColor = previousColor;
    }

    /// <inheritdoc/>
    public void Warning(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("Warning: " + message);
        Console.ForegroundColor = previousColor;
    }

    /// <inheritdoc/>
    public void Debug(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
    }
}
