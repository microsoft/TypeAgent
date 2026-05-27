; Copyright (c) Microsoft Corporation.
; Licensed under the MIT License.
;
; demo-driver.ahk — drives the Copilot CLI (or any focused window) through
; a scripted demo with simulated typing, TTS narration, screen-recording
; hotkeys, and turn-completion detection via the plugin's state file.
;
; Usage:
;   demo-driver.ahk <demo-file> [options]
;
; Options:
;   --mode manual|auto              Advance mode. Default: manual.
;   --no-hud                        Suppress HUD entirely.
;   --hud-during-record             Keep HUD visible while recording.
;   --record-tool obs|game-bar|none Recording integration. Default: obs.
;   --record-start-hotkey <keys>    Recording start hotkey (AHK send syntax).
;   --record-stop-hotkey  <keys>    Recording stop hotkey.
;   --voice "<name>"                Override TTS voice.
;   --no-tts                        Suppress all @say / @say-block lines.
;   --state-path "<path>"           Override demo-state file path.
;
; Hotkeys while running:
;   Ctrl+Right         Advance (when paused)
;   Esc                Abort (runs teardown, stops recording, exits)
;   Ctrl+Shift+Right   Fast-forward through current wait
;   Ctrl+Shift+P       Hard pause / resume

#Requires AutoHotkey v2.0
#SingleInstance Force
SetWorkingDir A_ScriptDir
SetTitleMatchMode 2  ; substring matching for WinGetTitle / WinActivate
A_HotkeyInterval := 100

; ============================================================
; Global state
; ============================================================

global G := {
    demoFile: "",
    mode: "manual",
    showHud: true,
    hudDuringRecord: false,
    recordTool: "obs",
    recordStartHotkey: "^!{F9}",
    recordStopHotkey: "^!{F10}",
    voiceOverride: "",
    ttsEnabled: true,
    statePath: EnvGet("TYPEAGENT_DEMO_STATE_PATH"),
    steps: [],
    cursor: 1,
    defaults: Map(
        "timeout", 30000,
        "on-timeout", "warn",
        "type-speed", 30,
        "type-jitter", 10,
        "voice", "",
        "mode", "manual"
    ),
    focusTitle: "",  ; empty => no focus check
    teardownPath: "",
    recording: false,
    sapi: "",
    lastTurnId: "",
    ; flags toggled by hotkeys
    advance: false,
    fastForward: false,
    abort: false,
    hardPause: false,
    hud: "",  ; HUD GUI object
    cueGui: ""  ; Separate small window for @cue (visible even when HUD hidden)
}

if !G.statePath
    G.statePath := A_Temp "\copilot-demo-state.json"

; ============================================================
; Entry point
; ============================================================

ParseArgs()
if G.demoFile = ""
    Die("Usage: demo-driver.ahk <demo-file> [options]`nSee header of this script for option list.")
if !FileExist(G.demoFile)
    Die("Demo file not found: " G.demoFile)

G.steps := ParseDemoFile(G.demoFile)
if G.steps.Length = 0
    Die("Demo file is empty: " G.demoFile)

InitSapi()
HudInit()
HudShow("Loaded " G.steps.Length " steps. Ctrl+Right to start, Esc to abort.")
RegisterHotkeys()

; Wait for the user to press Ctrl+Right before starting the first step.
; This lets the recorder position windows / start their own recording
; controls before the demo actually starts.
WaitForAdvance("paused — Ctrl+Right to begin")

try {
    RunDemo()
    HudShow("Demo finished. Press Esc to close.")
    WaitForAbort()
} catch as err {
    HudShow("ERROR: " err.Message)
    OutputDebug "Demo driver error: " err.Message "`n" err.Stack
    Cleanup()
    ExitApp 1
}

Cleanup()
ExitApp 0

; ============================================================
; Argument parsing
; ============================================================

