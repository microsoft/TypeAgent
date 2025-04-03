export class Photo {
    private _container: HTMLDivElement;
    private imagePath: string;
    private indexDiv: HTMLDivElement;
    private img: HTMLImageElement;

    constructor(imgPath: string, index: number) {
        this.imagePath = this.imagePath;

        this._container = document.createElement("div");
        this._container.classList.add("imgDiv");
        this._container.setAttribute("path", imgPath);

        // create the image
        this.img = document.createElement("img");
        this.img.src = "/thumbnail?path=" + imgPath;

        // get the image caption
        fetch(`/knowlegeResponse?path=${imgPath}`).then(async (response) => {
            const ii = await response.json();
            this.img.title = ii.fileName + " - " + ii.altText;
        });

        // add the image index
        this.indexDiv = document.createElement("div");
        this.indexDiv.classList.add("indexDiv");
        this.indexDiv.innerText = index.toString();

        // add children to the container
        this._container.append(this.img);
        this._container.append(this.indexDiv);
    }

    public get container() {
        return this._container;
    }

    public updateImageIndex(index: number) {
        this.indexDiv.innerHTML = index.toString();
    }

    public remove() {
        this._container.remove();
    }

    // public select() {
    //     this.img.classList.add("selected");
    // }

    // public unselect() {
    //     this.img.classList.remove("selected");
    // }
}
