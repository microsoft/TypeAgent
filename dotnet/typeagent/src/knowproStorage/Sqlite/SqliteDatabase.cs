// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteDatabase : IDisposable
{
    SqliteConnection _connection;

    public SqliteDatabase(string filePath)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(filePath, nameof(filePath));
        _connection = new SqliteConnection(ConnectionString(filePath));
        _connection.Open();
        EnableWriteAheadLog();
    }

    public void EnsureTable(string tableName, string tableSchema)
    {
        using SqliteCommand cmd = _connection.CreateCommand();
        cmd.CommandText = $@"CREATE TABLE IF NOT EXISTS {tableName}({tableSchema})";
        cmd.ExecuteNonQuery();
    }

    public SqliteCommand CreateCommand(string sql)
    {
        var cmd = _connection.CreateCommand();
        cmd.CommandText = sql;
        return cmd;
    }

    public void EnableWriteAheadLog()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode=WAL;";
        command.ExecuteNonQuery();
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool fromDispose)
    {
        if (fromDispose)
        {
            _connection?.Close();
            _connection = null;
        }
    }

    public static string ConnectionString(string filePath)
    {
        return $"Data Source={filePath}";
    }

    public static void DeleteDatabase(string filePath)
    {
        FileExtensions.RemoveFiles(
            filePath,
            filePath + "-shm",
            filePath + "-wal"
        );
    }

}

