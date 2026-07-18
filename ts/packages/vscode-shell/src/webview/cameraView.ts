// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * In-webview camera capture overlay for the VS Code shell, mirroring the
 * Electron shell's CameraView (packages/shell/src/renderer/src/cameraView.ts).
 * getUserMedia works inside the VS Code webview - the Azure speech mic path
 * relies on it too - so the same live-preview + snapshot flow applies here.
 *
 * The overlay is a full-screen scrim with a <video> live preview and a row of
 * codicon buttons: snap, swap-camera, accept, retry, cancel. On accept it
 * hands a base64 PNG data URL to the result callback; the ChatPanel adds it as
 * a message attachment (the dispatcher parses attachments as data URLs, so a
 * data: URL is required - a blob: URL has no `;base64,` segment and fails to
 * parse). On cancel it reports `undefined`.
 */
export class CameraView {
    private readonly mainContainer: HTMLDivElement;
    private readonly videoContainer: HTMLDivElement;
    private readonly pictureDiv: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly video: HTMLVideoElement;
    private readonly cameraStatus: HTMLDivElement;
    private img: HTMLImageElement;

    private readonly snapButton = document.createElement("button");
    private readonly acceptButton = document.createElement("button");
    private readonly cancelButton = document.createElement("button");
    private readonly retryButton = document.createElement("button");
    private readonly swapButton = document.createElement("button");

    private width = 320;
    private height = 0;
    private streaming = false;
    private mediaStream?: MediaStream;
    private cameras: MediaDeviceInfo[] = [];
    private cameraIndex = 0;

    /**
     * @param onResult Called once per capture session: with the captured
     *   image's base64 data URL on accept, or `undefined` on cancel. The
     *   overlay hides itself before invoking the callback.
     */
    constructor(
        private readonly onResult: (dataUrl: string | undefined) => void,
    ) {
        this.videoContainer = document.createElement("div");
        this.pictureDiv = document.createElement("div");
        this.canvas = document.createElement("canvas");
        this.video = document.createElement("video");
        this.cameraStatus = document.createElement("div");
        this.img = document.createElement("img");

        this.video.id = "video";
        this.canvas.id = "canvas";

        // Snap: freeze the current frame and offer accept / retry.
        this.configureButton(this.snapButton, "device-camera", "Take picture");
        this.snapButton.onclick = (e) => {
            e.preventDefault();
            this.takePicture();
            this.acceptButton.classList.remove("camera-hidden");
            this.retryButton.classList.remove("camera-hidden");
            this.snapButton.classList.add("camera-hidden");
            this.swapButton.classList.add("camera-hidden");
            this.video.classList.add("camera-hidden");
            this.pictureDiv.classList.remove("camera-hidden");
        };

        // Swap: cycle to the next available camera.
        this.configureButton(this.swapButton, "arrow-swap", "Switch camera");
        this.swapButton.onclick = () => {
            this.stopCamera();
            this.cameraIndex = (this.cameraIndex + 1) % this.cameras.length;
            this.startCamera();
        };

        // Accept: hand the captured image back and close.
        this.configureButton(this.acceptButton, "check", "Use picture");
        this.acceptButton.classList.add("camera-hidden");
        this.acceptButton.onclick = () => {
            const dataUrl = this.img.src;
            this.hide();
            this.onResult(dataUrl);
        };

        // Retry: discard the frozen frame and resume the live preview.
        this.configureButton(this.retryButton, "refresh", "Retake");
        this.retryButton.classList.add("camera-hidden");
        this.retryButton.onclick = () => {
            this.pictureDiv.classList.add("camera-hidden");
            this.acceptButton.classList.add("camera-hidden");
            this.retryButton.classList.add("camera-hidden");
            this.video.classList.remove("camera-hidden");
            this.snapButton.classList.remove("camera-hidden");
            this.swapButton.classList.remove("camera-hidden");
        };

        // Cancel: close without capturing.
        this.configureButton(this.cancelButton, "close", "Cancel");
        this.cancelButton.onclick = () => {
            this.hide();
            this.onResult(undefined);
        };

        const buttonDiv = document.createElement("div");
        buttonDiv.className = "camera-buttons";
        buttonDiv.append(
            this.snapButton,
            this.swapButton,
            this.acceptButton,
            this.retryButton,
            this.cancelButton,
        );

        this.video.oncanplay = () => {
            if (!this.streaming) {
                this.height =
                    this.video.videoHeight /
                    (this.video.videoWidth / this.width);
                this.video.width = this.width;
                this.video.height = this.height;
                this.canvas.width = this.width;
                this.canvas.height = this.height;
                this.streaming = true;
            }
        };
        this.video.onplay = () => this.video.classList.remove("camera-hidden");
        this.video.classList.add("camera-hidden");

        this.cameraStatus.className = "camera-status";
        this.cameraStatus.innerText = "Starting camera...";

        this.videoContainer.className = "picture";
        this.videoContainer.append(this.video);
        this.pictureDiv.className = "picture camera-hidden";

        this.mainContainer = document.createElement("div");
        this.mainContainer.className = "camera-container camera-hidden";
        this.mainContainer.append(
            this.videoContainer,
            this.pictureDiv,
            this.canvas,
            this.cameraStatus,
            buttonDiv,
        );
    }

