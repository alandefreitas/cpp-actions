#!/bin/bash

set -euo pipefail

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
    if ! git checkout --dry-run "$target" >/dev/null 2>&1; then
        echo "Checkout preview detected conflicts (tracked files or untracked files would be overwritten)."
        echo "Resolve or stash those files before continuing."
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
    IFS='.' read -r -a VERSION_PARTS <<< "${LATEST_TAG:1}"
    PATCH=$((VERSION_PARTS[2] + 1))
    TAG="v${VERSION_PARTS[0]}.${VERSION_PARTS[1]}.$PATCH"
    read -r -p "Suggested tag is $TAG. Is this appropriate? (y/n): " CONFIRM
    if [ "$CONFIRM" != "y" ]; then
        read -r -p "Please enter the desired tag: " TAG
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

# Step 4: Check out the develop branch locally and check if it matches the remote
echo "==== Develop matches remote ===="
ask_consent "Fetch latest refs from origin to ensure develop is up to date before tagging." git fetch origin
LOCAL_DEVELOP=$(git rev-parse refs/heads/develop)
REMOTE_DEVELOP=$(git rev-parse origin/develop)
if [ "$LOCAL_DEVELOP" != "$REMOTE_DEVELOP" ]; then
    echo "Local develop branch is not up to date with remote. "
    echo "Local develop:  $LOCAL_DEVELOP."
    git log -1 --pretty=format:"%s" refs/heads/develop
    echo "Remote develop: $REMOTE_DEVELOP."
    git log -1 --pretty=format:"%s" origin/develop
    echo "Exiting"
    exit 1
fi

# Step 5: Check out the master branch locally and check if it matches the remote develop
echo "==== Master matches develop ===="
ensure_checkout_safe master
ask_consent "Check out the master branch locally to prepare for release tagging." git checkout master
require_clean_worktree "Checkout left tracked changes (frequently produced by post-checkout hooks). Clean them up before continuing."

LOCAL_MASTER=$(git rev-parse refs/heads/master)
if [ "$LOCAL_MASTER" != "$REMOTE_DEVELOP" ]; then
    echo "Local master branch is not up to date with remote develop."
    echo "Local master:   $LOCAL_MASTER."
    git log -1 --pretty=format:"%s" refs/heads/master
    echo "Remote develop: $REMOTE_DEVELOP."
    git log -1 --pretty=format:"%s" origin/develop
    git log refs/head/master..origin/develop
    read -r -p "Do you want to rebase local master on top of remote develop? (y/n): " REBASE_CONFIRM
    if [ "$REBASE_CONFIRM" != "y" ]; then
        echo "Exiting."
        exit 1
    fi
    ask_consent "Rebase master onto origin/develop so release tags point to the latest tested commit." git rebase origin/develop
fi

require_clean_worktree "Rebase introduced tracked changes (e.g., conflict resolution artifacts). Review and resolve them before proceeding."

echo "==== Dependency audit ===="
ask_consent "Run depcheck across all actions to verify dependency health." ./depcheck.sh

echo "==== Dependency updates ===="
ask_consent "Run update-dependencies to refresh package versions before release." ./update-dependencies.sh

echo "==== Update versions ===="
ask_consent "Update package.json versions to $VERSION across all actions." ./version.sh "$VERSION"

echo "==== Rebuild bundles ===="
ask_consent "Regenerate dist outputs so release $TAG contains fresh builds." ./build.sh

echo "==== Stage release artifacts ===="
if [ -z "$(git status --porcelain)" ]; then
    echo "No changes detected after dependency updates and rebuild. Exiting to avoid an empty release commit."
    exit 1
fi
ask_consent "Stage all release artifacts before committing." git add -A

echo "==== Create release commit ===="
ask_consent "Create commit documenting release $TAG." git commit -m "chore(release): $TAG"

require_clean_worktree "Commit left tracked changes (hooks may have reformatted files). Ensure the tree is clean before pushing."

# Step 6: Push changes in the local master branch to remote master
echo "==== Push master ===="
ask_consent "Push master to origin to publish the release commit before tagging." git push origin master

# Step 7: Create a local tag with the initially specified name referring to the tip of master
echo "==== Create local tag ===="
ask_consent "Create local tag $TAG so the release can be pushed." git tag "$TAG"

# Step 8: Push the local tag to remote
echo "==== Push tag ===="
ask_consent "Push tag $TAG to origin to make the release available to users." git push origin "$TAG"

echo "Tag $TAG has been created and pushed to remote."