ParseArgs() {
    args := A_Args
    i := 1
    while i <= args.Length {
        a := args[i]
        switch a {
            case "--mode":
                G.mode := NextArg(args, &i)
                if G.mode != "manual" && G.mode != "auto"
                    Die("--mode must be 'manual' or 'auto'")
            case "--no-hud":
                G.showHud := false
            case "--hud-during-record":
                G.hudDuringRecord := true
            case "--record-tool":
                G.recordTool := NextArg(args, &i)
                if !(G.recordTool ~= "i)^(obs|game-bar|none)$")
                    Die("--record-tool must be 'obs', 'game-bar', or 'none'")
            case "--record-start-hotkey":
                G.recordStartHotkey := NextArg(args, &i)
            case "--record-stop-hotkey":
                G.recordStopHotkey := NextArg(args, &i)
            case "--voice":
                G.voiceOverride := NextArg(args, &i)
            case "--no-tts":
                G.ttsEnabled := false
            case "--state-path":
                G.statePath := NextArg(args, &i)
            default:
                if SubStr(a, 1, 2) = "--"
                    Die("Unknown option: " a)
                if G.demoFile = ""
                    G.demoFile := a
                else
                    Die("Unexpected positional argument: " a)
        }
        i++
    }
}

NextArg(args, &i) {
    i++
    if i > args.Length
        Die("Missing value after " args[i - 1])
    return args[i]
}

; ============================================================
; Demo file parser
;
; Returns an array of step objects. Each step has:
;   kind:      "type" | "directive"
;   text:      raw text (for "type") or directive name (without @)
;   positional: positional arg (string) or ""
;   attrs:     Map of key=value
;   raw:       original line (for debugging)
;
; @with applies its attrs to the previous "type" step instead of becoming
; its own step.
; ============================================================

ParseDemoFile(path) {
    raw := FileRead(path, "UTF-8")
    lines := StrSplit(raw, "`n", "`r")
    steps := []
    lastTypeIdx := 0  ; index in steps[] of the most-recent typed line

    for lineNum, line in lines {
        trimmed := Trim(line)
        if trimmed = ""
            continue
        if SubStr(trimmed, 1, 1) = "#"
            continue

        if SubStr(trimmed, 1, 1) = "@" {
            ; Directive
            parsed := ParseDirective(trimmed)
            if parsed.name = "type" {
                ; Explicit typed line. Equivalent to a plain text line but
                ; with inline attribute support and clearer for tooling.
                if parsed.positional = ""
                    Die("Line " lineNum ": @type requires a text argument")
                steps.Push({
                    kind: "type",
                    text: parsed.positional,
                    positional: "",
                    attrs: parsed.attrs,
                    raw: trimmed
                })
                lastTypeIdx := steps.Length
            } else if parsed.name = "with" {
                if lastTypeIdx = 0
                    Die("Line " lineNum ": @with has no preceding typed line")
                MergeAttrs(steps[lastTypeIdx].attrs, parsed.attrs)
            } else if parsed.name = "expect" {
                ; Shorthand: bind expect text + attrs to the previous typed line
                if lastTypeIdx = 0
                    Die("Line " lineNum ": @expect has no preceding typed line")
                steps[lastTypeIdx].attrs["expect"] := parsed.positional
                MergeAttrs(steps[lastTypeIdx].attrs, parsed.attrs)
            } else if parsed.name = "wait-completion" {
                if lastTypeIdx = 0
                    Die("Line " lineNum ": @wait-completion has no preceding typed line")
                steps[lastTypeIdx].attrs["wait-completion"] := true
                MergeAttrs(steps[lastTypeIdx].attrs, parsed.attrs)
            } else {
                steps.Push({
                    kind: "directive",
                    text: parsed.name,
                    positional: parsed.positional,
                    attrs: parsed.attrs,
                    raw: trimmed
                })
            }
        } else {
            steps.Push({
                kind: "type",
                text: trimmed,
                positional: "",
                attrs: Map(),
                raw: trimmed
            })
            lastTypeIdx := steps.Length
        }
    }

    return steps
}

