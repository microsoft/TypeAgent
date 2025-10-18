// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

internal static class SqliteEx
{
    public static string? GetStringOrNull(this SqliteDataReader reader, int iCol)
    {
        return reader.IsDBNull(iCol) ? null : reader.GetString(iCol);
    }

    public static int? GetIntOrNull(this SqliteDataReader reader, int iCol)
    {
        return reader.IsDBNull(iCol) ? null : reader.GetInt32(iCol);
    }

    public static void AddParameter(this SqliteCommand cmd, string name, object? value)
    {
        cmd.Parameters.AddWithValue(name, value is not null ? value : DBNull.Value);
    }

    public static void AddParameter(this SqliteCommand cmd, string name, string value)
    {
        cmd.Parameters.AddWithValue(name, value);
    }

    public static void AddParameter(this SqliteCommand cmd, string name, int value)
    {
        cmd.Parameters.AddWithValue(name, value);
    }

    public static void AddIdParameters(this SqliteCommand cmd, string[] placeHolders, IList<int> ids)
    {
        ArgumentVerify.ThrowIfNotEqual(placeHolders.Length, ids.Count, nameof(ids));
        int count = ids.Count;
        for (int i = 0; i < count; ++i)
        {
            cmd.Parameters.AddWithValue(placeHolders[i], ids[i]);
        }
    }

    public static IList<T> GetList<T>(this SqliteDataReader reader, Func<SqliteDataReader, T> cb)
    {
        IList<T> list = [];
        while (reader.Read())
        {
            list.Add(cb(reader));
        }
        return list;
    }

    public static string ToLogString(this SqliteCommand cmd)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Sql:");
        sb.AppendLine(cmd.CommandText);

        if (cmd.Parameters.Count > 0)
        {
            sb.AppendLine("Parameters:");
            foreach (SqliteParameter param in cmd.Parameters)
            {
                sb.AppendLine($"{param.ParameterName} = {param.Value ?? "null"}");
            }
        }
        return sb.ToString();
    }
}
