// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class MethodExtension
{
    public static void SafeInvoke(this Action action)
    {
        if (action != null)
        {
            try
            {
                action();
            }
            catch
            {
            }
        }
    }

    public static void SafeInvoke<T1>(this Action<T1> action, T1 arg1)
    {
        if (action != null)
        {
            try
            {
                action(arg1);
            }
            catch
            {
            }
        }
    }

    public static void SafeInvoke<T1, T2>(this Action<T1, T2> action, T1 arg1, T2 arg2)
    {
        if (action != null)
        {
            try
            {
                action(arg1, arg2);
            }
            catch
            {
            }
        }
    }

    public static void SafeInvoke<T1, T2, T3>(this Action<T1, T2, T3> action, T1 arg1, T2 arg2, T3 arg3)
    {
        if (action != null)
        {
            try
            {
                action(arg1, arg2, arg3);
            }
            catch
            {
            }
        }
    }
}
