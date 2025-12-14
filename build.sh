#!/bin/bash
# Description: Build all JavaScript/TypeScript projects in the repository
# TypeScript projects: tsc compiles to JS first, then ncc bundles to dist/
# Uses npm workspaces for dependency management
source "$(dirname "$0")/build-utils.sh"

# Fetch default tags for tools whose versions the scripts need to know
fetch_tags "git://gcc.gnu.org/git/gcc.git" "setup-program/gcc-tags.json"
fetch_tags "https://github.com/llvm/llvm-project" "setup-program/clang-tags.json"
fetch_tags "https://github.com/Kitware/CMake.git" "setup-program/cmake-tags.json"
generate_ubuntu_versions_json

projects_with_package=()
projects_with_action=()
prepare_results=()
test_results=()
lint_results=()
doc_results=()

run_prepare() {
    local project="$1"
    local project_name="${project%/}"

    echo "==== Building (npm run prepare) for $project_name ===="
    if ! npm run prepare -w "$project_name"; then
        echo "npm run prepare failed for $project_name" >&2
        echo "Re-run locally: npm run prepare -w \"$project_name\"" >&2
        return 20
    fi

    return 0
}

run_tests() {
    local project="$1"
    local project_name="${project%/}"
    local display_name
    # Extract display name (last component of path for common modules)
    if [[ "$project_name" == common/* ]]; then
        display_name="${project_name##*/}"
    else
        display_name="$project_name"
    fi

    echo "==== Testing (jest --selectProjects) for $project_name ===="
    if ! npx jest --selectProjects "$display_name"; then
        echo "jest failed for $project_name" >&2
        echo "Re-run locally: npx jest --selectProjects \"$display_name\"" >&2
        return 30
    fi

    return 0
}

run_jsdoc_lint() {
    echo "==== Linting JSDoc documentation ===="
    if ! node utils/jsdoc-linter/dist/index.js; then
        echo "JSDoc linting failed" >&2
        echo "Re-run locally: npm run lint:jsdoc" >&2
        return 40
    fi

    return 0
}

format_prepare_failure() {
    local project_name="$1"
    local status_code="$2"

    case "$status_code" in
        20)
            echo "❌ $project_name: build failed (rerun: npm run prepare -w \"$project_name\")"
            ;;
        *)
            echo "❌ $project_name: unknown prepare failure (status $status_code)"
            ;;
    esac
}

format_test_failure() {
    local project_name="$1"
    local status_code="$2"
    local display_name
    if [[ "$project_name" == common/* ]]; then
        display_name="${project_name##*/}"
    else
        display_name="$project_name"
    fi

    case "$status_code" in
        30)
            echo "❌ $project_name: tests failed (rerun: npx jest --selectProjects \"$display_name\")"
            ;;
        *)
            echo "❌ $project_name: unknown test failure (status $status_code)"
            ;;
    esac
}

