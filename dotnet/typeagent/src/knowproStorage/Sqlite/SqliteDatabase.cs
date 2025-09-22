// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteDatabase : IDisposable
{
    SqliteConnection _connection;

    public SqliteDatabase(string filePath, bool createNew = false)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(filePath, nameof(filePath));

        if (createNew)
        {
            DeleteDatabase(filePath);
        }
        _connection = new SqliteConnection(ConnectionString(filePath));
        _connection.Open();
    }


    public SqliteCommand CreateCommand(string sql)
    {
        var cmd = _connection.CreateCommand();
        cmd.CommandText = sql;
        return cmd;
    }

    public void Execute(string commandText)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(commandText, nameof(commandText));

        using var command = _connection.CreateCommand();
        command.CommandText = commandText;
        command.ExecuteNonQuery();
    }

    public object? FetchOne(string commandText)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(commandText, nameof(commandText));

        using var command = _connection.CreateCommand();
        command.CommandText = commandText;
        return command.ExecuteScalar();
    }

    public int GetCount(string tableName)
    {
        string sql = $"SELECT COUNT(*) FROM {tableName}";
        long count = (long)(FetchOne(sql) ?? 0);
        return (int)count;

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

