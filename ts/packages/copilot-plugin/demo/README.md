# Copilot CLI Demo Driver

Records-style demo automation for the Copilot CLI plugin. Drives a demo script of typed prompts at recorder-controlled pace, with TTS narration, screen-recording hotkeys, and turn-completion detection via the plugin's hooks.

Companion to the AutoHotkey-based driver in `driver/`, the PowerShell setup/teardown scripts in `setup/` and `teardown/`, and the demo `.txt` scripts in `scripts/`.

---

## Quick start

1. **Install prerequisites.**
   - AutoHotkey v2 — <https://www.autohotkey.com/>
   - PowerShell 7 (`pwsh`) on `PATH`
   - OBS Studio with hotkeys configured (or use Game Bar via `--record-tool game-bar`)
   - At least one **Windows 11 Natural voice** installed: Settings → Time & Language → Speech → Manage voices → Add voices → search "Natural" → install Aria / Jenny / Guy
2. **Build the plugin** so the hook-state writer is included:
   ```
   cd D:\repos\TypeAgent\ts\packages\copilot-plugin
   pnpm install
   pnpm run build
   ```
3. **Pick a voice.** Run `driver\tools\voice-picker.ahk` and play samples — copy the exact voice name (e.g., `Microsoft Aria Natural`) for use in the `@voice` directive or the `--voice` flag.
4. **Launch the Copilot CLI** in a Windows Terminal window with the plugin loaded.
5. **In a separate AHK launch**, run the driver against your demo script:
   ```
   driver\demo-driver.ahk scripts\montage_v3_opening.txt
   ```
6. **Switch focus** to the Windows Terminal window. Press **Ctrl+Right** to start the first step.

---

## Files

```
demo/
├── README.md                                  this file
├── driver/
│   ├── demo-driver.ahk                        main driver script (AHK v2)
│   └── tools/
│       └── voice-picker.ahk                   interactive voice previewer
├── scripts/
│   └── montage_v3_opening.txt                 sample demo script
├── setup/
│   ├── montage-setup.ps1                      pre-demo setup for Montage
│   └── macros-setup.ps1                       pre-demo setup for macros demo
└── teardown/
    ├── montage-teardown.ps1                   post-demo cleanup for Montage
    └── macros-teardown.ps1                    post-demo cleanup for macros demo
```

---

## Demo script format

A demo script is a UTF-8 `.txt` file. Each non-blank, non-comment line is either:

- **A plain text line** → typed character-by-character into the focused window, then `Enter` is pressed.
- **`@type "<text>"` directive** → explicit form of the above. Functionally identical to a plain line but easier for tooling (visualizers, editors) to parse. Supports inline attributes like `@type "please launch spotify" expect="Spotify" timeout=10s`.
- **Other directives** → start with `@`. Carry an optional positional value and zero or more `key=value` attributes.

Example:

```
@defaults timeout=30s on-timeout=warn type-speed=32 voice="Microsoft Aria Natural"
@focus "Windows Terminal"
@setup setup\montage-setup.ps1

@record-start
@sleep 2s

@say-block "Hi, watch this."
@pause

what was the restaurant we talked about in March?
@expect "Osteria" timeout=45s on-timeout=warn

@record-stop
@teardown teardown\montage-teardown.ps1
```

### Directive reference

| Directive          | Positional         | Attributes                                                            | Behavior                                                                                                                                                                                                |
| ------------------ | ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@defaults`        | —                  | `timeout`, `on-timeout`, `type-speed`, `type-jitter`, `voice`, `mode` | File-level defaults                                                                                                                                                                                     |
| `@voice`           | voice-name         | —                                                                     | Select TTS voice                                                                                                                                                                                        |
| `@type-speed`      | ms                 | `jitter=<ms>`                                                         | Set typing speed and optional jitter                                                                                                                                                                    |
| `@mode`            | `manual` \| `auto` | —                                                                     | Switch advance mode mid-run                                                                                                                                                                             |
| `@type`            | text               | `expect`, `wait-completion`, `timeout`, `on-timeout`                  | Explicit typed line. Same behavior as a plain text line, with inline attributes.                                                                                                                        |
| `@say`             | text               | —                                                                     | Speak (non-blocking)                                                                                                                                                                                    |
| `@say-block`       | text               | —                                                                     | Speak and wait for completion                                                                                                                                                                           |
| `@cue`             | text               | —                                                                     | Display a recorder cue in a separate window. **No TTS**. Pauses for **Ctrl+Right**. Visible even with `--no-hud` and during recording. Use for manual "switch to the browser and click X" instructions. |
| `@sleep`           | duration           | —                                                                     | Wait fixed duration                                                                                                                                                                                     |
| `@pause`           | —                  | —                                                                     | Wait for **Ctrl+Right**                                                                                                                                                                                 |
| `@focus`           | window-title       | —                                                                     | Refuse to type unless this window is focused                                                                                                                                                            |
| `@with`            | —                  | `expect`, `wait-completion`, `timeout`, `on-timeout`                  | Attach attributes to the previous typed line                                                                                                                                                            |
| `@expect`          | text               | `timeout`, `on-timeout`                                               | Shorthand: type completed AND response contains _text_                                                                                                                                                  |
| `@wait-completion` | —                  | `timeout`, `on-timeout`                                               | Shorthand: type completed (no text check)                                                                                                                                                               |
| `@setup`           | path               | —                                                                     | Run a PowerShell setup script (early in file)                                                                                                                                                           |
| `@teardown`        | path               | —                                                                     | Register a teardown script (runs at end or on Esc abort)                                                                                                                                                |
| `@record-start`    | —                  | —                                                                     | Send recording start hotkey                                                                                                                                                                             |
| `@record-stop`     | —                  | —                                                                     | Send recording stop hotkey                                                                                                                                                                              |

### Durations

Accept `30s`, `5000ms`, `1m30s`, or a raw number (treated as milliseconds).

### Timeout policy (`on-timeout`)

Every wait directive accepts `timeout=<duration>` and `on-timeout=<continue|exit|warn>`:

- `continue` — log a warning and proceed. Use for nice-to-have expectations.
- `exit` — log, run teardown, stop recording, exit. Use for "this must work or stop."
- `warn` _(default)_ — pause and wait for **Ctrl+Right** to push through or **Esc** to abort. Recorder makes the live call.

---

## Driver CLI

```
demo-driver.ahk <demo-file> [options]
```

| Option                              | Default                          | Description                                                                                                         |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--mode manual\|auto`               | `manual`                         | Manual = every typed line waits for **Ctrl+Right**. Auto = advance on `turnComplete` event (with timeout fallback). |
| `--no-hud`                          | (HUD on)                         | Suppress HUD entirely. **Use for final recordings.**                                                                |
| `--hud-during-record`               | (auto-hides on record)           | Keep HUD visible while recording.                                                                                   |
| `--record-tool obs\|game-bar\|none` | `obs`                            | Which screen-recorder hotkey to send.                                                                               |
| `--record-start-hotkey "<keys>"`    | `^!{F9}`                         | OBS start hotkey (AHK send syntax).                                                                                 |
| `--record-stop-hotkey "<keys>"`     | `^!{F10}`                        | OBS stop hotkey.                                                                                                    |
| `--voice "<name>"`                  | from script                      | Override TTS voice.                                                                                                 |
| `--no-tts`                          | (TTS on)                         | Suppress all `@say` / `@say-block` lines.                                                                           |
| `--state-path "<path>"`             | `%TEMP%\copilot-demo-state.json` | Override demo-state file path.                                                                                      |

