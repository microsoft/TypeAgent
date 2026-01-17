#!/bin/bash
# Helper script to view MCP server logs

LOG_DIR="/tmp/typeagent-mcp"

if [ ! -d "$LOG_DIR" ]; then
    echo "No logs found yet. The log directory will be created when the MCP server starts."
    echo "Expected location: $LOG_DIR"
    exit 0
fi

# Find the most recent log file
LATEST_LOG=$(ls -t "$LOG_DIR"/mcp-server-*.log 2>/dev/null | head -1)

if [ -z "$LATEST_LOG" ]; then
    echo "No log files found in $LOG_DIR"
    exit 0
fi

echo "Viewing log file: $LATEST_LOG"
echo "=================================================================================="
echo ""

# Check if we should tail (follow) the log
if [ "$1" == "-f" ] || [ "$1" == "--follow" ]; then
    tail -f "$LATEST_LOG"
else
    cat "$LATEST_LOG"
fi
