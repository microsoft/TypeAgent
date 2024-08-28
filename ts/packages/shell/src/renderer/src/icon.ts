// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function createSVGElement(path: string, id?: string) {
    const wrapperDiv = document.createElement("i");
    const emptySVG = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
    );
    wrapperDiv.appendChild(emptySVG);
    emptySVG.outerHTML = path;
    if (id !== undefined) {
        const child = wrapperDiv.children[0];
        child.setAttribute("id", id);
    }
    return wrapperDiv;
}

export function iconRoadrunner() {
    const path = `<svg fill="#000000" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24px" height="24px" viewBox="0 0 567.896 567.896" xml:space="preserve">
    <path d="M554.918,215.052c-2.068,0.322-4.12,0.718-6.16,1.175c-2.199,0.49-4.37-0.653-5.847-1.848 c-0.861-0.698-1.938-1.191-3.109-1.371c-2.896-0.449-6.16,0.784-8.936,1.424c-3.965,0.914-7.931,1.832-11.896,2.75 c-11.354,2.624-22.714,5.247-34.072,7.871c-60.73,13.223-122.47,19.984-183.938,28.462c-16.753,2.31-33.203-0.147-48.74-6.703 c-29.499-12.44-59.76-21.208-91.943-23.208c-20.294-1.26-31.583-15.977-39.796-32.093c-0.473-0.931-0.542-2.053-0.343-3.301 c0.29-1.84,1.636-4.431,2.632-5.818c0.6-0.832,1.232-1.648,1.901-2.444c0.184-0.22,0.302-0.465,0.363-0.718 c0.106-0.437,0.661-1.159,1.534-1.31c0.498-0.085,1.032-0.11,1.599-0.069c0.938,0.069,1.469-0.498,1.604-1.187 c0.229-1.196,0.171-2.607,1.338-3.439c0.706-0.502,1.408-1.004,2.113-1.506c0.714-0.51,0.902-1.33,0.702-2.011 c-0.359-1.208-0.804-1.869,0.347-2.746c0.697-0.53,1.391-1.057,2.089-1.587c0.485-0.367,0.75-0.873,0.795-1.375 c0.078-0.897,0.163-1.546,1.146-1.661c0.596-0.069,1.191-0.13,1.791-0.184c1.877-0.163,2.371-2.766,0.453-3.35 c0,0-0.767-0.232-1.718-0.522c-0.946-0.29,0.017-0.571,2.134-0.853c1.269-0.167,2.534-0.4,3.803-0.689 c1.742-0.404,1.514-2.778,0-3.292c-1.122-0.379-2.24-0.755-3.362-1.126c-1.861-0.616-3.419-1.689-3.913-2.093 c-0.265-0.216-0.624-0.343-1.081-0.322c-0.469,0.024-0.938,0.029-1.403,0.012c-0.775-0.024-3.146-0.648-5.3-1.306 c-3.745-1.142-7.507-2.244-11.285-3.296c-0.224-0.061-0.437-0.082-0.628-0.061c-0.347,0.032-2.415-0.196-4.663-0.049 c-0.139,0.008-0.278,0.021-0.417,0.033c-2.244,0.212-5.773,1.065-7.997,1.432c-1.783,0.293-3.574,0.718-5.381,1.301 c-4.088,1.314-7.944,3.309-11.408,5.834c-1.824,1.326-4.733,3.521-6.561,4.839c-7.009,5.051-13.154,11.571-18.433,19.348 c-8.152,12.003-18.185,18.213-32.122,20.494c-10.877,1.783-21.795,4.325-30.045,13.672c-1.489,1.689-0.71,3.02,1.53,2.787 c5.051-0.526,10.102-1.077,15.166-1.485c10.212-0.828,20.433-1.595,30.661-2.17c1.856-0.106,4.133,0.322,5.594,1.367 c10.151,7.283,19.931,15.096,30.245,22.134c7.752,5.292,11.51,12.464,12.893,21.367c0.355,2.285,1.302,4.488,1.542,6.777 c3.289,31.343,22.077,49.548,50.013,61.009c9.314,3.823,17.723,9.849,27.629,15.929c1.922,1.179,2.248,3.439,0.734,5.111 c-5.418,5.985-9.559,10.976-14.37,15.198c-12.938,11.363-26.193,22.375-39.56,33.236c-8.131,6.609-17.168,9.049-27.895,6.201 c-3.154-0.837-6.536-0.804-9.959-0.62c-2.252,0.122-5.854-0.429-8.099-0.249c-1.668,0.135-3.301,0.686-4.77,1.641 c-0.445,0.289-0.461,1.142,0.163,1.248c0.922,0.155,1.844,0.311,2.767,0.461c1.53,0.257,3.533,1.045,4.476,1.759 s0.045,2.056-2.003,2.994c-1.269,0.58-2.509,1.146-3.733,1.706c-2.048,0.934-5.561,1.207-7.769,1.648 c-2.248,0.444-4.223,1.685-5.577,3.517c-1.342,1.812-1.849,4.235-1.457,4.627c0.241,0.236,0.604,0.298,0.889-0.013 c2.171-2.354,5.312-2.477,8.327-2.974c2.224-0.367,5.712-1.354,7.952-1.596c8.107-0.873,16.238-1.648,24.109-3.517 c12.419-2.95,23.741-2.75,35.749,2.501c5.181,2.264,11.028,2.999,17.115,3.729c2.236,0.27,5.708,1.27,7.817,2.064 c2.754,1.037,5.582,1.865,8.482,2.477c0.657,0.139,1.159-0.632,0.665-1.142c-0.473-0.486-0.942-0.976-1.408-1.469 c-0.771-0.816-1.408-1.612-1.493-1.751c-0.049-0.077-0.114-0.146-0.204-0.208c-0.065-0.045-0.135-0.09-0.2-0.131 c-0.114-0.069-0.89-0.844-1.775-1.705c-0.535-0.522-1.082-1.028-1.645-1.514c-0.608-0.526-1.261-0.906-1.942-1.126 c-1.183-0.388-3.19-1.742-4.721-3.398c-6.091-6.61-14.521-7.769-23.766-7.186c-2.249,0.144-4.251-0.277-4.488-1.057 c-0.232-0.779,1.053-2.488,2.873-3.818c11.204-8.201,22.378-16.438,33.644-24.554c10.955-7.891,22.04-15.602,33.036-23.436 c1.053-0.751,1.722-2.126,2.832-2.701c9.519-4.908,40.384,1.783,47.189,10.188c5.426,6.703,10.465,13.745,16.247,20.118 c5.483,6.042,12.036,11.118,17.511,17.169c5.055,5.581,9.637,11.673,13.823,17.939c4.818,7.218,4.794,7.128,14.113,6.638 c1.656-0.085,3.35,0.498,5.055,1.253c2.057,0.918,5.243,2.791,7.43,3.329c2.456,0.604,5.022,0.29,7.602-1.619 c0.293-0.221,0.343-0.556,0.248-0.833c-0.167-0.489-0.767-0.497-0.849-0.53c-0.045-0.017-0.094-0.028-0.146-0.037 c-1.322-0.191-2.644-0.379-3.97-0.566c-2.191-0.314-5.279-1.84-6.896-3.411c-9.266-8.992-18.548-18.005-27.993-27.173 c-1.615-1.57-1.844-4.312-0.493-6.116c2.795-3.729,5.847-7.764,8.698-11.938c1.612-2.358,3.15-4.762,4.651-7.148 c1.195-1.909,3.814-4.288,6.026-4.721c2.321-0.453,4.716-0.408,7.128,0.155c0.22,0.053,0.407,0.004,0.547-0.102 c0.253-0.192,0.583-0.571,0.693-0.869c0.061-0.159,0.045-0.347-0.103-0.539c-0.334-0.433-0.701-0.824-1.093-1.175 c-0.665-0.592-1.363-1.105-1.53-1.204c-0.167-0.098-1.734-0.836-3.615-0.971s-5.182,0.118-7.434,0.151 c-12.815,0.175-17.055,10.954-21.302,21.31c-0.856,2.085-3.296,3.125-5.279,2.057c-7.728-4.17-13.876-11.963-30.375-37.043 c-1.236-1.881-0.784-4.508,0.987-5.903c9.2-7.279,18.001-15.365,28.242-20.686c10.151-5.275,21.771-7.736,33.432-11.18 c2.162-0.636,2.656-2.529,1.122-4.178c-0.416-0.448-0.841-0.905-1.265-1.358c-1.534-1.648-1.682-4.451-0.131-6.088 c13.333-14.117,31.946-12.75,49.389-14.268c18.474-1.611,35.794-6.65,53.378-12.378c7.577-2.468,15.337-4.374,23.167-6.059 c20.607-3.562,41.216-7.124,61.824-10.686c2.219-0.383,5.817-1.008,8.041-1.391c12.049-2.081,24.097-4.166,36.149-6.247 c3.357-0.579,9.139-2.428,8.755-6.985c-0.073-0.857-0.313-1.648-0.685-2.333c-0.649-1.188-1.678-1.865-1.73-1.955 s0.828-0.437,1.971-0.824c0.689-0.232,1.371-0.477,2.053-0.738c3.464-1.155,6.874-2.46,10.24-3.868 c1.922-0.804,5.528-1.925,6.088-4.382C569.3,211.686,558.357,214.513,554.918,215.052z"/></svg>`;
    return createSVGElement(path);
}

