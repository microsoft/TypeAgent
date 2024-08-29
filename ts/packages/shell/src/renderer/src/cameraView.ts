// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { iconCamera } from "./icon";

export class CameraView {
    private mainContainer: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private img: HTMLImageElement;
    private video: HTMLVideoElement;
    private width: number = 320;
    private height: number = 0;
    private streaming: boolean = false;

    constructor() {
        const videoContainer: HTMLDivElement = document.createElement("div");
        const pictureDiv: HTMLDivElement = document.createElement("div");
        this.canvas = document.createElement("canvas");
        this.video = document.createElement("video");
        const snapButton: HTMLButtonElement = document.createElement("button");
        this.img = document.createElement("img");

        this.video.id = "video";
        snapButton.id = "snapButton";
        this.canvas.id = "canvas";

        snapButton.append(iconCamera());
        snapButton.onclick = (e: MouseEvent) => {
              this.takePicture();
              e.preventDefault();
        };

        pictureDiv.className = "picture"
        pictureDiv.append(this.img);

        videoContainer.className = "camera";
        videoContainer.append(this.video);
        videoContainer.append(snapButton);
        this.video.oncanplay = () => {
            if (!this.streaming) {
                this.height = this.video.videoHeight / (this.video.videoWidth / this.width);
      
                // Firefox currently has a bug where the height can't be read from
                // the video, so we will make assumptions if this happens.
      
                if (isNaN(this.height)) {
                    this.height = this.width / (4 / 3);
                }
      
                this.video.width = this.width;
                this.video.height = this.height;
                this.canvas.width = this.width;
                this.canvas.height = this.height;
                // this.video.setAttribute("width", this.width.toString());
                // this.video.setAttribute("height", this.height.toString());
                // this.canvas.setAttribute("width", this.width.toString());
                // this.canvas.setAttribute("height", this.height.toString());
                this.streaming = true;
              }            
        }

        this.mainContainer = document.createElement("div");
        this.mainContainer.className = "camera-container";
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
          this.video.srcObject = stream;
          this.video.play();
        })
        .catch((err) => {
          console.error(`An error occurred: ${err}`);
        });
  
        this.clearPhoto();
    }

    getContainer() {
        return this.mainContainer;
    }
}