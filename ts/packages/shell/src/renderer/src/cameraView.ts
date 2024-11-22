// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    iconAccept,
    iconCamera,
    iconCameraSwap,
    iconCancel,
    iconRefresh,
} from "./icon";

export class CameraView {
    private mainContainer: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private img: HTMLImageElement;
    private video: HTMLVideoElement;
    private width: number = 320;
    private height: number = 0;
    private streaming: boolean = false;
    private mediaStream: MediaStream | undefined = undefined;
    private pictureDiv: HTMLDivElement;
    private snapButton: HTMLButtonElement = document.createElement("button");
    private acceptButton: HTMLButtonElement = document.createElement("button");
    private cancelButton: HTMLButtonElement = document.createElement("button");
    private retryButon: HTMLButtonElement = document.createElement("button");
    private swapCameras: HTMLButtonElement = document.createElement("button");
    private cameraStatus: HTMLDivElement;

    private cameras: MediaDeviceInfo[] = new Array<MediaDeviceInfo>();
    private cameraIndex: number = 0;

    constructor(saveImageCallback: (image: HTMLImageElement) => void) {
        const videoContainer: HTMLDivElement = document.createElement("div");
        this.pictureDiv = document.createElement("div");
        const buttonDiv: HTMLDivElement = document.createElement("div");
        this.canvas = document.createElement("canvas");
        this.video = document.createElement("video");
        this.img = document.createElement("img");
        this.cameraStatus = document.createElement("div");

        this.video.id = "video";
        this.snapButton.id = "snapButton";
        this.canvas.id = "canvas";

        const cameraIcon = iconCamera("white");
        cameraIcon.className = "camera-button-image";
        this.snapButton.append(cameraIcon);
        this.snapButton.className = "camera-button camera-button-grouped";
        this.snapButton.onclick = (e: MouseEvent) => {
            this.takePicture();
            e.preventDefault();

            this.acceptButton.classList.remove("camera-hidden");
            this.snapButton.classList.add("camera-hidden");
            this.swapCameras.classList.add("camera-hidden");
            this.retryButon.classList.remove("camera-hidden");
            this.video.classList.add("camera-hidden");
            this.pictureDiv.classList.remove("camera-hidden");
        };

        const acceptIcon = iconAccept("white");
        acceptIcon.className = "camera-button-image";
        this.acceptButton.append(acceptIcon);
        this.acceptButton.className =
            "camera-button camera-button-grouped camera-hidden";
        this.acceptButton.onclick = () => {
            this.toggleVisibility();

            if (saveImageCallback) {
                saveImageCallback(this.img);
            }
        };

        const closeIcon = iconCancel("white");
        closeIcon.className = "camera-button-image";
        this.cancelButton.append(closeIcon);
        this.cancelButton.className = "camera-button camera-button-grouped";
        this.cancelButton.onclick = () => {
            this.toggleVisibility();
        };

        const retryIcon = iconRefresh("white");
        retryIcon.className = "camera-button-image";
        this.retryButon.append(retryIcon);
        this.retryButon.className =
            "camera-button camera-button-grouped camera-hidden";
        this.retryButon.onclick = () => {
            this.pictureDiv.classList.add("camera-hidden");
            this.acceptButton.classList.add("camera-hidden");
            this.retryButon.classList.add("camera-hidden");
            this.video.classList.remove("camera-hidden");
            this.snapButton.classList.remove("camera-hidden");
            this.swapCameras.classList.remove("camera-hidden");
        };

        const swapCameraIcon = iconCameraSwap("white");
        swapCameraIcon.className = "camera-button-image";
        this.swapCameras.append(swapCameraIcon);
        this.swapCameras.className = "camera-button camera-button-grouped";
        this.swapCameras.onclick = () => {
            this.stopCamera();
            this.cameraIndex++;

            if (this.cameraIndex >= this.cameras.length) {
                this.cameraIndex = 0;
            }

            this.startCamera();
        };

        buttonDiv.className = "camera-buttons";
        buttonDiv.append(this.snapButton);
        buttonDiv.append(this.swapCameras);
        buttonDiv.append(this.acceptButton);
        buttonDiv.append(this.cancelButton);
        buttonDiv.append(this.retryButon);

        this.pictureDiv.className = "picture";

        videoContainer.append(this.video);
        videoContainer.className = "picture";

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

        this.video.onplay = () => {
            this.video.classList.remove("camera-hidden");
        };
        this.video.classList.add("camera-hidden");

        this.cameraStatus.innerText = "Starting camera...";
        this.cameraStatus.classList.add("camera-status");

        this.mainContainer = document.createElement("div");
        this.mainContainer.className = "camera-container camera-hidden";
        this.mainContainer.append(videoContainer);
        this.mainContainer.append(this.pictureDiv);
        this.mainContainer.append(this.canvas);
        this.mainContainer.append(this.cameraStatus);
        this.mainContainer.append(buttonDiv);

        // List cameras and microphones.
        if (navigator.mediaDevices !== undefined) {
            navigator.mediaDevices
                .enumerateDevices()
                .then((devices) => {
                    devices.forEach((device) => {
                        if (device.kind === "videoinput") {
                            console.log(
                                `${device.kind}: ${device.label} id = ${device.deviceId}`,
                            );
                            this.cameras.push(device);
                        }
                    });

                    if (devices.length < 2) {
                        this.swapCameras.classList.add("single-camera");
                    }
                })
                .catch((err) => {
                    console.error(`${err.name}: ${err.message}`);
                });
        } else {
            console.log("No media (camera) devices found");
        }
    }

