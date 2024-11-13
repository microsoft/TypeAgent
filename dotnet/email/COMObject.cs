// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.InteropServices;

namespace TypeAgent;

public class COMObject : IDisposable
{
    bool _disposed;

    public COMObject()
    {
    }

    ~COMObject()
    {
        Dispose(false);
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

#pragma warning disable CA1063
    void Dispose(bool fromDispose)
    {
        if (!_disposed)
        {
            OnDispose();
            _disposed = true;
        }
    }

    protected virtual void OnDispose() {}

    public static void Release(object value)
    {
#pragma warning disable CA1416
        if (value != null)
        {
            Marshal.ReleaseComObject(value);
        }
    }

    public static void Release(IEnumerable<object> values)
    {
        foreach (object value in values)
        {
            Release(value);
        }
    }

    public static void ReleaseAll()
    {
        GC.Collect();
        GC.WaitForFullGCComplete();
    }
}