print_summary() {
    if [ "${#prepare_results[@]}" -gt 0 ]; then
        echo "==== ⚙️ Prepare Summary ===="
        for result in "${prepare_results[@]}"; do
            echo "$result"
        done
    fi

    if [ "${#test_results[@]}" -gt 0 ]; then
        echo "==== 🧪 Test Summary ===="
        for result in "${test_results[@]}"; do
            echo "$result"
        done
    fi

    if [ "${#lint_results[@]}" -gt 0 ]; then
        echo "==== 📝 JSDoc Lint Summary ===="
        for result in "${lint_results[@]}"; do
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

# Find projects in root directory
for dir in */; do
    # Ignore the docs directory
    if [ "$dir" == "docs/" ]; then
        continue
    fi

    if [ -f "$dir/package.json" ]; then
        projects_with_package+=("${dir%/}")
    elif [ -f "$dir/action.yml" ]; then
        projects_with_action+=("${dir%/}")
    fi
done

# Find shared library projects in common/ directory
for dir in common/*/; do
    if [ -f "$dir/package.json" ]; then
        projects_with_package+=("${dir%/}")
    fi
done

project_to_build=${1%/}

if [ -n "$project_to_build" ]; then
    echo "Building specified project: $project_to_build"
    project_found=false
    for project in "${projects_with_package[@]}"; do
        if [[ $project == "$project_to_build" ]]; then
            project_found=true
            echo "==== Building $project_to_build (prepare stage) ===="
            if ! run_prepare "$project_to_build"; then
                status_code=$?
                format_prepare_failure "$project_to_build" "$status_code" >&2
                exit 1
            fi

            echo "==== Testing $project_to_build (test stage) ===="
            if ! run_tests "$project_to_build"; then
                status_code=$?
                format_test_failure "$project_to_build" "$status_code" >&2
                exit 1
            fi

            echo "==== Linting JSDoc for $project_to_build ===="
            if ! node utils/jsdoc-linter/dist/index.js --workspace "$project_to_build"; then
                echo "JSDoc linting failed for $project_to_build" >&2
                echo "Re-run locally: npm run lint:jsdoc -- --workspace \"$project_to_build\"" >&2
                exit 1
            fi
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

    echo "==== Installing dependencies (npm workspaces) ===="
    if ! npm install; then
        echo "npm install failed" >&2
        exit 1
    fi

    echo "JavaScript/TypeScript projects:"
    pids=()
    project_names=()
    prepare_failed=0
    for project in "${projects_with_package[@]}"; do
        (
          echo "==== Building $project (prepare stage) ===="
          run_prepare "$project"
          exit $?
        ) &
        pids+=($!)
        project_names+=("$project")
    done

    for idx in "${!pids[@]}"; do
        pid=${pids[$idx]}
        project=${project_names[$idx]}
        if ! wait "$pid"; then
            status_code=$?
            prepare_results+=("$(format_prepare_failure "$project" "$status_code")")
            prepare_failed=1
        else
            prepare_results+=("✅ ${project%/}: prepare succeeded")
        fi
    done

    if [ "$prepare_failed" -ne 0 ]; then
        echo "One or more projects failed during prepare. Tests skipped." >&2
        print_summary
        exit 1
    fi

    echo "==== Generating Boost dependency data ===="
    generate_boost_deps

    echo "==== Testing projects ===="
    test_pids=()
    test_project_names=()
    test_failed=0
    for project in "${projects_with_package[@]}"; do
        (
          run_tests "$project"
          exit $?
        ) &
        test_pids+=($!)
        test_project_names+=("$project")
    done

    for idx in "${!test_pids[@]}"; do
        pid=${test_pids[$idx]}
        project=${test_project_names[$idx]}
        if ! wait "$pid"; then
            status_code=$?
            test_results+=("$(format_test_failure "$project" "$status_code")")
            test_failed=1
        else
            test_results+=("✅ ${project%/}: tests succeeded")
        fi
    done

    if [ "$test_failed" -ne 0 ]; then
        echo "One or more projects failed during tests." >&2
        print_summary
        exit 1
    fi

    echo "==== Linting JSDoc documentation ===="
    lint_failed=0
    if run_jsdoc_lint; then
        lint_results+=("✅ JSDoc linting passed")
    else
        lint_results+=("❌ JSDoc linting failed (rerun: npm run lint:jsdoc)")
        lint_failed=1
    fi

    if [ "$lint_failed" -ne 0 ]; then
        echo "JSDoc linting failed. Fix documentation before proceeding." >&2
        print_summary
        exit 1
    fi

    echo "==== Regenerating documentation ===="

    doc_parse_failed=0
    antora_failed=0

    docs_python_target="docs/.pydeps"
    docs_pythonpath="$docs_python_target${PYTHONPATH:+:$PYTHONPATH}"

    # Detect whether PyYAML is already available (either globally or in docs/.pydeps)
    if PYTHONPATH="$docs_pythonpath" python - <<'PY' >/dev/null 2>&1
import sys
try:
    import yaml
except ModuleNotFoundError:
    sys.exit(1)
PY
    then
        doc_results+=("✅ Docs Python requirements already satisfied")
    else
        # Install docs-only Python deps into docs/.pydeps to avoid touching the global site-packages
        if python -m pip install --no-cache-dir --upgrade --target "$docs_python_target" -r docs/requirements.txt >/dev/null; then
            doc_results+=("✅ Installed docs Python requirements")
        else
            echo "❌ Installing docs Python requirements failed" >&2
            doc_results+=("❌ Installed docs Python requirements")
            doc_parse_failed=1
        fi
    fi

    if [ "$doc_parse_failed" -eq 0 ]; then
        # Generate the Antora source pages with the vendored dependencies available via PYTHONPATH
        if PYTHONPATH="$docs_pythonpath" python docs/parse_actions.py; then
            doc_results+=("✅ Generated pages from YAML")
        else
            echo "❌ Generating pages from YAML failed" >&2
            doc_results+=("❌ Generated pages from YAML")
            doc_parse_failed=1
        fi
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