    /** Root overlay element - append it to the document once at startup. */
    public getContainer(): HTMLDivElement {
        return this.mainContainer;
    }

    /** Open the overlay and begin streaming from the current camera. */
    public show(): void {
        if (!this.mainContainer.classList.contains("camera-hidden")) {
            return;
        }
        this.mainContainer.classList.remove("camera-hidden");
        // Reset to the live-preview state (in case a prior session ended on
        // the frozen-frame view).
        this.pictureDiv.classList.add("camera-hidden");
        this.acceptButton.classList.add("camera-hidden");
        this.retryButton.classList.add("camera-hidden");
        this.snapButton.classList.remove("camera-hidden");
        this.cameraStatus.classList.remove("camera-hidden");
        this.startCamera();
    }

    /** Close the overlay and stop the camera. */
    public hide(): void {
        if (this.mainContainer.classList.contains("camera-hidden")) {
            return;
        }
        this.mainContainer.classList.add("camera-hidden");
        this.stopCamera();
        this.video.classList.add("camera-hidden");
    }

    private configureButton(
        button: HTMLButtonElement,
        codicon: string,
        title: string,
    ): void {
        button.className = "camera-button camera-button-grouped";
        button.title = title;
        button.innerHTML = `<span class="codicon codicon-${codicon}"></span>`;
    }

    // Draw the current video frame onto an offscreen canvas and convert it to
    // a base64 PNG data URL (see the class comment for why data: is required).
    private takePicture(): void {
        const context = this.canvas.getContext("2d");
        if (context === null || !this.width || !this.height) {
            return;
        }
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        context.drawImage(this.video, 0, 0, this.width, this.height);
        const url = this.canvas.toDataURL("image/png");

        this.img.remove();
        this.img = document.createElement("img");
        this.img.src = url;
        this.pictureDiv.append(this.img);
    }

    private startCamera(): void {
        if (navigator.mediaDevices?.getUserMedia === undefined) {
            this.cameraStatus.innerText = "Camera not available";
            this.cameraStatus.classList.remove("camera-hidden");
            return;
        }
        const device = this.cameras[this.cameraIndex];
        const video: MediaTrackConstraints | boolean = device?.deviceId
            ? { deviceId: { exact: device.deviceId } }
            : true;
        navigator.mediaDevices
            .getUserMedia({ video, audio: false })
            .then((stream) => {
                this.snapButton.classList.remove("camera-hidden");
                this.swapButton.classList.remove("camera-hidden");
                this.cameraStatus.classList.add("camera-hidden");
                this.mediaStream = stream;
                this.video.srcObject = stream;
                void this.video.play();
                // Permission is granted now, so device labels/ids are
                // populated; (re)enumerate to reflect the real camera count.
                this.refreshCameras();
            })
            .catch((err: unknown) => {
                const name = err instanceof Error ? err.name : "Error";
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `Camera getUserMedia failed: ${name}: ${message}`,
                    err,
                );
                // A NotAllowedError whose message mentions permission/policy
                // means the VS Code webview iframe does not delegate the
                // `camera` Permissions-Policy feature (its `allow` attribute
                // lists only autoplay/clipboard/etc.). getUserMedia can never
                // succeed there - an extension cannot change that attribute.
                const blockedByPolicy =
                    name === "NotAllowedError" &&
                    /permission|policy|disallow/i.test(message);
                this.cameraStatus.innerText = blockedByPolicy
                    ? "Camera is blocked in the VS Code webview"
                    : `Unable to start camera (${name})`;
                this.cameraStatus.classList.remove("camera-hidden");
                this.video.classList.add("camera-hidden");
                this.snapButton.classList.add("camera-hidden");
                this.swapButton.classList.add("camera-hidden");
            });
    }

    private stopCamera(): void {
        this.mediaStream?.getTracks().forEach((track) => track.stop());
        this.mediaStream = undefined;
        this.video.srcObject = null;
    }

    // Populate the camera list and hide the swap button when fewer than two
    // cameras are present. Best-effort: labels/ids are only meaningful after
    // camera permission has been granted.
    private refreshCameras(): void {
        navigator.mediaDevices
            ?.enumerateDevices()
            .then((devices) => {
                this.cameras = devices.filter((d) => d.kind === "videoinput");
                this.swapButton.classList.toggle(
                    "single-camera",
                    this.cameras.length < 2,
                );
            })
            .catch(() => {
                // best effort - swap simply stays as-is
            });
    }
}