ParseDirective(line) {
    ; line starts with "@"
    body := SubStr(line, 2)
    tokens := Tokenize(body)
    if tokens.Length = 0
        Die("Empty directive: " line)

    name := tokens[1]
    positional := ""
    attrs := Map()
    rest := []
    for i, t in tokens {
        if i = 1
            continue
        if InStr(t, "=") {
            rest.Push(t)
        } else {
            if positional = ""
                positional := t
            else
                rest.Push(t)  ; extra positional after first is treated as attr-less; ignored
        }
    }

    for _, t in rest {
        if !InStr(t, "=")
            continue
        eqPos := InStr(t, "=")
        k := SubStr(t, 1, eqPos - 1)
        v := SubStr(t, eqPos + 1)
        attrs[k] := v
    }

    return { name: name, positional: positional, attrs: attrs }
}

; Tokenize a string respecting double-quoted segments. Quotes may appear at
; the start of a token (whole-token quoting) or mid-token (key="value with
; spaces"). Backslash escapes \" and \\ inside quotes.
Tokenize(s) {
    tokens := []
    buf := ""
    inQuotes := false
    pushed := false  ; whether the current buf was started (to distinguish empty vs nothing)
    i := 1
    len := StrLen(s)
    while i <= len {
        c := SubStr(s, i, 1)
        if inQuotes {
            if c = '\' && i + 1 <= len {
                nxt := SubStr(s, i + 1, 1)
                if nxt = '"' || nxt = '\' {
                    buf .= nxt
                    i += 2
                    continue
                }
            }
            if c = '"' {
                inQuotes := false
                i++
                continue
            }
            buf .= c
            pushed := true
            i++
            continue
        }
        ; not in quotes
        if c = " " || c = "`t" {
            if pushed {
                tokens.Push(buf)
                buf := ""
                pushed := false
            }
            i++
            continue
        }
        if c = '"' {
            inQuotes := true
            pushed := true  ; quoted empty string is still a token
            i++
            continue
        }
        buf .= c
        pushed := true
        i++
    }
    if pushed
        tokens.Push(buf)
    return tokens
}

MergeAttrs(dst, src) {
    for k, v in src
        dst[k] := v
}

; ============================================================
; Duration parsing — "30s", "5000ms", "1m30s", "1500" (raw ms)
; ============================================================

ParseDuration(value) {
    s := Trim(value)
    if s = ""
        return 0
    ; Pure number => milliseconds
    if s ~= "^\d+$"
        return s + 0
    total := 0
    pos := 1
    while pos <= StrLen(s) {
        if !RegExMatch(s, "^(\d+)(ms|s|m|h)", &m, pos)
            Die("Invalid duration: " value)
        n := m[1] + 0
        switch m[2] {
            case "ms": total += n
            case "s":  total += n * 1000
            case "m":  total += n * 60000
            case "h":  total += n * 3600000
        }
        pos += m.Len[0]
    }
    return total
}

; ============================================================
; SAPI / TTS
; ============================================================

InitSapi() {
    if !G.ttsEnabled
        return
    try {
        G.sapi := ComObject("SAPI.SpVoice")
    } catch as err {
        OutputDebug "SAPI init failed: " err.Message
        G.sapi := ""
        G.ttsEnabled := false
    }
}

SelectVoice(name) {
    if !G.ttsEnabled || G.sapi = ""
        return
    if name = ""
        return
    voices := G.sapi.GetVoices()
    Loop voices.Count {
        v := voices.Item(A_Index - 1)
        desc := v.GetDescription()
        if InStr(desc, name) {
            G.sapi.Voice := v
            return
        }
    }
    HudShow('Voice not found: "' name '" (continuing with default)')
}