export function iconLightbulb() {
    const path = `<svg width="24px" height="24px" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M18,2.25a11,11,0,0,0-11,11,10.68,10.68,0,0,0,1,4.63,16.36,16.36,0,0,0,1.12,1.78,17,17,0,0,1,2,3.47,16.19,16.19,0,0,1,.59,4h2A18.17,18.17,0,0,0,13,22.44a18.46,18.46,0,0,0-2.22-3.92,15.79,15.79,0,0,1-1-1.54A8.64,8.64,0,0,1,9,13.23a9,9,0,0,1,18.07,0A8.64,8.64,0,0,1,26.21,17a15.79,15.79,0,0,1-1,1.54A18.46,18.46,0,0,0,23,22.44a18.17,18.17,0,0,0-.71,4.71h2a16.19,16.19,0,0,1,.59-4,17,17,0,0,1,2-3.47A16.31,16.31,0,0,0,28,17.86a10.68,10.68,0,0,0,1-4.63A11,11,0,0,0,18,2.25Z" ></path><path d="M18.63,15.51a.8.8,0,0,0-1.13,0l-3,3,2.86,3.13v5.54H19V21l-2.24-2.45,1.89-1.89A.8.8,0,0,0,18.63,15.51Z"></path><path d="M23.86,29.15H12.11a.8.8,0,1,0,0,1.6H23.86a.8.8,0,0,0,0-1.6Z" ></path><path d="M22,32.15H14a.8.8,0,1,0,0,1.6H22a.8.8,0,1,0,0-1.6Z"></path><path d="M17.32,10.89l-2.73,2.73a.8.8,0,0,0,1.13,1.13L18.45,12a.8.8,0,1,0-1.13-1.13Z"></path>
    </svg>`;
    return createSVGElement(path);
}

