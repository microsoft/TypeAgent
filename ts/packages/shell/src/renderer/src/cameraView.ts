// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { iconAccept, iconCamera, iconCancel } from "./icon";

export class CameraView {
    private mainContainer: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private img: HTMLImageElement;
    private video: HTMLVideoElement;
    private width: number = 320;
    private height: number = 0;
    private streaming: boolean = false;
    private mediaStream: MediaStream | undefined = undefined;

    constructor() {
        const videoContainer: HTMLDivElement = document.createElement("div");
        const pictureDiv: HTMLDivElement = document.createElement("div");
        const buttonDiv: HTMLDivElement = document.createElement("div");
        this.canvas = document.createElement("canvas");
        this.video = document.createElement("video");
        const snapButton: HTMLButtonElement = document.createElement("button");
        const acceptButton: HTMLButtonElement = document.createElement("button");
        const cancelButton: HTMLButtonElement = document.createElement("button");
        this.img = document.createElement("img");

        this.video.id = "video";
        snapButton.id = "snapButton";
        this.canvas.id = "canvas";

        const cameraIcon = iconCamera("white");
        cameraIcon.className = "camera-button-image";
        snapButton.append(cameraIcon);
        snapButton.className = "camera-button camera-button-center"
        snapButton.onclick = (e: MouseEvent) => {
              this.takePicture();
              e.preventDefault();
        };

        const acceptIcon = iconAccept("white");
        acceptIcon.className = "camera-button-image";
        acceptButton.append(acceptIcon);
        acceptButton.className = "camera-button camera-button-grouped";

        const closeIcon = iconCancel("white");
        closeIcon.className = "camera-button-image";
        cancelButton.append(closeIcon);
        cancelButton.className = "camera-button camera-button-grouped";

        buttonDiv.className = "camera-buttons";
        buttonDiv.append(acceptButton);
        buttonDiv.append(cancelButton);

        pictureDiv.className = "picture";        
        pictureDiv.append(this.img);     
        pictureDiv.append(buttonDiv);

        videoContainer.append(this.video);
        videoContainer.append(snapButton);
        this.video.oncanplay = () => {
            if (!this.streaming) {
                this.height = this.video.videoHeight / (this.video.videoWidth / this.width);
            
                this.video.width = this.width;
                this.video.height = this.height;
                this.canvas.width = this.width;
                this.canvas.height = this.height;
                this.streaming = true;
              }            
        }

        this.mainContainer = document.createElement("div");
        this.mainContainer.className = "camera-container camera-hidden";
        this.mainContainer.append(videoContainer);
        this.mainContainer.append(this.canvas);
        this.mainContainer.append(pictureDiv);
    }

    // Capture a photo by fetching the current contents of the video
    // and drawing it into a canvas, then converting that to a PNG
    // format data URL. By drawing it on an offscreen canvas and then
    // drawing that to the screen, we can change its size and/or apply
    // other changes before drawing it.
    takePicture() {
        const context: CanvasRenderingContext2D = this.canvas.getContext("2d") as CanvasRenderingContext2D;
        if (this.width && this.height) {
            this.canvas.width = this.width;
            this.canvas.height = this.height;
          context.drawImage(this.video, 0, 0, this.width, this.height);
    
          const data = this.canvas.toDataURL("image/png");
          this.img.setAttribute("src", data);
        } else {
            this.clearPhoto();
        }
    }

    clearPhoto() {
        const context: CanvasRenderingContext2D = this.canvas.getContext("2d") as CanvasRenderingContext2D;
        context.fillStyle = "#AAA";
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
        const data = this.canvas.toDataURL("image/png");
        this.img.setAttribute("src", data);
    }

    public startCamera() {
        navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .then((stream) => {
            this.mediaStream = stream;
          this.video.srcObject = stream;
          this.video.play();
        })
        .catch((err) => {
          console.error(`An error occurred: ${err}`);
        });
  
        this.clearPhoto();
    }

    public stopCamera() {

        if (this.mediaStream) {
            this.mediaStream.getTracks()[0].stop();
            this.clearPhoto();
        }
    }

    getContainer() {
        return this.mainContainer;
    }
}