Speak(text, async := false) {
    if !G.ttsEnabled || G.sapi = ""
        return
    ; flag bits: 1 = async, 2 = purge before speak
    flag := async ? 1 : 0
    try {
        G.sapi.Speak(text, flag)
    } catch as err {
        OutputDebug "SAPI speak failed: " err.Message
    }
}

PurgeSpeech() {
    if !G.ttsEnabled || G.sapi = ""
        return
    try {
        G.sapi.Speak("", 2)
    } catch {
    }
}

; ============================================================
; HUD (always-on-top status window)
; ============================================================

HudInit() {
    if !G.showHud
        return
    G.hud := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20", "demo-driver")
    G.hud.BackColor := "1F1F1F"
    G.hud.SetFont("s10 cE0E0E0", "Consolas")
    G.hud.MarginX := 12
    G.hud.MarginY := 8
    G.hud.AddText("vTitle w480", "demo-driver — waiting")
    G.hud.AddText("vStatus w480 cFFD08A", "")
    G.hud.AddText("vNext w480 c98C379", "")
    G.hud.AddText("vKeys w480 c808080", "Ctrl+Right continue · Esc abort · Ctrl+Shift+Right fast-forward")
    ; bottom-right of primary screen, 510px wide w/ 20px margin from each edge
    G.hud.Show("AutoSize x" (A_ScreenWidth - 510) " y" (A_ScreenHeight - 130) " NoActivate")
}

HudHide() {
    if G.showHud && G.hud
        G.hud.Hide()
}

HudReshow() {
    if G.showHud && G.hud
        G.hud.Show("NoActivate")
}

HudShow(status, nextPreview := "") {
    if !G.showHud || !G.hud
        return
    title := "demo-driver  ·  step " G.cursor "/" G.steps.Length
    G.hud["Title"].Value := title
    G.hud["Status"].Value := status
    G.hud["Next"].Value := nextPreview = "" ? "" : "next: " nextPreview
}

; Cue window — separate from the HUD. Always shown when a cue is active,
; even with --no-hud or during recording (the recorder needs to see manual
; instructions). Hidden as soon as the recorder advances.
CueShow(text) {
    if !G.cueGui {
        G.cueGui := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20", "demo-driver-cue")
        G.cueGui.BackColor := "8B0000"  ; dark red so it's clearly distinguishable from the HUD
        G.cueGui.SetFont("s12 cFFFFFF Bold", "Segoe UI")
        G.cueGui.MarginX := 14
        G.cueGui.MarginY := 10
        G.cueGui.AddText("vCueLabel w560", "RECORDER CUE")
        G.cueGui.SetFont("s11 cFFFFFF Norm", "Segoe UI")
        G.cueGui.AddText("vCueText w560 r3", "")
        G.cueGui.SetFont("s9 cFFD0D0 Norm", "Segoe UI")
        G.cueGui.AddText("vCueKeys w560", "Ctrl+Right to continue · Esc to abort")
    }
    G.cueGui["CueText"].Value := text
    ; Position at top-center of primary screen
    G.cueGui.Show("AutoSize x" (A_ScreenWidth / 2 - 300) " y40 NoActivate")
}

CueHide() {
    if G.cueGui
        G.cueGui.Hide()
}

; ============================================================
; Hotkey handling
; ============================================================

RegisterHotkeys() {
    Hotkey("^Right",        AdvancePressed,    "On")
    Hotkey("Esc",           AbortPressed,      "On")
    Hotkey("^+Right",       FastForwardPressed,"On")
    Hotkey("^+p",           HardPauseToggle,   "On")
}

AdvancePressed(*) {
    G.advance := true
}

AbortPressed(*) {
    G.abort := true
    G.advance := true  ; unblock any waits
    PurgeSpeech()
}

FastForwardPressed(*) {
    G.fastForward := true
    G.advance := true
}

HardPauseToggle(*) {
    G.hardPause := !G.hardPause
    HudShow(G.hardPause ? "hard-paused" : "running")
}

