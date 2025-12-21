/**
 * GitHub API utilities for create-changelog action.
 *
 * @module github-api
 */

import * as axios from 'axios';
import { Commit, GitHubUser, Tag } from './types';

/**
 * Extracts the repository owner from a GitHub URL.
 *
 * @param repoUrl - GitHub repository URL
 * @returns Repository owner name or null if not found
 */
export function getGithubRepoOwner(repoUrl: string | undefined): string | null {
    if (!repoUrl) {
        return null;
    }

    // Remove leading "https://" or "http://" if present
    repoUrl = repoUrl.replace(/^https?:\/\//, '');

    // Extract the repository owner
    if (repoUrl.startsWith('github.com/')) {
        const pathParts = repoUrl.split('/');
        if (pathParts.length >= 2) {
            return pathParts[1];
        }
    }
    return null;
}

/**
 * Extracts the repository name from a GitHub URL.
 *
 * @param repoUrl - GitHub repository URL
 * @returns Repository name or null if not found
 */
export function getGithubRepoName(repoUrl: string | undefined): string | null {
    if (!repoUrl) {
        return null;
    }

    // Remove leading "https://" or "http://" if present
    repoUrl = repoUrl.replace(/^https?:\/\//, '');

    // Extract the repository name
    if (repoUrl.startsWith('github.com/')) {
        const pathParts = repoUrl.split('/');
        if (pathParts.length >= 3) {
            return pathParts[2];
        }
    }
    return null;
}

/**
 * Gets the author username of a GitHub issue.
 *
 * @param repoUrl - GitHub repository URL
 * @param issueNumber - Issue number
 * @param accessToken - GitHub access token for API requests
 * @returns Issue author username or null if not found
 */
export async function getIssueAuthor(repoUrl: string, issueNumber: string, accessToken: string): Promise<string | null> {
    // Extract the owner and repository name from the URL
    const urlParts = repoUrl.replace(/\/$/, '').split('/');
    const owner = urlParts[urlParts.length - 2];
    const repository = urlParts[urlParts.length - 1];

    // Construct the GitHub API URL for the issue
    const url = `https://api.github.com/repos/${owner}/${repository}/issues/${issueNumber}`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await axios.default.get(url, { headers });
        if (response.status === 200) {
            const issueData = response.data;
            const author = issueData.user.login;
            return author;
        }
    } catch (error) {
        console.error(`Error fetching issue author: ${(error as Error).message}`);
    }

    return null;
}

/**
 * Fetches tags from GitHub API matching a pattern.
 *
 * @param repoUrl - GitHub repository URL
 * @param tagPattern - Regex pattern to filter tags
 * @param accessToken - GitHub access token for API requests
 * @returns Array of matching tags
 */
export async function getGithubTags(repoUrl: string | undefined, tagPattern: RegExp, accessToken: string): Promise<Tag[]> {
    if (!repoUrl) {
        return [];
    }

    const url = `https://api.github.com/repos/${getGithubRepoOwner(repoUrl)}/${getGithubRepoName(repoUrl)}/tags`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'My-User-Agent'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const tags: Tag[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const params = {
            page: page,
            per_page: perPage
        };

        try {
            const response = await axios.default.get(url, { headers, params });
            if (response.status === 200) {
                const pageTags = response.data;
                if (pageTags.length > 0) {
                    for (const pageTag of pageTags) {
                        if (tagPattern.test(pageTag.name)) {
                            tags.push({ name: pageTag.name, sha: pageTag.commit.sha });
                        }
                    }
                    page += 1;
                } else {
                    break;
                }
            } else {
                console.error(`Error: ${response.status} - ${response.statusText}`);
                return tags;
            }
        } catch (error) {
            const axiosError = error as { response?: { status: number; statusText: string } };
            if (axiosError.response) {
                console.error(`Error: ${axiosError.response.status} - ${axiosError.response.statusText}`);
            } else {
                console.error(`Error: ${(error as Error).message}`);
            }
            return tags;
        }
    }

    return tags;
}

/**
 * Fetches a user's display name from their GitHub profile.
 *
 * @param username - GitHub username
 * @param accessToken - GitHub access token
 * @returns Profile display name or null if not found
 */
export async function getGithubProfileName(username: string, accessToken: string): Promise<string | null> {
    const url = `https://api.github.com/users/${username}`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await axios.default.get(url, { headers });
        if (response.status === 200) {
            const profileData = response.data;
            const githubProfileName = profileData.name;
            if (githubProfileName) {
                return githubProfileName;
            }
        }
    } catch (error) {
        console.error(`Error fetching GitHub profile name: ${(error as Error).message}`);
    }

    return null;
}

