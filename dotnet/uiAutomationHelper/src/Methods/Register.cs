// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using UiAutomationHelper.Rpc;

namespace UiAutomationHelper.Methods;

internal static class Register
{
    public static void All(Dispatch dispatch)
    {
        HealthMethods.Register(dispatch);
        AppMethods.Register(dispatch);
        TreeMethods.Register(dispatch);
        ScreenshotMethods.Register(dispatch);
        ActionMethods.Register(dispatch);
    }
}
