# Description: Helper functions for build.sh script

#!/bin/bash

# Function: fetch_tags
# --------------------
# Fetches tags from a remote Git repository and saves them as a JSON array in a specified output file.
#
# Parameters:
#   repo_url (string): The URL of the remote Git repository.
#   output_file (string): The path to the file where the JSON array of tags will be saved.
#
# Behavior:
#   - Checks if the required tools (`git` and `jq`) are installed. If not, it logs an error and exits the function.
#   - Creates the directory for the output file if it does not already exist.
#   - Uses `git ls-remote` to fetch tags from the remote repository.
#   - Processes the tags to extract their names and formats them as a JSON array using `jq`.
#   - Saves the JSON array to the specified output file.
#
# Returns:
#   - 0 on success.
#   - 1 if `git` or `jq` is not installed, or if there is an error during the process.
#
# Notes:
#   - The function does not terminate the script on failure; it returns an error code instead.
#   - The output file will be overwritten if it already exists.
#   - The function assumes that the `jq` tool is available for JSON processing.
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

# Function: generate_ubuntu_versions_json
# ----------------------------------------
# Fetches Ubuntu version and distribution information from the Ubuntu changelogs meta-release URL
# and generates a JSON file mapping versions to their corresponding distribution names.
#
# Behavior:
#   - Checks if the `curl` command-line tool is installed. If not, it logs a warning and exits the function.
#   - Downloads the meta-release file from the Ubuntu changelogs server.
#   - Parses the file to extract version and distribution information.
#   - Strips unnecessary details (e.g., "LTS" and beyond) from the version string.
#   - Constructs a JSON object mapping versions to distributions.
#   - Saves the JSON object to `setup-program/ubuntu-versions.json`.
#
# Parameters:
#   None
#
# Returns:
#   - 0 on success.
#   - 1 if `curl` is not installed or if there is an error during the process.
#
# Notes:
#   - The function creates a temporary file to store the downloaded meta-release data.
#   - The temporary file is deleted after processing.
#   - The output file (`setup-program/ubuntu-versions.json`) will be overwritten if it already exists.
#   - The function assumes the meta-release file follows a specific format with "Version:" and "Dist:" fields.
generate_ubuntu_versions_json() {
    local url="http://changelogs.ubuntu.com/meta-release"

    # Check if curl is available
    if ! command -v curl &> /dev/null; then
        echo "Warning: 'curl' is not installed. Cannot fetch Ubuntu versions."
        return 1
    fi

    local temp_file
    temp_file=$(mktemp)
    curl -s "$url" > "$temp_file"

    local json="{"
    local version=""
    local dist=""

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line == Version:* ]]; then
            version=$(echo "$line" | cut -d: -f2- | xargs)
            version=$(echo "$version" | sed 's/ *LTS.*//')  # Strip "LTS" and beyond
        elif [[ $line == Dist:* ]]; then
            dist=$(echo "$line" | cut -d: -f2- | xargs)
        elif [[ -z $line ]]; then
            # End of block: if both version and dist are set, add to json
            if [[ -n $version && -n $dist ]]; then
                json+="\"$version\":\"$dist\","
            fi
            version=""
            dist=""
        fi
    done < "$temp_file"

    # Catch any final block not followed by a newline
    if [[ -n $version && -n $dist ]]; then
        json+="\"$version\":\"$dist\","
    fi

    # Finalize JSON
    json="${json%,}}"

    echo "$json" > setup-program/ubuntu-versions.json
    echo "Created setup-program/ubuntu-versions.json"

    rm "$temp_file"
}
