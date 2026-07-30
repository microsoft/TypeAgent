FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY

# Rename the default `vscode` user/group to match the host username when
# USERNAME is passed as a build arg (used by the agent devcontainer variant).
# Defaults to "vscode" (the existing user) so this is a no-op for all other
# variants that don't pass USERNAME.
ARG USERNAME=vscode
RUN if [ "$USERNAME" != "vscode" ] && [ -n "$USERNAME" ]; then \
    usermod  -l "$USERNAME" vscode && \
    groupmod -n "$USERNAME" vscode && \
    usermod  -d "/home/$USERNAME" -m "$USERNAME"; \
    fi

# Pre-install system libraries so post-create.sh doesn't need to apt-get install
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    libsecret-1-0 \
    libsecret-1-dev \
    && rm -rf /var/lib/apt/lists/*
