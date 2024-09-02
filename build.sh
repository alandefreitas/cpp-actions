# Description: Build all the javascript projects in the repository

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
