#!/usr/bin/env bash
# Description: Update dependencies across all JavaScript actions
set -euo pipefail

projects_with_package=()

for dir in */; do
    if [ "$dir" == "docs/" ]; then
        continue
    fi

    if [ -f "${dir}package.json" ]; then
        projects_with_package+=("$dir")
    fi
done

while IFS= read -r common_dir; do
    projects_with_package+=("$common_dir")
done < <(find common -mindepth 1 -maxdepth 1 -type d -exec sh -c 'if [ -f "$1/package.json" ]; then printf "%s/\n" "$1"; fi' _ {} \;)

for project in "${projects_with_package[@]}"; do
    (
        cd "$project"
        echo "==== Updating dependencies for $project ===="
        npx npm-check-updates -u
        npm install
    )
done
