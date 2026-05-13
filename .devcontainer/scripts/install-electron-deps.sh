#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

#
# Install Electron/GUI dependencies for VNC or WSLg environments
#

set -e

echo "Installing Electron dependencies..."

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    libsecret-1-0 \
    fonts-liberation

# Clean up
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*

echo "Electron dependencies installed."
echo ""
echo "For VNC access:"
echo "  - Open http://localhost:6080 in your browser"
echo "  - Password: typeagent"
echo ""
echo "Then run 'pnpm run shell' in the container terminal"