/**
 * Finds a GitHub username by email address.
 *
 * @param email - Email address to search for
 * @param accessToken - GitHub access token
 * @returns GitHub username or null if not found
 */
export async function getGithubUsername(email: string, accessToken: string): Promise<string | null> {
    const url = `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await axios.default.get(url, { headers });
        if (response.status === 200) {
            const searchResults = response.data;
            const items = searchResults.items;
            if (items && items.length > 0) {
                return items[0].login;
            }
        }
    } catch (error) {
        console.error(`Error fetching GitHub username: ${(error as Error).message}`);
    }

    return null;
}

/**
 * Populates GitHub usernames and names for all commits.
 *
 * Propagates username information to commits with matching email addresses.
 *
 * @param commits - Array of commits to populate
 * @param accessToken - GitHub access token
 */
export async function populateGithubUsernames(commits: Commit[], accessToken: string): Promise<void> {
    for (const commit of commits) {
        if (!commit.gh_username) {
            continue;
        }
        let ghUsername = commit.gh_username;
        let ghName = commit.gh_name;
        if (!ghName) {
            ghName = await getGithubProfileName(ghUsername, accessToken);
        }
        if (ghName) {
            commit.gh_name = ghName;
            for (const commit2 of commits) {
                if (commit2.author_email === commit.author_email) {
                    commit2.gh_username = ghUsername;
                    commit2.gh_name = ghName;
                }
            }
        }
    }

    for (const commit of commits) {
        if (commit.gh_username) {
            continue;
        }
        if (!commit.author_email) {
            continue;
        }
        const ghUsername = await getGithubUsername(commit.author_email, accessToken);
        if (!ghUsername) {
            continue;
        }
        const ghName = await getGithubProfileName(ghUsername, accessToken);
        if (ghName) {
            commit.gh_username = ghUsername;
            commit.gh_name = ghName;
            for (const commit2 of commits) {
                if (commit2.author_email === commit.author_email) {
                    commit2.gh_username = ghUsername;
                    commit2.gh_name = ghName;
                }
            }
        }
    }
}

/**
 * Checks if a user has admin permissions on a repository.
 *
 * @param repoUrl - GitHub repository URL
 * @param username - GitHub username to check
 * @param accessToken - GitHub access token
 * @returns True if user has admin permissions
 */
export async function checkGithubAdminPermissions(repoUrl: string, username: string, accessToken: string): Promise<boolean> {
    // Extract the repository owner and name from the URL
    const [, , , owner, repo] = repoUrl.replace(/\/$/, '').split('/');

    // Prepare the API endpoint URL
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}/permission`;

    // Set the request headers with the access token for authentication
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        // Send the GET request to the API endpoint
        const response = await axios.default.get(apiUrl, { headers });
        if (response.status === 200) {
            const permissionData = response.data;
            if (permissionData.permission === 'admin') {
                return true;
            }
        }
    } catch (error) {
        console.error(`Error checking GitHub admin permissions: ${(error as Error).message}`);
    }

    return false;
}

/**
 * Checks if a user belongs to the repository owner's organization.
 *
 * @param repoUrl - GitHub repository URL
 * @param username - GitHub username to check
 * @param accessToken - GitHub access token
 * @returns True if user is in the owner's organization
 */