; ============================================================
; Wait helpers
; ============================================================

; Wait for the user to press Ctrl+Right (advance) or Esc (abort).
WaitForAdvance(statusText) {
    HudShow(statusText)
    while !G.advance {
        Sleep 50
        if G.hardPause {
            ; just keep sleeping
        }
    }
    G.advance := false
    if G.abort
        Throw Error("aborted by user")
}

WaitForAbort() {
    while !G.abort
        Sleep 100
}

; Pause for fixed duration but be interruptible by Esc / fast-forward.
InterruptibleSleep(ms) {
    deadline := A_TickCount + ms
    while A_TickCount < deadline {
        if G.abort
            Throw Error("aborted by user")
        if G.fastForward {
            G.fastForward := false
            return
        }
        Sleep 50
    }
}

; ============================================================
; Demo state file polling
;
; Returns one of: "ok" (turn completed and optional expect matched),
; "timeout", "aborted", "fast-forward".
; ============================================================

WaitForTurnComplete(timeoutMs, expectText := "") {
    HudShow(expectText = "" ? "waiting for turn complete..." : 'waiting for "' expectText '" in response...')
    deadline := A_TickCount + timeoutMs
    while A_TickCount < deadline {
        if G.abort
            return "aborted"
        if G.fastForward {
            G.fastForward := false
            return "fast-forward"
        }
        if FileExist(G.statePath) {
            text := ""
            try {
                text := FileRead(G.statePath, "UTF-8")
            } catch {
                ; partial write — keep waiting
            }
            if text != "" {
                turnId := ExtractJsonString(text, "turnId")
                if turnId != "" && turnId != G.lastTurnId {
                    if expectText = "" {
                        G.lastTurnId := turnId
                        return "ok"
                    }
                    last := ExtractJsonString(text, "lastResponse")
                    if InStr(last, expectText, false) {  ; case-insensitive
                        G.lastTurnId := turnId
                        return "ok"
                    }
                    ; turn changed but text didn't match — record turn anyway
                    ; (we don't expect another turn for the same prompt)
                    G.lastTurnId := turnId
                    return "ok-text-mismatch"
                }
            }
        }
        Sleep 50
    }
    return "timeout"
}

; Minimal JSON string-field extractor. Robust enough for our fixed-shape
; state file. Handles \\ and \" escapes inside the value.
ExtractJsonString(json, field) {
    needle := '"' field '"'
    pos := InStr(json, needle, true)
    if pos = 0
        return ""
    ; skip to opening quote of value
    rest := SubStr(json, pos + StrLen(needle))
    colon := InStr(rest, ":")
    if colon = 0
        return ""
    afterColon := SubStr(rest, colon + 1)
    q := InStr(afterColon, '"')
    if q = 0
        return ""
    afterQuote := SubStr(afterColon, q + 1)
    ; walk forward collecting chars until unescaped "
    buf := ""
    i := 1
    len := StrLen(afterQuote)
    while i <= len {
        c := SubStr(afterQuote, i, 1)
        if c = '\' && i + 1 <= len {
            nxt := SubStr(afterQuote, i + 1, 1)
            if nxt = '"' || nxt = '\' {
                buf .= nxt
                i += 2
                continue
            }
            if nxt = "n" {
                buf .= "`n"
                i += 2
                continue
            }
            buf .= c
            i++
            continue
        }
        if c = '"'
            return buf
        buf .= c
        i++
    }
    return ""
}

; ============================================================
; Typing into the focused window
; ============================================================

CheckFocus() {
    if G.focusTitle = ""
        return true
    title := ""
    try {
        title := WinGetTitle("A")
    } catch {
        return false
    }
    return InStr(title, G.focusTitle, false) > 0
}