export function iconHome() {
    const path = `<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"></path>
</svg>`;

    return createSVGElement(path);
}

export function iconCog() {
    const path = `<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"></path>
  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
</svg>`;
    return createSVGElement(path);
}

export function iconLogout() {
    const path = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
</svg>`;
    return createSVGElement(path);
}

export function iconChevronRight() {
    const path = `<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"></path>
</svg>`;
    return createSVGElement(path);
}

export function iconMicrophone() {
    const path = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <title>Click for speech recognition (Alt+M).</title>
  <path d="M8.5 10.5C9.16304 10.5 9.79893 10.2366 10.2678 9.76777C10.7366 9.29893 11 8.66304 11 8V3.5C11 2.83696 10.7366 2.20107 10.2678 1.73223C9.79893 1.26339 9.16304 1 8.5 1C7.83696 1 7.20107 1.26339 6.73223 1.73223C6.26339 2.20107 6 2.83696 6 3.5V8C6 8.66304 6.26339 9.29893 6.73223 9.76777C7.20107 10.2366 7.83696 10.5 8.5 10.5ZM7 3.5C7 3.10218 7.15804 2.72064 7.43934 2.43934C7.72064 2.15804 8.10218 2 8.5 2C8.89782 2 9.27936 2.15804 9.56066 2.43934C9.84196 2.72064 10 3.10218 10 3.5V8C10 8.39782 9.84196 8.77936 9.56066 9.06066C9.27936 9.34196 8.89782 9.5 8.5 9.5C8.10218 9.5 7.72064 9.34196 7.43934 9.06066C7.15804 8.77936 7 8.39782 7 8V3.5ZM9 12.472V14H11V15H6V14H8V12.472C6.89998 12.349 5.88387 11.8249 5.14594 10.9999C4.40801 10.1749 4.00003 9.10688 4 8H5C5 8.92826 5.36875 9.8185 6.02513 10.4749C6.6815 11.1313 7.57174 11.5 8.5 11.5C9.42826 11.5 10.3185 11.1313 10.9749 10.4749C11.6313 9.8185 12 8.92826 12 8H13C13 9.10688 12.592 10.1749 11.8541 10.9999C11.1161 11.8249 10.1 12.349 9 12.472V12.472Z" fill="#1F1F1F" />
</svg>`;
    return createSVGElement(path);
}

