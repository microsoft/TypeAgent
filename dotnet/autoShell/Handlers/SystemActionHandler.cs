// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers.Generated;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles system/utility commands: Debug and ToggleNotifications.
/// </summary>
internal class SystemActionHandler : ActionHandlerBase
{
    private readonly IProcessService _process;
    private readonly IDebuggerService _debugger;

    public SystemActionHandler(IProcessService process, IDebuggerService debugger)
    {
        _process = process;
        _debugger = debugger;
        AddAction<DebugParams>("Debug", HandleDebug);
        AddAction<ToggleNotificationsParams>("ToggleNotifications", HandleToggleNotifications);
    }

    private ActionResult HandleDebug(DebugParams p)
    {
        _debugger.Launch();
        return ActionResult.Ok("Debugger launched");
    }

    private ActionResult HandleToggleNotifications(ToggleNotificationsParams p)
    {
        _process.StartShellExecute("ms-actioncenter:");
        return ActionResult.Ok("Toggled Action Center");
    }
}