### Hotkeys while running

| Key                  | Action                                                    |
| -------------------- | --------------------------------------------------------- |
| **Ctrl+Right**       | Advance to the next step (when paused)                    |
| **Esc**              | Abort. Runs teardown, stops recording, exits.             |
| **Ctrl+Shift+Right** | Fast-forward: skip the current `@sleep` or `@expect` wait |
| **Ctrl+Shift+P**     | Hard pause / resume (suppresses auto-advance)             |

---

## Setup and teardown scripts

PowerShell scripts that run before and after the demo. Conventions:

- Accept a `-DemoName` parameter (driver passes the demo file name without extension).
- Emit `READY` on stdout when setup is finished.
- Errors should be fatal (non-zero exit) so the driver can warn before recording starts.
- Teardown runs _also_ on `Esc` abort, so make it idempotent.

See `setup/montage-setup.ps1` for a complete example covering: TypeAgent server start, focus-stealing apps closed, stale state file cleared, `gh` auth status check.

---

## How the turn-completion signal works

The plugin hooks (`hook-router.ts`, `hook-agent-stop.ts`) write a JSON file at `%TEMP%\copilot-demo-state.json` every time a Copilot CLI turn completes:

```json
{
  "event": "turnComplete",
  "turnId": "abc123-1716750000000",
  "ts": 1716750000000,
  "mode": "direct",
  "handledBy": "typeagent",
  "lastResponse": "Now playing Nocturne by Chopin",
  "sessionId": "abc123"
}
```

The driver polls this file every 50 ms. A `turnId` change indicates a new turn completed; the `lastResponse` is matched against `@expect` text.

Note: `lastResponse` is populated when the request is **handled by the plugin in direct mode** (router knows the response). In MCP/LLM mode, the LLM produces the response after the router returns; `agentStop` fires when the model finishes, but the driver only sees `lastResponse: ""` in that case. **Practical implication:** `@expect "text"` works reliably in direct mode; in MCP/LLM mode, prefer `@wait-completion` and verify the response visually.

---

## Recording with OBS (recommended)

1. Install OBS Studio.
2. Create a scene that captures the displays/sources you want.
3. Settings → Hotkeys → Start Recording = `Ctrl+Alt+F9`, Stop Recording = `Ctrl+Alt+F10`.
4. Set Output → Recording Path to a known folder (the teardown script moves the latest MP4 from `Videos\Captures\` by default; adjust if OBS writes elsewhere).
5. Run the driver normally — `@record-start` / `@record-stop` send the configured hotkeys.

### Game Bar alternative

For single-window CLI demos where OBS is overkill:

```
demo-driver.ahk scripts\macros_overview.txt --record-tool game-bar
```

The driver sends `Win+Alt+R` for both start and stop. Game Bar must be enabled in Settings → Gaming → Game Bar.

---

## Troubleshooting

| Symptom                             | Cause                                        | Fix                                                                                                                                               |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driver types into the wrong window  | Window focus changed                         | Use `@focus "Windows Terminal"` (or substring) to gate typing                                                                                     |
| `@expect` never matches in MCP mode | Router only sees the response in direct mode | Switch to direct mode (`@typeagent mode direct`) before the segment that uses `@expect`, or use `@wait-completion`                                |
| Demo doesn't advance after a turn   | State file not being written                 | Verify the plugin was rebuilt (`pnpm run build` in `packages/copilot-plugin`); check `%TEMP%\copilot-demo-state.json` exists after a Copilot turn |
| TTS sounds robotic                  | Default SAPI 5 voice is selected             | Install a Windows 11 Natural voice and reference it by exact name in `@voice`                                                                     |
| Recording didn't start              | Hotkey conflict or OBS not running           | Confirm OBS is running with the configured hotkeys; or pass `--record-tool none` to control recording manually                                    |
| Driver fails to find setup script   | Relative path resolution                     | Paths in `@setup` / `@teardown` are resolved relative to the demo file's directory                                                                |