export function iconMicrophoneDisabled() {
    const path = `<svg viewBox="0 0 16 16" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <title>Speech recogintion disabled. Have you configured speech API access?</title>
  <g clip-path="url(#clip0_820_90505)">
    <path opacity="0.1" d="M12 8.5C12.6922 8.5 13.3689 8.70527 13.9445 9.08986C14.5201 9.47444 14.9687 10.0211 15.2336 10.6606C15.4985 11.3001 15.5678 12.0039 15.4327 12.6828C15.2977 13.3618 14.9644 13.9854 14.4749 14.4749C13.9854 14.9644 13.3618 15.2977 12.6828 15.4327C12.0039 15.5678 11.3001 15.4985 10.6606 15.2336C10.0211 14.9687 9.47444 14.5201 9.08986 13.9445C8.70527 13.3689 8.5 12.6922 8.5 12C8.5 11.0717 8.86875 10.1815 9.52513 9.52513C10.1815 8.86875 11.0717 8.5 12 8.5V8.5Z" fill="#C50F1F" />
    <path d="M12 8C11.2089 8 10.4355 8.2346 9.77772 8.67412C9.11992 9.11365 8.60723 9.73836 8.30448 10.4693C8.00173 11.2002 7.92252 12.0044 8.07686 12.7804C8.2312 13.5563 8.61216 14.269 9.17157 14.8284C9.73098 15.3878 10.4437 15.7688 11.2196 15.9231C11.9956 16.0775 12.7998 15.9983 13.5307 15.6955C14.2616 15.3928 14.8864 14.8801 15.3259 14.2223C15.7654 13.5645 16 12.7911 16 12C16 10.9391 15.5786 9.92172 14.8284 9.17157C14.0783 8.42143 13.0609 8 12 8V8ZM15 12C14.9994 12.6221 14.8035 13.2282 14.44 13.733L10.267 9.56C10.7718 9.19645 11.3779 9.00057 12 9C12.7956 9 13.5587 9.31607 14.1213 9.87868C14.6839 10.4413 15 11.2044 15 12ZM9 12C9.00057 11.3779 9.19645 10.7718 9.56 10.267L13.733 14.44C13.2282 14.8035 12.6221 14.9994 12 15C11.2044 15 10.4413 14.6839 9.87868 14.1213C9.31607 13.5587 9 12.7956 9 12Z" fill="#C50F1F" />
    <path d="M7.424 14H6V12.472C6.34949 12.429 6.69259 12.3444 7.022 12.22C7.022 12.146 7 12.075 7 12C7.00273 11.6978 7.03319 11.3966 7.091 11.1C6.55965 11.3795 5.96495 11.5164 5.3649 11.4976C4.76484 11.4788 4.1799 11.3047 3.66713 10.9925C3.15436 10.6803 2.73126 10.2405 2.43908 9.71602C2.1469 9.19156 1.99563 8.60034 2 8H1C1.00003 9.10688 1.40801 10.1749 2.14594 10.9999C2.88387 11.8249 3.89998 12.349 5 12.472V14H3V15H8V14.969C7.77209 14.6687 7.57886 14.3437 7.424 14V14Z" fill="#1F1F1F" />
    <path d="M5.5 10.5C6.16304 10.5 6.79893 10.2366 7.26777 9.76777C7.73661 9.29893 8 8.66304 8 8V3.5C8 2.83696 7.73661 2.20107 7.26777 1.73223C6.79893 1.26339 6.16304 1 5.5 1C4.83696 1 4.20107 1.26339 3.73223 1.73223C3.26339 2.20107 3 2.83696 3 3.5V8C3 8.66304 3.26339 9.29893 3.73223 9.76777C4.20107 10.2366 4.83696 10.5 5.5 10.5ZM4 3.5C4 3.10218 4.15804 2.72064 4.43934 2.43934C4.72064 2.15804 5.10218 2 5.5 2C5.89782 2 6.27936 2.15804 6.56066 2.43934C6.84196 2.72064 7 3.10218 7 3.5V8C7 8.39782 6.84196 8.77936 6.56066 9.06066C6.27936 9.34196 5.89782 9.5 5.5 9.5C5.10218 9.5 4.72064 9.34196 4.43934 9.06066C4.15804 8.77936 4 8.39782 4 8V3.5Z" fill="#1F1F1F" />
  </g>
  <defs>
    <clipPath id="clip0_820_90505">
      <rect width="16" height="16" fill="white" />
    </clipPath>
  </defs>
</svg>`;
    return createSVGElement(path);
}

