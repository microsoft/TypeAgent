# Testing Coder Wrapper

The coder wrapper uses `node-pty` which requires a real TTY (terminal) to function properly. It cannot be tested with automated scripts that pipe input.

## Manual Testing

### Test 1: Node REPL (Simple Test)

```bash
cd packages/coderWrapper
node dist/cli.js -a node
```

Expected behavior:
- Node REPL should start
- You should see the `>` prompt
- Type `1+1` and press Enter → should show `2`
- Type `.exit` to quit
- All colors and formatting should work

### Test 2: Python REPL

```bash
node dist/cli.js -a python
```

Expected behavior:
- Python REPL should start
- You should see the `>>>` prompt
- Type `print("Hello")` and press Enter → should show `Hello`
- Type `exit()` to quit

### Test 3: Claude Code (If Installed)

```bash
node dist/cli.js -a claude
# or just
node dist/cli.js
```

Expected behavior:
- Claude Code CLI should start
- All interactive features should work
- Colors, prompts, and formatting preserved
- Terminal resizing should work
- Ctrl+C should exit gracefully

## What to Verify

✓ **Transparent Passthrough**: All output appears exactly as it would running the command directly
✓ **Colors**: ANSI colors and formatting work correctly
✓ **Interactivity**: Prompts, input, and responses work in real-time
✓ **Terminal Resizing**: Resizing your terminal window updates the PTY size
✓ **Clean Exit**: Ctrl+C or typing exit commands work properly
✓ **Process Management**: No orphaned processes left behind

## Known Limitations

- **Requires Real TTY**: Cannot be tested with piped input/output
- **Windows**: On Windows, commands must have `.exe` extension or be in PATH
- **Exit Behavior**: Some commands may not exit cleanly (wrapper handles this)

## Troubleshooting

### "File not found" error
- Command not in PATH
- On Windows, ensure command ends with `.exe` or is fully qualified

### "stdin.setRawMode is not a function"
- You're not running in a real terminal
- Run directly in terminal, not through a script with pipes

### Process doesn't exit
- Some commands may not handle stdin close properly
- Use Ctrl+C to force exit - wrapper handles this gracefully