TypeLine(text) {
    ; Ensure the right window is focused; if not, pause and warn.
    while !CheckFocus() {
        HudShow('focus the "' G.focusTitle '" window — Ctrl+Right when ready')
        WaitForAdvance('focus the "' G.focusTitle '" window — Ctrl+Right when ready')
        if G.abort
            Throw Error("aborted by user")
    }

    speed := G.defaults["type-speed"] + 0
    jitter := G.defaults["type-jitter"] + 0
    Loop Parse, text {
        ch := A_LoopField
        if G.abort
            Throw Error("aborted by user")
        if G.fastForward {
            G.fastForward := false
            remaining := SubStr(text, A_Index)
            SendInput("{Text}" remaining)
            break
        }
        SendInput("{Text}" ch)
        delay := speed + Random(-jitter, jitter)
        if delay > 0
            Sleep(delay)
        if ch = " "
            Sleep(30)  ; small extra at word boundaries
    }
    SendInput("{Enter}")
}

; ============================================================
; Recording control
; ============================================================

RecordingStart() {
    switch G.recordTool {
        case "none":
            return
        case "game-bar":
            SendInput "#!r"  ; Win+Alt+R
        default:  ; "obs"
            SendInput G.recordStartHotkey
    }
    G.recording := true
    if G.showHud && !G.hudDuringRecord
        HudHide()
}

RecordingStop() {
    switch G.recordTool {
        case "none":
            return
        case "game-bar":
            SendInput "#!r"  ; toggle off
        default:
            SendInput G.recordStopHotkey
    }
    G.recording := false
    if G.showHud
        HudReshow()
}

; ============================================================
; Setup / teardown
; ============================================================

RunPowerShell(path, demoName) {
    if !FileExist(path) {
        HudShow("setup/teardown script not found: " path)
        return
    }
    cmd := 'pwsh -NoProfile -ExecutionPolicy Bypass -File "' path '" -DemoName "' demoName '"'
    HudShow("running " path " ...")
    try {
        RunWait(cmd, , "Hide")
    } catch as err {
        HudShow("PowerShell failed: " err.Message)
    }
}

; ============================================================
; Step execution
; ============================================================

RunDemo() {
    while G.cursor <= G.steps.Length {
        if G.abort
            Throw Error("aborted by user")
        while G.hardPause
            Sleep 100

        step := G.steps[G.cursor]
        preview := step.kind = "type" ? '"' step.text '"' : "@" step.text
        HudShow("step " G.cursor "/" G.steps.Length, preview)
        ExecuteStep(step)
        G.cursor++
    }
}

ExecuteStep(step) {
    if step.kind = "type" {
        TypeLine(step.text)
        WaitAfterType(step)
        return
    }

    ; Directive
    switch step.text {
        case "defaults":
            for k, v in step.attrs
                ApplyDefault(k, v)
        case "voice":
            v := step.positional != "" ? step.positional : (step.attrs.Has("name") ? step.attrs["name"] : "")
            if G.voiceOverride != ""
                v := G.voiceOverride
            G.defaults["voice"] := v
            SelectVoice(v)
        case "type-speed":
            if step.positional != ""
                G.defaults["type-speed"] := step.positional + 0
            if step.attrs.Has("jitter")
                G.defaults["type-jitter"] := step.attrs["jitter"] + 0
        case "mode":
            if step.positional != ""
                G.mode := step.positional
        case "say":
            if G.ttsEnabled
                Speak(step.positional, true)
        case "say-block":
            if G.ttsEnabled
                Speak(step.positional, false)
        case "sleep":
            InterruptibleSleep(ParseDuration(step.positional))
        case "pause":
            WaitForAdvance("paused — Ctrl+Right to continue")
        case "cue":
            ; Cue: show the recorder a manual instruction. Visible even when
            ; the main HUD is hidden. Pauses for Ctrl+Right.
            cueText := step.positional != "" ? step.positional : "(empty cue)"
            CueShow(cueText)
            HudShow("cue active — Ctrl+Right to continue", cueText)
            try {
                WaitForAdvance("cue — Ctrl+Right to continue")
            } finally {
                CueHide()
            }
        case "focus":
            G.focusTitle := step.positional
        case "setup":
            RunPowerShell(ResolvePath(step.positional), DemoNameFromFile())
        case "teardown":
            G.teardownPath := ResolvePath(step.positional)
        case "record-start":
            RecordingStart()
        case "record-stop":
            RecordingStop()
        default:
            HudShow("unknown directive: @" step.text)
    }
}