    // Capture a photo by fetching the current contents of the video
    // and drawing it into a canvas, then converting that to a PNG
    // format data URL. By drawing it on an offscreen canvas and then
    // drawing that to the screen, we can change its size and/or apply
    // other changes before drawing it.
    takePicture() {
        const context: CanvasRenderingContext2D = this.canvas.getContext(
            "2d",
        ) as CanvasRenderingContext2D;
        if (this.width && this.height) {
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            context.drawImage(this.video, 0, 0, this.width, this.height);

            this.canvas.toBlob((b: Blob | null) => {
                if (b) {
                    let url: string = URL.createObjectURL(b);

                    if (this.img) {
                        this.img.remove();
                    }

                    this.img = document.createElement("img");
                    this.img.setAttribute("src", url);
                    this.pictureDiv.append(this.img);
                }
            });
        } else {
            this.clearPhoto();
        }
    }

    clearPhoto() {
        const context: CanvasRenderingContext2D = this.canvas.getContext(
            "2d",
        ) as CanvasRenderingContext2D;
        context.fillStyle = "#AAA";
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const data = this.canvas.toDataURL("image/png");
        this.img.setAttribute("src", data);
        this.img.remove();
    }

    public startCamera() {
        if (navigator.mediaDevices !== undefined) {
            navigator.mediaDevices
                .getUserMedia({
                    video: {
                        deviceId: this.cameras[this.cameraIndex].deviceId,
                    },
                    audio: false,
                })
                .then((stream) => {
                    this.snapButton.classList.remove("camera-hidden");
                    this.swapCameras.classList.remove("camera-hidden");
                    this.cameraStatus.classList.add("camera-hidden");
                    this.mediaStream = stream;
                    this.video.srcObject = stream;
                    this.video.play();
                })
                .catch((err) => {
                    console.error(`An error occurred: ${err}`);
                    this.cameraStatus.innerText = "Error starting camera...";
                    this.cameraStatus.classList.remove("camera-hidden");
                    this.video.classList.add("camera-hidden");
                    this.snapButton.classList.add("camera-hidden");
                });
        }

        this.clearPhoto();
    }

    public stopCamera() {
        if (this.mediaStream) {
            this.mediaStream.getTracks()[0].stop();
        }
    }

    getContainer() {
        return this.mainContainer;
    }

    public toggleVisibility() {
        if (this.getContainer().classList.contains("camera-hidden")) {
            this.getContainer().classList.remove("camera-hidden");
            this.cameraStatus.innerText = "Starting camera...";
            this.cameraStatus.classList.remove("camera-hidden");
            this.pictureDiv.classList.add("camera-hidden");
            this.acceptButton.classList.add("camera-hidden");
            this.retryButon.classList.add("camera-hidden");
            this.canvas.classList.add("camera-hidden");

            this.startCamera();
        } else {
            this.getContainer().classList.add("camera-hidden");
            this.stopCamera();
            this.video.classList.add("camera-hidden");
        }
    }

    public show() {
        if (this.getContainer().classList.contains("camera-hidden")) {
            this.toggleVisibility();
        }
    }

    public hide() {
        if (!this.getContainer().classList.contains("camera-hidden")) {
            this.toggleVisibility();
        }
    }
}
