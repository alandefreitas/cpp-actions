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

echo "==== Composite actions ===="
for project in "${projects_with_action[@]}"; do
    echo "$project"
done

echo "Javascript projects:"
for project in "${projects_with_package[@]}"; do
    cd "$project" || exit
    echo "==== Checking dependencies for $project ===="
    npx depcheck
    cd ..
done
