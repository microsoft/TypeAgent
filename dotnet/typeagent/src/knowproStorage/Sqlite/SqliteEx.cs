// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

internal static class SqliteEx
{
    public static string? GetStringOrNull(this SqliteDataReader reader, int iCol)
    {
        return reader.IsDBNull(iCol) ? null : reader.GetString(iCol);
    }

    public static void AddParameter(this SqliteCommand cmd, string name, object? value)
    {
        cmd.Parameters.AddWithValue(name, value is not null ? value : DBNull.Value );
    }
}
