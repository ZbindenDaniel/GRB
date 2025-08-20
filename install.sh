#!/usr/bin/env bash
set -euo pipefail

# Install Podman if not present
if ! command -v podman >/dev/null 2>&1; then
  echo "Installing podman..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y podman
  else
    echo "apt-get not found. Please install podman manually." >&2
    exit 1
  fi
fi

# Install podman-compose if not present
if ! command -v podman-compose >/dev/null 2>&1; then
  echo "Installing podman-compose..."
  if command -v pip >/dev/null 2>&1; then
    pip install --user podman-compose
    export PATH="$PATH:$HOME/.local/bin"
  else
    echo "pip not found. Installing python3-pip..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y python3-pip
      pip install --user podman-compose
      export PATH="$PATH:$HOME/.local/bin"
    else
      echo "Neither pip nor apt-get available to install podman-compose" >&2
      exit 1
    fi
  fi
fi

# Install Python dependencies
if [ -f requirements.txt ]; then
  echo "Installing Python dependencies from requirements.txt..."
  pip install -r requirements.txt
fi

echo "Installation finished."
