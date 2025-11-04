# Description: Build all the javascript projects in the repository

#!/bin/bash
source "$(dirname "$0")/build-utils.sh"

# Fetch default tags for tools whose versions the scripts need to know
fetch_tags "git://gcc.gnu.org/git/gcc.git" "setup-program/gcc-tags.json"
fetch_tags "https://github.com/llvm/llvm-project" "setup-program/clang-tags.json"
fetch_tags "https://github.com/Kitware/CMake.git" "setup-program/cmake-tags.json"
generate_ubuntu_versions_json

projects_with_package=()
projects_with_action=()
build_results=()
doc_results=()

print_summary() {
    if [ "${#build_results[@]}" -gt 0 ]; then
        echo "==== ⚙️ Build+Test Summary ===="
        for result in "${build_results[@]}"; do
            echo "$result"
        done
    fi

    if [ "${#doc_results[@]}" -gt 0 ]; then
        echo "==== 📄 Documentation Summary ===="
        for result in "${doc_results[@]}"; do
            echo "$result"
        done
    fi
}

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
            cd "$project_to_build" || exit 1
            echo "==== Building $project_to_build ===="
            if ! npm install; then
                echo "npm install failed for $project_to_build" >&2
                exit 1
            fi
            if ! npm run all; then
                echo "npm run all failed for $project_to_build" >&2
                exit 1
            fi
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
    pids=()
    project_names=()
    for project in "${projects_with_package[@]}"; do
        (
          cd "$project" || exit
          echo "==== Building $project ===="
          if ! npm install; then
              echo "npm install failed for ${project%/}" >&2
              exit 1
          fi
          if ! npm run all; then
              echo "npm run all failed for ${project%/}" >&2
              exit 1
          fi
          cd ..
        ) &
        pids+=($!)
        project_names+=("$project")
    done

    build_failed=0
    for idx in "${!pids[@]}"; do
        pid=${pids[$idx]}
        project=${project_names[$idx]}
        if ! wait "$pid"; then
            build_results+=("❌ Build or tests failed for ${project%/}")
            build_failed=1
        else
            build_results+=("✅ Build and tests succeeded for ${project%/}")
        fi
    done

    if [ "$build_failed" -ne 0 ]; then
        echo "One or more projects failed. See logs above for details." >&2
        print_summary
        exit 1
    fi

    echo "==== Regenerating documentation ===="

    doc_parse_failed=0
    antora_failed=0

    if python docs/parse_actions.py; then
        doc_results+=("✅ Generated pages from YAML")
    else
        echo "❌ Generating pages from YAML failed" >&2
        doc_results+=("❌ Generated pages from YAML")
        doc_parse_failed=1
    fi

    if (
        cd docs || exit 1
        npx antora --fetch --stacktrace local-antora-playbook.yml
    ); then
        doc_results+=("✅ Antora site build succeeded")
    else
        echo "❌ Antora site build failed" >&2
        doc_results+=("❌ Antora site build failed")
        antora_failed=1
    fi

    if [ "$doc_parse_failed" -ne 0 ] || [ "$antora_failed" -ne 0 ]; then
        echo "Documentation tasks failed. See logs above for details." >&2
        print_summary
        exit 1
    fi

    print_summary
fi
