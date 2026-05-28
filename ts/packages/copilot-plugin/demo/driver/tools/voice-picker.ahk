; Copyright (c) Microsoft Corporation.
; Licensed under the MIT License.
;
; voice-picker.ahk — interactively preview the SAPI voices installed on
; this machine. Pick the one you want for the demo, copy its exact name,
; and use it as the value of @voice or --voice.
;
; Tested with the Windows 11 "Natural" voices (Microsoft Aria Natural,
; Jenny Natural, Guy Natural), the legacy SAPI 5 voices (David, Zira),
; and any additional voices installed via the Speech control panel.

#Requires AutoHotkey v2.0
#SingleInstance Force

global SAPI := ComObject("SAPI.SpVoice")
global VOICES := []
global SAMPLE_TEXT := "Hi, I'm going to show you our personal agent. The thing that makes this agent different is persistent memory across the whole day."

PopulateVoices()
ShowGui()

PopulateVoices() {
    list := SAPI.GetVoices()
    Loop list.Count {
        v := list.Item(A_Index - 1)
        VOICES.Push({
            obj: v,
            desc: v.GetDescription(),
            index: A_Index - 1
        })
    }
}

ShowGui() {
    g := Gui("+Resize", "demo-driver — voice picker")
    g.SetFont("s10", "Segoe UI")
    g.MarginX := 12
    g.MarginY := 12

    g.AddText("w620", "Installed SAPI voices on this machine:")
    lv := g.AddListView("vList w620 h280 -Multi", ["#", "Voice description"])
    for _, v in VOICES
        lv.Add(, v.index, v.desc)
    lv.ModifyCol(1, 40)
    lv.ModifyCol(2, 560)

    g.AddText("xm w620 y+12", "Sample text:")
    g.AddEdit("vSample w620 r3", SAMPLE_TEXT)
    g.AddSlider("vRate w620 Range-5-5 ToolTip", 0)
    g.AddText("xm w620 y+8", "Rate: -5 (slow) … 0 (normal) … +5 (fast)")

    play := g.AddButton("xm w100", "Play")
    stop := g.AddButton("x+8 w100", "Stop")
    copy := g.AddButton("x+8 w160", "Copy name to clipboard")
    quit := g.AddButton("x+8 w100", "Close")

    play.OnEvent("Click", (*) => PlaySelected(g, lv))
    stop.OnEvent("Click", (*) => StopSpeech())
    copy.OnEvent("Click", (*) => CopySelectedName(g, lv))
    quit.OnEvent("Click", (*) => ExitApp())
    g.OnEvent("Close", (*) => ExitApp())

    if VOICES.Length > 0
        lv.Modify(1, "Select Focus")

    g.Show()
}

PlaySelected(g, lv) {
    row := lv.GetNext()
    if row = 0
        return
    v := VOICES[row]
    SAPI.Voice := v.obj
    SAPI.Rate := g["Rate"].Value
    StopSpeech()
    SAPI.Speak(g["Sample"].Value, 1)  ; async
}

StopSpeech() {
    try SAPI.Speak("", 2)  ; purge
}

CopySelectedName(g, lv) {
    row := lv.GetNext()
    if row = 0
        return
    A_Clipboard := VOICES[row].desc
    ToolTip "Copied: " VOICES[row].desc
    SetTimer () => ToolTip(), -1500
}
