#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Install Codex SDD Loop from this checkout into your personal Codex marketplace.

Usage:
  scripts/install-local-plugin.sh [--no-install]

Options:
  --no-install   Only update ~/.agents/plugins/marketplace.json; do not run codex plugin add.
  -h, --help     Show this help message.
EOF
}

run_codex_install=1

for arg in "$@"; do
  case "$arg" in
    --no-install)
      run_codex_install=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "${HOME:-}" ]; then
  echo "HOME is not set; cannot locate the personal Codex marketplace." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to update marketplace.json safely." >&2
  exit 1
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
plugin_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
manifest_path="$plugin_dir/.codex-plugin/plugin.json"
marketplace_path="$HOME/.agents/plugins/marketplace.json"

if [ ! -f "$manifest_path" ]; then
  echo "Missing plugin manifest: $manifest_path" >&2
  exit 1
fi

plugin_name="$(
  python3 - "$manifest_path" "$plugin_dir" <<'PY'
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
plugin_dir = Path(sys.argv[2])

try:
    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
except Exception as exc:
    raise SystemExit(f"Failed to read {manifest_path}: {exc}")

name = manifest.get("name") or plugin_dir.name
print(name)
PY
)"

source_path="$(
  python3 - "$HOME" "$plugin_dir" <<'PY'
import os
import sys

home = os.path.realpath(os.path.expanduser(sys.argv[1]))
plugin_dir = os.path.realpath(sys.argv[2])
rel = os.path.relpath(plugin_dir, home)

if rel == ".":
    raise SystemExit("Plugin directory cannot be the home directory itself.")
if rel == ".." or rel.startswith("../"):
    raise SystemExit(
        "This installer expects the plugin checkout to live under your home directory "
        "so it can create a ./path entry for the personal marketplace."
    )

print("./" + rel)
PY
)"

marketplace_name="$(
  python3 - "$marketplace_path" "$plugin_name" "$source_path" <<'PY'
import json
import sys
from pathlib import Path

marketplace_path = Path(sys.argv[1])
plugin_name = sys.argv[2]
source_path = sys.argv[3]

entry = {
    "name": plugin_name,
    "source": {
        "source": "local",
        "path": source_path,
    },
    "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL",
    },
    "category": "Developer Tools",
}

if marketplace_path.exists():
    try:
        with marketplace_path.open("r", encoding="utf-8") as f:
            marketplace = json.load(f)
    except Exception as exc:
        raise SystemExit(f"Failed to read existing {marketplace_path}: {exc}")
    if not isinstance(marketplace, dict):
        raise SystemExit(f"{marketplace_path} must contain a JSON object.")
else:
    marketplace_path.parent.mkdir(parents=True, exist_ok=True)
    marketplace = {
        "name": "personal",
        "interface": {
            "displayName": "Personal",
        },
        "plugins": [],
    }

marketplace.setdefault("name", "personal")
interface = marketplace.setdefault("interface", {})
if not isinstance(interface, dict):
    raise SystemExit(f"{marketplace_path}: interface must be a JSON object when present.")
interface.setdefault("displayName", "Personal")

plugins = marketplace.setdefault("plugins", [])
if not isinstance(plugins, list):
    raise SystemExit(f"{marketplace_path}: plugins must be a JSON array.")

new_plugins = []
inserted = False
for existing in plugins:
    if isinstance(existing, dict) and existing.get("name") == plugin_name:
        if not inserted:
            new_plugins.append(entry)
            inserted = True
        continue
    new_plugins.append(existing)

if not inserted:
    new_plugins.append(entry)

marketplace["plugins"] = new_plugins

with marketplace_path.open("w", encoding="utf-8") as f:
    json.dump(marketplace, f, indent=2)
    f.write("\n")

print(marketplace["name"])
PY
)"

echo "Updated personal Codex marketplace:"
echo "  $marketplace_path"
echo
echo "Registered plugin:"
echo "  $plugin_name@$marketplace_name"
echo "  $source_path"
echo

if [ "$run_codex_install" -eq 1 ]; then
  if command -v codex >/dev/null 2>&1; then
    echo "Installing plugin with Codex CLI..."
    codex plugin add "$plugin_name@$marketplace_name"
  else
    echo "Codex CLI was not found on PATH. Install the plugin manually with:"
    echo "  codex plugin add $plugin_name@$marketplace_name"
  fi
else
  echo "Skipped Codex CLI install. To install later, run:"
  echo "  codex plugin add $plugin_name@$marketplace_name"
fi

echo
echo "Then restart Codex or start a new Codex thread so the plugin skills and MCP tools load."
