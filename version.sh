#!/usr/bin/env bash
# Description: Set the version of all actions package.json
set -euo pipefail

version=${1:-}
# Validate if the input version was provided
if [ -z "$version" ]; then
    echo "Error: No version provided."
    exit 1
fi

# Validate if the version is in the format of three numbers separated by dots
if ! [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Invalid version format. Expected format is X.Y.Z where X, Y, and Z are numbers."
    exit 1
fi

package_dirs=()

for dir in */; do
    if [ "$dir" == "docs/" ]; then
        continue
    fi
    if [ -f "${dir}package.json" ]; then
        package_dirs+=("$dir")
    fi
done

while IFS= read -r common_dir; do
    package_dirs+=("$common_dir")
done < <(find common -mindepth 1 -maxdepth 1 -type d -exec sh -c 'if [ -f "$1/package.json" ]; then printf "%s/\n" "$1"; fi' _ {} \;)

if ((${#package_dirs[@]} == 0)); then
    echo "No package.json files found. Exiting."
    exit 0
fi

for dir in "${package_dirs[@]}"; do
    (
        cd "$dir"
        echo "==== Updating version in $dir ===="
        current_version=$(node -pe "require('./package.json').version" 2>/dev/null || echo "")
        if [ "$current_version" = "$version" ]; then
            echo "Version already $version; skipping."
            exit 0
        fi
        npm version "$version" --no-git-tag-version
    )
done
