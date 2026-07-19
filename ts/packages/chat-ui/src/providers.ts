// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Optional, host-supplied capability providers for ChatPanel.
 *
 * chat-ui itself stays free of platform dependencies (Electron, Azure,
 * native file pickers, audio libraries). When a host supplies one of these
 * providers via ChatPanelOptions, ChatPanel renders the matching input-bar
 * affordance (mic / attach / camera button, voice banner, etc.) and routes
 * UI events to the provider. Hosts that omit a provider get no regression —
 * the corresponding affordance simply isn't rendered.
 */

/** Visual/behavioral state of the speech recognition affordance. */
export type SpeechState =
    | "idle"
    | "listening"
    | "disabled"
    | "always-on"
    | "wake-word";

/**
 * Speech-to-text capability. The host owns the actual recognizer (Azure
 * Speech, local Whisper, browser SpeechRecognition, etc.); ChatPanel only
 * renders the mic button (reflecting getState()/onStateChange) and a
 * "listening" banner, and inserts recognized text into the input via the
 * onResult callback it registers.
 */
export interface SpeechInputProvider {
    /** Current state, used for the initial mic-button icon. */
    getState(): SpeechState;
    /** Begin a single-shot recognition (mic-button click). */
    start(): void;
    /** Stop any in-progress recognition. */
    stop(): void;
    /**
     * Toggle continuous ("always listening") mode, optionally gating on a
     * wake word before transcribing.
     */
    setContinuous(on: boolean, waitForWakeWord?: boolean): void;
    /**
     * Register the sink for recognized text. `final` is false for interim
     * (partial) hypotheses and true for the committed utterance.
     */
    onResult(cb: (text: string, final: boolean) => void): void;
    /** Register the sink for state changes (drives mic icon + voice banner). */
    onStateChange(cb: (state: SpeechState) => void): void;
}

/** Timing metrics returned by a TTS provider's speak(). */
export interface TtsMetrics {
    firstChunkTime?: number;
    duration: number;
}

/**
 * Text-to-speech capability. When supplied, ChatPanel speaks agent
 * "block" messages as they arrive. The host owns provider selection
 * (browser / Azure / local) and voice configuration.
 */
export interface TtsProvider {
    /** Whether TTS is currently enabled (host-controlled toggle). */
    isEnabled(): boolean;
    /**
     * Speak `text`. `onAudioStart` fires when the first audio chunk plays
     * (used to align UI/metrics). Resolves with timing metrics, or
     * undefined if nothing was spoken.
     */
    speak(
        text: string,
        onAudioStart?: () => void,
    ): Promise<TtsMetrics | undefined>;
    /** Stop any in-progress speech. */
    stop(): void;
}

/**
 * Image input capability. The attach-file button always renders (falling back
 * to a web-native file input); supplying `pickFile` overrides that with a
 * host-native picker. The camera button renders only when `openCamera` is
 * present. Both hooks are independent and optional. Both return base64 data
 * URLs added to the next message's attachments.
 */
export interface ImageCaptureProvider {
    /**
     * Optional host-native file picker returning the selected image(s) as
     * base64 data URLs, or undefined if cancelled. When omitted, ChatPanel
     * uses a built-in web-native `<input type="file">` for the attach button.
     */
    pickFile?(): Promise<string[] | undefined>;
    /**
     * Optional in-app camera capture returning a single base64 data URL,
     * or undefined if cancelled.
     */
    openCamera?(): Promise<string | undefined>;
}

/** One selectable option in an `addChoicePrompt` dialog. */
export interface ChoiceOption<T = unknown> {
    /** Visible button label. */
    label: string;
    /** Value resolved when this option is chosen. */
    value: T;
    /** Keyboard accelerators that select this option, e.g. ["y", "Y"]. */
    keys?: string[];
    /** Optional leading icon element. */
    icon?: HTMLElement;
}

/** A single configurable field in the settings popup. */
export interface SettingsField {
    id: string;
    label: string;
    type: "select" | "toggle" | "text";
    /** Current value. */
    value: string | boolean;
    /**
     * For "select" fields: async loader for the available options. Called
     * lazily when the popup opens (e.g. enumerate mic devices / TTS voices).
     */
    getOptions?: () => Promise<{ label: string; value: string }[]>;
    /** Fired when the user changes the value. */
    onChange: (value: string | boolean) => void;
}

/** One titled group of settings fields. */
export interface SettingsSection {
    title: string;
    fields?: SettingsField[];
    /**
     * Escape hatch: bespoke DOM the schema can't express (rendered after
     * any `fields`). Hosts own the element's behavior and styling.
     */
    customContent?: HTMLElement;
}

/** Descriptor for the data-driven settings popup. */
export interface SettingsPanelSchema {
    sections: SettingsSection[];
}

/** Content for the help popup — either raw HTML or structured sections. */
export type HelpPanelContent =
    | { html: string }
    | { sections: { title: string; html: string }[] };