export function iconMicrophoneListening() {
    const path = `<svg viewBox="0 0 16 16" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <title>Speech recognition in progress.</title>
  <g opacity="0.75">
    <path d="M12.411 2.663C12.7958 3.23817 13.0008 3.91487 12.9997 4.60691C12.9986 5.29896 12.7916 5.97502 12.405 6.549L11.68 5.8C11.8931 5.42924 12.0036 5.00841 12 4.58079C11.9965 4.15317 11.8792 3.73421 11.66 3.367L12.411 2.663ZM3.859 1.977L3.122 1.285C2.38337 2.25157 1.98855 3.43706 2.00014 4.6535C2.01173 5.86993 2.42908 7.04768 3.186 8L3.9 7.268C3.32316 6.50858 3.00747 5.58294 3.00008 4.62931C2.99269 3.67569 3.294 2.74526 3.859 1.977V1.977ZM4.589 2.667C4.20605 3.24199 4.00264 3.91783 4.0046 4.60867C4.00656 5.29951 4.2138 5.97419 4.6 6.547L5.32 5.8C5.10691 5.42924 4.99644 5.00841 4.99995 4.58079C5.00347 4.15317 5.12084 3.73421 5.34 3.367L4.589 2.667ZM13.878 1.285H13.873L13.136 1.977C13.7004 2.74517 14.0016 3.67509 13.9948 4.62831C13.988 5.58152 13.6734 6.50702 13.098 7.267L13.814 8C14.5709 7.04768 14.9883 5.86993 14.9999 4.6535C15.0115 3.43706 14.6166 2.25157 13.878 1.285V1.285Z" fill="#1F1F1F" />
  </g>
  <path d="M8.5 10.5C9.16304 10.5 9.79893 10.2366 10.2678 9.76777C10.7366 9.29893 11 8.66304 11 8V3.5C11 2.83696 10.7366 2.20107 10.2678 1.73223C9.79893 1.26339 9.16304 1 8.5 1C7.83696 1 7.20107 1.26339 6.73223 1.73223C6.26339 2.20107 6 2.83696 6 3.5V8C6 8.66304 6.26339 9.29893 6.73223 9.76777C7.20107 10.2366 7.83696 10.5 8.5 10.5ZM7 3.5C7 3.10218 7.15804 2.72064 7.43934 2.43934C7.72064 2.15804 8.10218 2 8.5 2C8.89782 2 9.27936 2.15804 9.56066 2.43934C9.84196 2.72064 10 3.10218 10 3.5V8C10 8.39782 9.84196 8.77936 9.56066 9.06066C9.27936 9.34196 8.89782 9.5 8.5 9.5C8.10218 9.5 7.72064 9.34196 7.43934 9.06066C7.15804 8.77936 7 8.39782 7 8V3.5ZM9 12.472V14H11V15H6V14H8V12.472C6.89998 12.349 5.88387 11.8249 5.14594 10.9999C4.40801 10.1749 4.00003 9.10688 4 8H5C5 8.92826 5.36875 9.8185 6.02513 10.4749C6.6815 11.1313 7.57174 11.5 8.5 11.5C9.42826 11.5 10.3185 11.1313 10.9749 10.4749C11.6313 9.8185 12 8.92826 12 8H13C13 9.10688 12.592 10.1749 11.8541 10.9999C11.1161 11.8249 10.1 12.349 9 12.472V12.472Z" fill="#1F1F1F" />
</svg>`;
    return createSVGElement(path);
}

