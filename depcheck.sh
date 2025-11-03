#!/usr/bin/env bash
set -euo pipefail

projects_with_package=()
projects_with_action=()

for dir in */; do
    # Ignore the docs directory
    if [ "$dir" == "docs/" ]; then
        continue
    fi

    if [ -f "${dir}package.json" ]; then
        projects_with_package+=("$dir")
    elif [ -f "${dir}action.yml" ]; then
        projects_with_action+=("$dir")
    fi
done

# Include shared helpers in common/*
while IFS= read -r common_dir; do
    projects_with_package+=("$common_dir")
done < <(find common -mindepth 1 -maxdepth 1 -type d -exec test -f "{}/package.json" \; -printf '%p/\n')

echo "==== Composite actions ===="
if ((${#projects_with_action[@]})); then
    for project in "${projects_with_action[@]}"; do
        echo "$project"
    done
else
    echo "(none)"
fi

echo "Javascript projects:"
for project in "${projects_with_package[@]}"; do
    (
        cd "$project"
        echo "==== Checking dependencies for $project ===="
        npx depcheck
    )
done
