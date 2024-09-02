#!/bin/bash

set -e

# Step 1: Get the first argument from the command line
echo "==== Read Tag ===="
TAG=$1

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

# Step 4: Check out the develop branch locally and check if it matches the remote
echo "==== Develop matches remote ===="
git fetch origin
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
git checkout master
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
    git rebase origin/develop
fi

# Step 6: Push changes in the local master branch to remote master
echo "==== Push master ===="
git push origin master

# Step 7: Create a local tag with the initially specified name referring to the tip of master
echo "==== Create local tag ===="
git tag "$TAG"

# Step 8: Push the local tag to remote
echo "==== Push tag ===="
git push origin "$TAG"

echo "Tag $TAG has been created and pushed to remote."