export function iconCheckMarkCircle() {
    const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
`;
    return createSVGElement(path);
}

export function iconX() {
    const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    return createSVGElement(path);
}

export function iconMinus() {
    const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-minus"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    return createSVGElement(path);
}

export function iconSquare() {
    const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-square"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
    return createSVGElement(path);
}

export function iconAlertTriangle() {
    const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-alert-triangle"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    return createSVGElement(path);
}

export function iconSettings() {
    const path = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path opacity="0.1" d="M14.5 9V7L12 6.5L11.889 6.232L13.3 4.111L11.889 2.7L9.768 4.111L9.5 4L9 1.5H7L6.5 4L6.232 4.111L4.111 2.7L2.7 4.111L4.111 6.232L4 6.5L1.5 7V9L4 9.5L4.111 9.768L2.7 11.889L4.111 13.3L6.232 11.886L6.5 12L7 14.5H9L9.5 12L9.768 11.889L11.889 13.3L13.3 11.889L11.889 9.768L12 9.5L14.5 9ZM8 11C7.40666 11 6.82664 10.8241 6.33329 10.4944C5.83994 10.1648 5.45542 9.69623 5.22836 9.14805C5.0013 8.59987 4.94189 7.99667 5.05764 7.41473C5.1734 6.83279 5.45912 6.29824 5.87868 5.87868C6.29824 5.45912 6.83279 5.1734 7.41473 5.05764C7.99667 4.94189 8.59987 5.0013 9.14805 5.22836C9.69623 5.45542 10.1648 5.83994 10.4944 6.33329C10.8241 6.82664 11 7.40666 11 8C11 8.79565 10.6839 9.55871 10.1213 10.1213C9.55871 10.6839 8.79565 11 8 11Z" fill="#FFFFFF" />
            <path d="M8 11C7.40666 11 6.82664 10.8241 6.33329 10.4944C5.83994 10.1648 5.45543 9.69623 5.22836 9.14805C5.0013 8.59987 4.94189 7.99667 5.05765 7.41473C5.1734 6.83279 5.45912 6.29824 5.87868 5.87868C6.29824 5.45912 6.83279 5.1734 7.41473 5.05765C7.99667 4.94189 8.59987 5.0013 9.14805 5.22836C9.69623 5.45543 10.1648 5.83994 10.4944 6.33329C10.8241 6.82664 11 7.40666 11 8C11 8.79565 10.6839 9.55871 10.1213 10.1213C9.55871 10.6839 8.79565 11 8 11ZM8 6C7.60444 6 7.21776 6.1173 6.88886 6.33706C6.55996 6.55682 6.30362 6.86918 6.15224 7.23463C6.00087 7.60009 5.96126 8.00222 6.03843 8.39018C6.1156 8.77814 6.30608 9.13451 6.58579 9.41421C6.86549 9.69392 7.22186 9.8844 7.60982 9.96157C7.99778 10.0387 8.39992 9.99914 8.76537 9.84776C9.13082 9.69638 9.44318 9.44004 9.66294 9.11114C9.8827 8.78224 10 8.39556 10 8C10 7.46957 9.78929 6.96086 9.41421 6.58579C9.03914 6.21071 8.53043 6 8 6V6Z" fill="#FFFFFF" />
            <path d="M15 6.59L12.574 6.105L13.947 4.048L11.952 2.053L9.9 3.426L9.41 1H6.59L6.105 3.426L4.048 2.053L2.053 4.053L3.426 6.105L1 6.59V9.41L3.426 9.9L2.053 11.952L4.053 13.947L6.11 12.574L6.59 15H9.41L9.9 12.574L11.957 13.947L13.952 11.952L12.574 9.9L15 9.41V6.59ZM14 8.59L11.641 9.062L11.324 9.822L12.66 11.822L11.825 12.657L9.825 11.321L9.065 11.638L8.59 14H7.41L6.938 11.641L6.178 11.324L4.178 12.66L3.343 11.825L4.679 9.825L4.362 9.065L2 8.59V7.41L4.359 6.938L4.676 6.178L3.34 4.178L4.175 3.343L6.175 4.679L6.935 4.362L7.41 2H8.59L9.062 4.359L9.822 4.676L11.822 3.34L12.657 4.175L11.321 6.175L11.638 6.935L14 7.41V8.59Z" fill="#FFFFFF" />
          </svg> `;

    return createSVGElement(path);
}

