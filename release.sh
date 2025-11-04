#!/bin/bash

set -euo pipefail

export GIT_PAGER=cat
export PAGER=cat
export LESS=-F

ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
ORIG_COMMIT=""
if [ "$ORIG_BRANCH" = "HEAD" ]; then
    ORIG_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
fi
AUTO_STASHES=()
RESTORE_COMPLETED=0
ORIG_UNTRACKED=()
while IFS=$'\0' read -r -d '' path; do
    ORIG_UNTRACKED+=("$path")
done < <(git ls-files --others --exclude-standard -z 2>/dev/null || printf '')

restore_workspace() {
    local restore_messages=()

    if [ -n "$ORIG_BRANCH" ] && [ "$ORIG_BRANCH" != "HEAD" ]; then
        local current_branch
        current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
        if [ -n "$current_branch" ] && [ "$current_branch" != "$ORIG_BRANCH" ]; then
            if git checkout "$ORIG_BRANCH" >/dev/null 2>&1; then
                restore_messages+=("Returned to original branch $ORIG_BRANCH.")
            else
                echo "Warning: failed to return to branch $ORIG_BRANCH. Current branch: $current_branch."
            fi
        fi
    elif [ -n "$ORIG_COMMIT" ]; then
        local current_ref
        current_ref=$(git rev-parse HEAD 2>/dev/null || echo "")
        if [ -n "$current_ref" ] && [ "$current_ref" != "$ORIG_COMMIT" ]; then
            if git checkout --detach "$ORIG_COMMIT" >/dev/null 2>&1; then
                restore_messages+=("Returned to detached HEAD at $ORIG_COMMIT.")
            else
                echo "Warning: failed to return to original commit $ORIG_COMMIT."
            fi
        fi
    fi

    for (( idx=${#AUTO_STASHES[@]}-1; idx>=0; idx-- )); do
        local stash_ref=${AUTO_STASHES[idx]}
        if [ -n "$stash_ref" ]; then
            if git stash pop "$stash_ref" >/dev/null 2>&1; then
                restore_messages+=("Restored auto-stash $stash_ref.")
            else
                echo "Warning: failed to restore auto-stash $stash_ref. Run 'git stash pop $stash_ref' manually."
            fi
        fi
    done

    if [ ${#ORIG_UNTRACKED[@]} -gt 0 ]; then
        for path in "${ORIG_UNTRACKED[@]}"; do
            git reset --quiet HEAD -- "$path" >/dev/null 2>&1 || true
            if git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
                git update-index --force-remove -- "$path" >/dev/null 2>&1 || true
            fi
        done
    fi

    if [ ${#restore_messages[@]} -gt 0 ]; then
        printf '%s\n' "${restore_messages[@]}"
    fi

    RESTORE_COMPLETED=1
}

cleanup_release_context() {
    local exit_code=$?
    set +e

    if [ "$RESTORE_COMPLETED" -ne 1 ]; then
        restore_workspace
    fi

    exit $exit_code
}
trap cleanup_release_context EXIT

ask_consent() {
    local explanation=$1
    shift
    local command=("$@")
    echo "About to run: ${command[*]}"
    echo "Purpose: $explanation"
    read -r -p "Proceed? (y/n): " consent
    if [ "$consent" != "y" ]; then
        echo "Aborting at user request."
        exit 1
    fi
    "${command[@]}"
}

require_clean_worktree() {
    local hint=${1:-"Please stash or commit them before continuing."}
    local status
    status=$(git status --porcelain --untracked-files=no)
    if [ -n "$status" ]; then
        echo "Working tree has tracked changes."
        echo "$hint"
        echo "Affected files:"
        echo "$status"
        exit 1
    fi
}


ensure_checkout_safe() {
    local target=$1

    if ! git rev-parse --verify "$target" >/dev/null 2>&1; then
        echo "Unable to verify target ref $target. Ensure the branch exists locally."
        exit 1
    fi

    local tracked_blockers
    tracked_blockers=$(git status --porcelain --untracked-files=no)
    if [ -n "$tracked_blockers" ]; then
        echo "Tracked changes detected that would block switching to $target."
        echo "Tracked files (showing up to 20):"
        printf '%s\n' "$tracked_blockers" | head -n 20 | sed 's/^/  - /'
        if [ "$(printf '%s\n' "$tracked_blockers" | wc -l | tr -d ' ')" -gt 20 ]; then
            echo "  - ... (additional files omitted)"
        fi
        echo "Clean or stash the tracked changes before continuing."
        exit 1
    fi

    local untracked_blockers=()
    while IFS= read -r -d '' path; do
        untracked_blockers+=("$path")
    done < <(git ls-files --others --exclude-standard -z)

    if [ ${#untracked_blockers[@]} -eq 0 ]; then
        return 0
    fi

    echo "Checkout preview detected untracked files that could be overwritten when switching to $target."
    echo "Affected untracked files (showing up to 20):"
    local idx=0
    for path in "${untracked_blockers[@]}"; do
        idx=$((idx + 1))
        if [ $idx -le 20 ]; then
            echo "  - $path"
        fi
    done
    if [ $idx -gt 20 ]; then
        echo "  - ... ($idx total files)"
    fi

    local stash_choice
    while true; do
        read -r -p "Auto-stash these untracked files and continue? (y/n): " stash_choice
        case "$stash_choice" in
            y|Y) break ;;
            n|N)
                echo "Aborting at user request; resolve untracked files before rerunning."
                exit 1
                ;;
            "") echo "Please answer y or n." ;;
            *) echo "Invalid selection. Enter y or n." ;;
        esac
    done

    echo "Auto-stashing untracked files before retrying checkout."
    local stash_marker
    stash_marker="$(date +%s)-$$-$RANDOM"
    local stash_message="release.sh:auto-stash:$target:$stash_marker"
    if git stash push --include-untracked --message "$stash_message" >/dev/null 2>&1; then
        local stash_ref
        stash_ref=$(git stash list | awk -F: -v msg="$stash_message" '$0 ~ msg {print $1; exit}')
        if [ -n "$stash_ref" ]; then
            AUTO_STASHES+=("$stash_ref")
        else
            echo "Warning: auto-stashed files recorded but stash reference could not be determined."
        fi
        echo "Untracked files stashed temporarily; they will be restored after release.sh completes."
        ensure_checkout_safe "$target"
        return
    else
        echo "Failed to auto-stash untracked files. Resolve them manually and rerun the script."
        exit 1
    fi
}


# Step 1: Get the first argument from the command line
echo "==== Read Tag ===="
TAG=${1:-}

# Step 2: If the argument is not provided, get the most recent tag from origin and bump the patch number
if [ -z "$TAG" ]; then
    echo "==== Determine tag ===="
    LATEST_TAG=$(git ls-remote --tags origin | grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' | sort -V | tail -n 1)
    if [ -z "$LATEST_TAG" ]; then
        echo "No existing tags found on origin. Defaulting to initial release tag v0.1.0."
        read -r -p "Enter desired tag (press enter to accept v0.1.0): " TAG
        TAG=${TAG:-v0.1.0}
    else
        IFS='.' read -r -a VERSION_PARTS <<< "${LATEST_TAG:1}"
        MAJOR=${VERSION_PARTS[0]}
        MINOR=${VERSION_PARTS[1]}
        PATCH=${VERSION_PARTS[2]}
        PATCH_SUGGESTED=$((PATCH + 1))
        MINOR_SUGGESTED=$((MINOR + 1))

        FEAT_COMMITS_RAW=$(git log --format=%s "$LATEST_TAG"..HEAD | grep -E '^feat(\(|:)' || true)
        if [ -n "$FEAT_COMMITS_RAW" ]; then
            echo "Feature commits since $LATEST_TAG:"
            while IFS= read -r COMMIT_MSG; do
                [ -z "$COMMIT_MSG" ] && continue
                echo "  - $COMMIT_MSG"
            done <<< "$FEAT_COMMITS_RAW"
            MINOR_TAG="v${MAJOR}.${MINOR_SUGGESTED}.0"
            PATCH_TAG="v${MAJOR}.${MINOR}.${PATCH_SUGGESTED}"
            echo "Suggested tags:"
            echo "  1) Minor bump (includes these features): $MINOR_TAG"
            echo "  2) Patch bump: $PATCH_TAG"
            echo "  3) Enter custom tag"
            while true; do
                read -r -p "Selection [1-3, default 2]: " TAG_CHOICE
                case "$TAG_CHOICE" in
                    ""|"2")
                        TAG=$PATCH_TAG
                        echo "Using patch bump: $TAG"
                        break
                        ;;
                    "1")
                        TAG=$MINOR_TAG
                        echo "Using minor bump: $TAG"
                        break
                        ;;
                    "3")
                        read -r -p "Enter custom tag (vX.Y.Z): " TAG
                        if [ -n "$TAG" ]; then
                            break
                        fi
                        echo "Custom tag cannot be empty."
                        ;;
                    *)
                        echo "Invalid selection. Enter 1, 2, or 3."
                        ;;
                esac
            done
        else
            TAG="v${MAJOR}.${MINOR}.${PATCH_SUGGESTED}"
            read -r -p "Suggested tag is $TAG (no feature commits detected). Is this appropriate? (y/n): " CONFIRM
            if [ "$CONFIRM" != "y" ]; then
                read -r -p "Please enter the desired tag: " TAG
            fi
        fi
    fi
fi

# Step 3: Check if the tag value is a `v` followed by a semver string
echo "==== Validate tag ===="
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Invalid tag format. Exiting."
    exit 1
fi
VERSION=${TAG#v}

require_clean_worktree "Resolve tracked changes before starting the release (common causes: leftover ./version.sh runs or generated dist files)."

# Step 4: Run dependency audit, update dependencies, update versions, and rebuild bundles
echo "==== Update versions ===="
ask_consent "Update package.json versions to $VERSION across all actions." bash ./version.sh "$VERSION"
require_clean_worktree "Version update introduced tracked changes. Review and commit or stash them before continuing."

echo "==== Rebuild bundles ===="
ask_consent "Regenerate dist outputs so release $TAG contains fresh builds." bash ./build.sh
require_clean_worktree "Build step introduced tracked changes. Review and commit or stash them before continuing."

echo "==== Dependency audit ===="
ask_consent "Run depcheck across all actions to verify dependency health." bash ./depcheck.sh
require_clean_worktree "Depcheck introduced tracked changes. Review and commit or stash them before continuing."

echo "==== Dependency updates ===="
ask_consent "Run update-dependencies to refresh package versions before release." bash ./update-dependencies.sh
require_clean_worktree "Dependency updates introduced tracked changes. Review and commit or stash them before continuing."

# Step 4: Check out the develop branch locally and check if it matches the remote
echo "==== Develop matches remote ===="
ask_consent "Fetch latest refs from origin to ensure develop is up to date before tagging." git fetch origin
LOCAL_DEVELOP=$(git rev-parse refs/heads/develop)
REMOTE_DEVELOP=$(git rev-parse origin/develop)
if [ "$LOCAL_DEVELOP" != "$REMOTE_DEVELOP" ]; then
    echo "Local develop branch is not up to date with remote. "
    echo "Local develop:  $LOCAL_DEVELOP."
    git log -1 --pretty=format:"%s" refs/heads/develop
    echo "\n"
    echo "Remote develop: $REMOTE_DEVELOP."
    git log -1 --pretty=format:"%s" origin/develop
    echo "Exiting"
    exit 1
fi

# Step 5: Check out the master branch locally and check if it matches the remote develop
echo "==== Master matches develop ===="
LOCAL_MASTER=$(git rev-parse refs/heads/master 2>/dev/null || echo "")
if [ -z "$LOCAL_MASTER" ]; then
    echo "Local master branch not found; fetch or create it before running the release."
    exit 1
fi

if [ "$LOCAL_MASTER" != "$REMOTE_DEVELOP" ]; then
    ensure_checkout_safe master
    ask_consent "Check out the master branch locally to prepare for release tagging." git checkout master
    require_clean_worktree "Checkout left tracked changes (frequently produced by post-checkout hooks). Clean them up before continuing."

    LOCAL_MASTER=$(git rev-parse refs/heads/master)
    echo "Local master branch is not up to date with remote develop."
    echo "Local master:   $LOCAL_MASTER."
    git log -1 --pretty=format:"%s" refs/heads/master
    printf "\n"
    echo "Remote develop: $REMOTE_DEVELOP."
    git log -1 --pretty=format:"%s" origin/develop
    printf "\nCommits on remote develop not in local master:\n"
    git log refs/heads/master..origin/develop
    read -r -p "Do you want to rebase local master on top of remote develop? (y/n): " REBASE_CONFIRM
    if [ "$REBASE_CONFIRM" != "y" ]; then
        echo "Exiting."
        exit 1
    fi
    ask_consent "Rebase master onto origin/develop so release tags point to the latest tested commit." git rebase origin/develop
fi

require_clean_worktree "Rebase introduced tracked changes (e.g., conflict resolution artifacts). Review and resolve them before proceeding."

# Step 6: Push changes in the local master branch to remote master
echo "==== Push master ===="
ask_consent "Push master to origin to publish the release commit before tagging." git push origin master

# Step 7: Create a local tag with the initially specified name referring to the tip of master
echo "==== Create local tag ===="
ask_consent "Create local tag $TAG so the release can be pushed." git tag "$TAG"

# Step 8: Push the local tag to remote
echo "==== Push tag ===="
ask_consent "Push tag $TAG to origin to make the release available to users." git push origin "$TAG"

# Step 9: Restore original branch
echo "==== Restore original branch ===="
restore_workspace

echo "Tag $TAG has been created and pushed to remote."
