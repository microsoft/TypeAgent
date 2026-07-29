FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY

# Pre-install system libraries so post-create.sh doesn't need to apt-get install
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    libsecret-1-0 \
    libsecret-1-dev \
    && rm -rf /var/lib/apt/lists/*
