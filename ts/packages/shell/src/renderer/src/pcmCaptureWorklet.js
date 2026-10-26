// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

class PcmCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.samples = new Float32Array(1600);
        this.offset = 0;
        this.recording = true;
        this.port.onmessage = ({ data }) => {
            if (data === "finish") {
                this.recording = false;
                this.flush();
                this.port.postMessage({ type: "flushed" });
            }
        };
    }

    flush() {
        if (!this.offset) return;
        const pcm = new Uint8Array(this.offset * 2);
        const view = new DataView(pcm.buffer);
        let energy = 0;
        for (let i = 0; i < this.offset; i++) {
            const sample = Math.max(-1, Math.min(1, this.samples[i]));
            energy += sample * sample;
            view.setInt16(
                i * 2,
                Math.round(sample * (sample < 0 ? 32768 : 32767)),
                true,
            );
        }
        this.port.postMessage(
            {
                type: "audio",
                pcm,
                rms: Math.sqrt(energy / this.offset),
            },
            [pcm.buffer],
        );
        this.offset = 0;
    }

    process(inputs) {
        const channels = inputs[0];
        if (!this.recording || !channels?.length) return true;
        for (let i = 0; i < channels[0].length; i++) {
            let mono = 0;
            for (const channel of channels) mono += channel[i];
            this.samples[this.offset++] = mono / channels.length;
            if (this.offset === this.samples.length) this.flush();
        }
        return true;
    }
}

registerProcessor("typeagent-pcm-capture", PcmCaptureProcessor);
