# Description: Set the version of all actions package.json

version=$1
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

common_packages=()

# ./common subdirectory
for dir in common/*/; do
    if [ -f "$dir/package.json" ]; then
        common_packages+=("$dir")
    fi
done

echo "==== Composite actions ===="
for project in "${projects_with_action[@]}"; do
    echo "$project"
done

echo "Javascript projects:"
for project in "${projects_with_package[@]}"; do
    cd "$project" || exit
    echo "==== Building $project ===="
    npm version "$version" --no-git-tag-version
    cd ..
done

echo "Javascript projects:"
for common_package in "${common_packages[@]}"; do
    cd "$common_package" || exit
    echo "==== Building $common_package ===="
    npm version "$version" --no-git-tag-version
    cd ../..
done

