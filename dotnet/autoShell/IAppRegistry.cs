// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;

namespace autoShell;

/// <summary>
/// Registry of known applications, mapping friendly names to executable paths,
/// AppUserModelIDs, and startup metadata. Shared across handlers that need
/// to resolve, launch, or manipulate applications by friendly name.
/// </summary>
internal interface IAppRegistry
{
    /// <summary>
    /// Gets the executable path for a friendly app name, or null if unknown.
    /// </summary>
    string GetExecutablePath(string friendlyName);

    /// <summary>
    /// Gets the AppUserModelID for a friendly app name, or null if unknown.
    /// Used as a fallback to launch apps via the shell AppsFolder.
    /// </summary>
    string GetAppUserModelId(string friendlyName);

    /// <summary>
    /// Resolves a friendly name to a process name (filename without extension).
    /// Returns the input unchanged if the friendly name is not in the registry.
    /// </summary>
    string ResolveProcessName(string friendlyName);

    /// <summary>
    /// Gets the working directory environment variable for a friendly app name, or null.
    /// The caller should expand it via Environment.ExpandEnvironmentVariables.
    /// </summary>
    string GetWorkingDirectoryEnvVar(string friendlyName);

    /// <summary>
    /// Gets extra command-line arguments for a friendly app name, or null.
    /// </summary>
    string GetArguments(string friendlyName);

    /// <summary>
    /// Returns all known installed application names (from the shell AppsFolder).
    /// </summary>
    IEnumerable<string> GetAllAppNames();
}
