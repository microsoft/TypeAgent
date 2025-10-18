// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Used by classes that exports Type information of type T
/// </summary>
/// <typeparam name="T">The type of the type information being exported</typeparam>
public abstract class TypeExporter<T>
{
    private readonly HashSet<T> _exportedTypes;
    private Queue<T>? _pendingTypes;

    /// <summary>
    /// Create an exporter
    /// </summary>
    public TypeExporter()
    {
        _exportedTypes = new HashSet<T>();
    }

    /// <summary>
    /// Reset internal state, allowing this exporter to be reused
    /// </summary>
    public virtual void Clear()
    {
        _exportedTypes?.Clear();
        _pendingTypes?.Clear();
    }

    /// <summary>
    /// Add a type to the pending list of types needing export
    /// </summary>
    /// <param name="type"></param>
    public void AddPending(T type)
    {
        if (!IsExported(type) && ShouldExport(type, out T typeToExport))
        {
            _pendingTypes ??= new Queue<T>();
            _pendingTypes.Enqueue(typeToExport);
        }
    }

    /// <summary>
    /// Add multiple types to the pending types needing export
    /// </summary>
    /// <param name="types"></param>
    public void AddPending(IEnumerable<T> types)
    {
        ArgumentVerify.ThrowIfNull(types, nameof(types));
        foreach (var t in types)
        {
            AddPending(t);
        }
    }

    /// <summary>
    /// Has the given type been exported?
    /// </summary>
    /// <param name="type"></param>
    /// <returns></returns>
    public bool IsExported(T type) => _exportedTypes.Contains(type);

    public void Export(T type)
    {
        AddPending(type);
        ExportPending();
    }

    /// <summary>
    /// Export all currently pending Types
    /// </summary>
    public virtual void ExportPending()
    {
        T? type;
        while ((type = GetPending()) is not null)
        {
            ExportType(type);
        }
    }

    /// <summary>
    /// Implemented by exporters
    /// After exporting a type, exporters should call AddExported(...)
    /// </summary>
    /// <param name="t"></param>
    public abstract void ExportType(T t);

    /// <summary>
    /// Should a type be exported? E.g primitive types may not be.
    /// </summary>
    /// <param name="t"></param>
    /// <param name="typeToExport">type to actually export</param>
    /// <returns></returns>
    protected virtual bool ShouldExport(T t, out T typeToExport)
    {
        typeToExport = t;
        return true;
    }
    /// <summary>
    /// Update the exported list... 
    /// </summary>
    /// <param name="type"></param>
    protected void AddExported(T type)
    {
        _exportedTypes.Add(type);
    }

    /// <summary>
    /// Dequeue the next pendin type for export
    /// </summary>
    /// <returns></returns>
    private T? GetPending()
    {
        if (_pendingTypes is not null && _pendingTypes.Count > 0)
        {
            return _pendingTypes.Dequeue();
        }

        return default;
    }
}
