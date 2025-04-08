# Description: Build all the javascript projects in the repository

#!/bin/bash

# Function to fetch tags from a Git repository and save them as a JSON array
fetch_tags() {
    local repo_url=$1
    local output_file=$2

    # Check if git is installed
    if ! command -v git &> /dev/null; then
        echo "fetch_tags(${repo_url}): Error: git is not installed."
        return 1
    fi

    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        echo "fetch_tags(${repo_url}): Error: jq is not installed."
        return 1
    fi

    # Create the output directory if it doesn't exist
    mkdir -p "$(dirname "$output_file")"

    # Fetch tags using git ls-remote and format them as a JSON array
    git ls-remote --tags "$repo_url" | awk '{print $2}' | sed 's|refs/tags/||' | jq -R . | jq -s . > "$output_file"

    if [ $? -ne 0 ]; then
        echo "Error: Failed to fetch or process tags from the repository: $repo_url"
        exit 1
    fi

    echo "Tags have been saved to $output_file."
}

# Fetch default tags for tools whose versions we need to know
fetch_tags "git://gcc.gnu.org/git/gcc.git" "setup-program/gcc-tags.json"
fetch_tags "https://github.com/llvm/llvm-project" "setup-program/clang-tags.json"
fetch_tags "https://github.com/Kitware/CMake.git" "setup-program/cmake-tags.json"

projects_with_package=()
projects_with_action=()

for dir in */; do
    # Ignore the docs directory
    if [ "$dir" == "docs/" ]; then
        continue
    fi

    if [ -f "$dir/package.json" ]; then
        projects_with_package+=("$dir")
    elif [ -f "$dir/action.yml" ]; then
        projects_with_action+=("$dir")
    fi
done

project_to_build=$1

if [ -n "$project_to_build" ]; then
    echo "Building specified project: $project_to_build"
    project_found=false
    for project in "${projects_with_package[@]}"; do
        if [[ $project == "$project_to_build/" ]]; then
            project_found=true
            cd "$project_to_build" || exit
            echo "==== Building $project_to_build ===="
            npm install
            npm run all
            cd ..
            break
        fi
    done
    if [ "$project_found" = false ]; then
        echo "Project $project_to_build not found or does not have a package.json"
        exit 1
    fi
else
    echo "==== Composite actions ===="
    for project in "${projects_with_action[@]}"; do
        echo "$project"
    done

    echo "Javascript projects:"
    for project in "${projects_with_package[@]}"; do
        (
          cd "$project" || exit
          echo "==== Building $project ===="
          npm install
          npm run all
          cd ..
        ) &
    done

    wait
fi