ApplyDefault(key, value) {
    switch key {
        case "timeout", "type-speed", "type-jitter":
            if key = "timeout"
                G.defaults[key] := ParseDuration(value)
            else
                G.defaults[key] := value + 0
        case "on-timeout":
            if !(value ~= "i)^(continue|exit|warn)$")
                Die("on-timeout must be continue|exit|warn, got: " value)
            G.defaults[key] := StrLower(value)
        case "voice":
            G.defaults[key] := value
            SelectVoice(value)
        case "mode":
            G.mode := value
    }
}

WaitAfterType(step) {
    expect := step.attrs.Has("expect") ? step.attrs["expect"] : ""
    waitCompletion := step.attrs.Has("wait-completion")
    hasWaitDirective := expect != "" || waitCompletion

    if hasWaitDirective {
        timeout := step.attrs.Has("timeout")
            ? ParseDuration(step.attrs["timeout"])
            : G.defaults["timeout"]
        onTimeout := step.attrs.Has("on-timeout")
            ? StrLower(step.attrs["on-timeout"])
            : G.defaults["on-timeout"]
        result := WaitForTurnComplete(timeout, expect)
        HandleWaitResult(result, onTimeout, expect)
        return
    }

    ; No explicit wait — fall through based on mode
    if G.mode = "manual" {
        WaitForAdvance("typed — Ctrl+Right for next step")
    } else {
        ; auto: wait for any turn-complete signal up to default timeout
        result := WaitForTurnComplete(G.defaults["timeout"], "")
        HandleWaitResult(result, G.defaults["on-timeout"], "")
    }
}

HandleWaitResult(result, onTimeout, expect) {
    switch result {
        case "ok", "fast-forward":
            return
        case "ok-text-mismatch":
            msg := 'turn completed but response did not contain "' expect '"'
            HudShow(msg)
            HandleTimeoutPolicy(onTimeout, msg)
        case "timeout":
            msg := expect = "" ? "timeout waiting for turn completion"
                                : 'timeout waiting for "' expect '"'
            HudShow(msg)
            HandleTimeoutPolicy(onTimeout, msg)
        case "aborted":
            Throw Error("aborted by user")
    }
}

HandleTimeoutPolicy(policy, msg) {
    switch policy {
        case "continue":
            ; log and proceed
            OutputDebug "[demo] " msg
        case "exit":
            Throw Error(msg)
        default:  ; warn
            WaitForAdvance(msg " — Ctrl+Right to continue, Esc to abort")
    }
}

; ============================================================
; Utilities
; ============================================================

ResolvePath(p) {
    if p = ""
        return ""
    if SubStr(p, 2, 1) = ":" || SubStr(p, 1, 2) = "\\"
        return p  ; already absolute
    ; relative to the demo file's directory
    SplitPath G.demoFile, , &dir
    return dir "\" p
}

DemoNameFromFile() {
    SplitPath G.demoFile, , , , &nameNoExt
    return nameNoExt
}

Cleanup() {
    ; Stop recording if we started it.
    if G.recording {
        try RecordingStop()
    }
    ; Run teardown if registered.
    if G.teardownPath != "" && FileExist(G.teardownPath)
        RunPowerShell(G.teardownPath, DemoNameFromFile())
    CueHide()
    HudHide()
}

Die(msg) {
    MsgBox msg, "demo-driver", 0x10
    ExitApp 1
}