export function iconMetrics() {
    const path = `          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path opacity="0.1" d="M14.5 12.5H1.5V2.5H14.5V12.5Z" fill="#FFFFFF" />
            <path d="M14.1 6.439V7.853L11.6 5.353L7.95 9H7.243L5.6 7.353L1.95 11L1.243 10.293L5.243 6.293H5.95L7.6 7.939L11.246 4.292H11.953L14.1 6.439Z" fill="#FFFFFF" />
            <path d="M14.5 2H1.5L1 2.5V12.5L1.5 13H14.5L15 12.5V2.5L14.5 2ZM14 12H2V3H14V12Z" fill="#FFFFFF" />
          </svg>`;
    return createSVGElement(path);
}

export function iconHelp() {
    const path = `          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.608 3.538C8.18802 3.5401 8.74374 3.77117 9.15425 4.18093C9.56476 4.59069 9.79684 5.14599 9.8 5.726C9.8 6.78 9.1 7.226 8.505 7.841C8.3191 8.01518 8.18 8.23333 8.10049 8.47535C8.02098 8.71737 8.00362 8.97551 8.05 9.226H7.17C7.13277 8.83681 7.17704 8.44413 7.3 8.073C7.47001 7.6879 7.72465 7.34609 8.045 7.073C8.33572 6.83724 8.58747 6.55713 8.791 6.243C8.86566 6.08626 8.90751 5.91592 8.914 5.74242C8.9205 5.56893 8.89149 5.39594 8.82875 5.23406C8.76602 5.07217 8.67089 4.9248 8.54919 4.80099C8.42749 4.67717 8.28178 4.57951 8.121 4.514C7.92131 4.43048 7.70409 4.39759 7.48863 4.41824C7.27317 4.4389 7.06614 4.51245 6.88596 4.63238C6.70577 4.75231 6.558 4.91489 6.45577 5.10568C6.35355 5.29647 6.30004 5.50955 6.3 5.726H5.42C5.42185 5.14627 5.65296 4.59082 6.06289 4.18089C6.47282 3.77096 7.02827 3.53985 7.608 3.538V3.538ZM7.608 10.507C7.45966 10.507 7.31466 10.551 7.19132 10.6334C7.06799 10.7158 6.97186 10.8329 6.91509 10.97C6.85832 11.107 6.84347 11.2578 6.87241 11.4033C6.90135 11.5488 6.97278 11.6824 7.07767 11.7873C7.18256 11.8922 7.3162 11.9637 7.46168 11.9926C7.60717 12.0215 7.75797 12.0067 7.89501 11.9499C8.03206 11.8931 8.14919 11.797 8.2316 11.6737C8.31401 11.5503 8.358 11.4053 8.358 11.257C8.358 11.0581 8.27898 10.8673 8.13833 10.7267C7.99768 10.586 7.80691 10.507 7.608 10.507V10.507Z" fill="#FFFFFF" />
            <g opacity="0.75">
              <path opacity="0.1" d="M13.5 13.5H1.5V1.5H13.5V13.5Z" fill="#FFFFFF" />
              <path d="M13.5 14H1.5L1 13.5V1.5L1.5 1H13.5L14 1.5V13.5L13.5 14ZM2 13H13V2H2V13Z" fill="#FFFFFF" />
            </g>
          </svg>`;
    return createSVGElement(path);
}

