# Desktop Agent End-to-End Testing Instructions

## ✅ Pre-Test Verification

**Grammar Test Status:** ✅ All 32 tests passing (100% success rate)
**Build Status:** ✅ TypeScript, Action Schema, Grammar compiled successfully
**C# Backend:** ✅ autoShell.exe (148KB) ready at `dotnet/autoShell/bin/Debug/autoShell.exe`

---

## 🚀 Starting TypeAgent CLI

### Option 1: From the CLI package

```bash
cd ts/packages/cli
pnpm start
```

### Option 2: Using the root script (if available)

```bash
cd ts
pnpm run cli
```

---

## 🧪 Test Commands

### Category 1: Network Settings (3 actions)

```
@desktop turn on bluetooth
@desktop disable wifi
@desktop enable metered connection
```

**Expected:**

- Bluetooth toggles on/off
- WiFi adapter enables/disables
- Metered connection setting changes

---

### Category 2: Display Settings (7 actions)

```
@desktop increase brightness
@desktop make the screen dimmer
@desktop enable night light
@desktop set orientation to landscape
@desktop lock rotation
```

**Expected:**

- Screen brightness adjusts
- Night light schedule configured
- Screen orientation changes

---

### Category 3: Personalization (3 actions)

```
@desktop enable transparency
@desktop show accent color on title bars
@desktop enable high contrast
```

**Expected:**

- Transparency effects toggle
- Title bar colors change
- High contrast settings dialog opens

---

### Category 4: Taskbar Settings (7 actions)

```
@desktop auto hide taskbar
@desktop center the taskbar
@desktop show task view button
@desktop hide widgets
@desktop show seconds in clock
```

**Expected:**

- Taskbar auto-hides or shows
- Taskbar moves to center/left
- Task view button visibility changes
- Widgets button hides
- Clock shows/hides seconds

---

### Category 5: Mouse Settings (8 actions)

```
@desktop set mouse speed to 12
@desktop scroll 5 lines per notch
@desktop swap mouse buttons
@desktop enable mouse acceleration
```

**Expected:**

- Mouse cursor speed changes
- Scroll wheel behavior adjusts
- Primary mouse button switches
- Pointer precision toggles

---

### Category 6: Privacy Settings (3 actions)

```
@desktop allow microphone access
@desktop deny camera access
@desktop enable location services
```

**Expected:**

- Privacy settings dialogs open or settings change
- App permissions for mic/camera/location adjust

---

### Category 7: Power Settings (3 actions)

```
@desktop set battery saver to 20 percent
@desktop set power mode to best performance
```

**Expected:**

- Battery saver threshold changes
- Power mode switches (performance/balanced/efficiency)

---

### Category 8: Accessibility Settings (5 actions)

```
@desktop start narrator
@desktop turn off magnifier
@desktop enable sticky keys
```

**Expected:**

- Narrator starts/stops
- Magnifier launches or closes
- Sticky keys toggles on/off

---

### Category 9: File Explorer Settings (2 actions)

```
@desktop show file extensions
@desktop show hidden files
```

**Expected:**

- File Explorer shows/hides file extensions
- Hidden and system files become visible/hidden

---

### Category 10: Existing Actions (baseline test)

```
@desktop set theme to dark
@desktop set volume to 50
@desktop launch notepad
```

**Expected:**

- Windows theme switches to dark mode
- System volume changes to 50%
- Notepad application launches

---

## 🔍 What to Verify

### 1. Grammar Matching

- [ ] TypeAgent correctly interprets natural language commands
- [ ] Action names and parameters extracted correctly
- [ ] Confirmation messages displayed

### 2. JSON Protocol

- [ ] TypeScript → C# communication works
- [ ] autoShell.exe receives correct JSON commands
- [ ] Parameters passed correctly (numbers, booleans, enums)

### 3. Windows API Execution

- [ ] Registry changes persist
- [ ] Win32 API calls succeed
- [ ] WMI commands execute (brightness)
- [ ] COM interop works (Bluetooth)

### 4. Error Handling

- [ ] Invalid parameters handled gracefully
- [ ] Missing autoShell.exe detected
- [ ] Permission errors reported clearly

---

## 🐛 Debugging Tips

### Check autoShell.exe Output

The C# process outputs debug information. Look for:

```
Received: {"actionName": "...", "parameters": {...}}
```

### Enable Debug Logging

Set environment variable:

```bash
set DEBUG=typeagent:desktop*
```

### Verify Grammar Matching

Use the standalone test script:

```bash
cd ts/packages/agents/desktop
node test-grammar-matching.mjs
```

### Check Compiled Files

Verify these exist:

- `dist/desktopSchema.ag.json` (53KB) - Compiled grammar
- `dist/desktopSchema.pas.json` (37KB) - Parsed action schema
- `../../dotnet/autoShell/bin/Debug/autoShell.exe` (148KB) - C# backend

---

## 📊 Success Criteria

- ✅ All grammar test phrases (32/32) match correctly
- ✅ TypeAgent CLI launches without errors
- ✅ @desktop agent is available and responding
- ✅ At least 10 different actions execute successfully
- ✅ Settings actually change in Windows (verify in Settings app)
- ✅ No crashes or exceptions in autoShell.exe
- ✅ Confirmation messages accurate and helpful

---

## ⚠️ Known Limitations

1. Some actions require **Administrator privileges** (e.g., Bluetooth, WiFi)
2. **WMI-based actions** (brightness) may fail on some hardware
3. Some settings open **dialogs** rather than changing directly (by design)
4. **Windows 11 specific** features may not work on Windows 10

---

## 📝 Test Results Template

After testing, document results:

```markdown
## Test Session: [Date]

**Environment:**

- OS: Windows 11/10
- TypeAgent CLI Version:
- Node Version:

**Results:**

- Network Settings: [ ] Pass [ ] Fail [ ] N/A
- Display Settings: [ ] Pass [ ] Fail [ ] N/A
- Personalization: [ ] Pass [ ] Fail [ ] N/A
- Taskbar: [ ] Pass [ ] Fail [ ] N/A
- Mouse: [ ] Pass [ ] Fail [ ] N/A
- Privacy: [ ] Pass [ ] Fail [ ] N/A
- Power: [ ] Pass [ ] Fail [ ] N/A
- Accessibility: [ ] Pass [ ] Fail [ ] N/A
- File Explorer: [ ] Pass [ ] Fail [ ] N/A

**Issues Found:**

1. [Describe any issues]

**Notes:**
[Additional observations]
```

---

## 🎯 Quick Smoke Test (5 minutes)

Run these 5 commands to verify basic functionality:

```
@desktop set theme to dark
@desktop increase brightness
@desktop center the taskbar
@desktop set mouse speed to 15
@desktop show file extensions
```

If all 5 work, the integration is solid! 🎉