export async function checkUserInstitution(repoUrl: string, username: string, accessToken: string): Promise<boolean> {
    // Extract the repository owner from the URL
    const [, , , owner] = repoUrl.replace(/\/$/, '').split('/');

    // Prepare the API endpoint URL to retrieve user information
    const apiUrl = `https://api.github.com/users/${username}`;

    // Set the authorization header with the access token
    const headers: Record<string, string> = {};
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        // Send the GET request to the API endpoint
        const response = await axios.default.get(apiUrl, { headers });
        if (response.status === 200) {
            const userData = response.data;
            const organizationsUrl = userData.organizations_url;

            // Retrieve all organizations using pagination
            const organizations: { login: string }[] = [];
            let page = 1;
            while (true) {
                const orgsUrl = `${organizationsUrl}?page=${page}&per_page=100`;
                const orgsResponse = await axios.default.get(orgsUrl, { headers });
                if (orgsResponse.status === 200) {
                    const orgsData = orgsResponse.data;
                    if (orgsData.length > 0) {
                        organizations.push(...orgsData);
                        page += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            // Check if the repository owner is in the organization list
            for (const org of organizations) {
                if (org.login === owner) {
                    return true;
                }
            }
        }
    } catch (error) {
        console.error(`Error checking user institution: ${(error as Error).message}`);
    }

    return false;
}

/**
 * Populates author data and issue information for commits.
 *
 * Creates GitHubUser entries for commit authors and issue reporters,
 * including permission and affiliation checks.
 *
 * @param commits - Array of commits to process
 * @param repoUrl - GitHub repository URL
 * @param repoOwner - Repository owner username
 * @param accessToken - GitHub access token
 * @returns Map of usernames to GitHubUser objects
 */
export async function populateIssueData(commits: Commit[], repoUrl: string | undefined, repoOwner: string | undefined, accessToken: string): Promise<Record<string, GitHubUser>> {
    const authors: Record<string, GitHubUser> = {};

    if (!repoUrl) {
        return authors;
    }

    for (const commit of commits) {
        if (commit.gh_username) {
            if (!authors[commit.gh_username]) {
                authors[commit.gh_username] = new GitHubUser();
                authors[commit.gh_username].username = commit.gh_username;
                authors[commit.gh_username].name = commit.gh_name;
                authors[commit.gh_username].commits = 1;
                authors[commit.gh_username].commits_perc = 1 / commits.length;
                if (repoOwner && repoOwner === commit.gh_username) {
                    authors[commit.gh_username].is_owner = true;
                }
                authors[commit.gh_username].is_admin = await checkGithubAdminPermissions(repoUrl, commit.gh_username, accessToken);
                authors[commit.gh_username].is_affiliated = await checkUserInstitution(repoUrl, commit.gh_username, accessToken);
            } else {
                authors[commit.gh_username].commits += 1;
                authors[commit.gh_username].commits_perc = authors[commit.gh_username].commits / commits.length;
            }
        }

        if (commit.gh_issue_username) {
            if (!authors[commit.gh_issue_username]) {
                authors[commit.gh_issue_username] = new GitHubUser();
                authors[commit.gh_issue_username].username = commit.gh_issue_username;
                authors[commit.gh_issue_username].name = await getGithubProfileName(commit.gh_issue_username, accessToken);
                authors[commit.gh_issue_username].commits = 0;
                authors[commit.gh_issue_username].commits_perc = 0;
                if (repoOwner && repoOwner === commit.gh_issue_username) {
                    authors[commit.gh_issue_username].is_owner = true;
                }
                authors[commit.gh_issue_username].is_admin = await checkGithubAdminPermissions(repoUrl, commit.gh_issue_username, accessToken);
                authors[commit.gh_issue_username].is_affiliated = await checkUserInstitution(repoUrl, commit.gh_issue_username, accessToken);
            }
        }
    }

    return authors;
}