export function iconImage() {
  const path = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path opacity="0.1" d="M14.5 2.5V14.5H1.5V2.5H14.5Z" fill="#1F1F1F" />
  <path d="M14.5 2H1.5L1 2.5V14.5L1.5 15H14.5L15 14.5V2.5L14.5 2ZM14 14H2V3H14V14Z" fill="#1F1F1F" />
  <path d="M12 5.5C12 5.79667 11.912 6.08668 11.7472 6.33336C11.5824 6.58003 11.3481 6.77229 11.074 6.88582C10.7999 6.99935 10.4983 7.02906 10.2074 6.97118C9.91639 6.9133 9.64912 6.77044 9.43934 6.56066C9.22956 6.35088 9.0867 6.08361 9.02882 5.79264C8.97094 5.50166 9.00065 5.20006 9.11418 4.92597C9.22771 4.65189 9.41997 4.41762 9.66665 4.2528C9.91332 4.08797 10.2033 4 10.5 4C10.8978 4 11.2794 4.15804 11.5607 4.43934C11.842 4.72064 12 5.10218 12 5.5Z" fill="#B27D00" />
  <path d="M14 11.09V12.5L11.181 9.68L8.988 11.877H8.281L4.814 8.41L2 11.225V9.811L4.461 7.35H5.168L8.634 10.816L10.827 8.623H11.534L14 11.09Z" fill="#006CBE" />
</svg>`;

  return createSVGElement(path);
}

export function iconCamera() {
  const path = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10.707 3H14.5l.5.5v9l-.5.5h-13l-.5-.5v-9l.5-.5h3.793l.853-.854L6.5 2h3l.354.146.853.854zM2 12h12V4h-3.5l-.354-.146L9.293 3H6.707l-.853.854L5.5 4H2v8zm1.5-7a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0-1a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
</svg>`;
  return createSVGElement(path);
}

export function iconOpenFile() {
  const path = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g opacity="0.75">
    <path opacity="0.1" d="M13.5 5.5V14.5H3.5V5.914L3.854 6.268L6.854 3.268V2L7.854 2.5H10.5L13.5 5.5Z" fill="#1F1F1F" />
    <path d="M14 5.5V14.5L13.5 15H3.5L3 14.5V5.414L3.854 6.268L4 6.122V14H13V6H10V3H6.854V2H10.5L10.854 2.146L13.854 5.146L14 5.5Z" fill="#1F1F1F" />
  </g>
  <path d="M5.854 2V2.707L3.854 4.707L3.147 4L4.293 2.854H3C2.46957 2.854 1.96086 3.06471 1.58579 3.43979C1.21071 3.81486 1 4.32357 1 4.854V5.854H0V4.854C0 4.05835 0.31607 3.29529 0.87868 2.73268C1.44129 2.17007 2.20435 1.854 3 1.854H4.293L3.147 0.707L3.854 0L5.854 2Z" fill="#006CBE" />
</svg>`;
return createSVGElement(path);
}
