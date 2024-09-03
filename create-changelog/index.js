const core = require('@actions/core')
const fs = require('fs')
const path = require('path')
const exec = require('@actions/exec')
const axios = require('axios')
const trace_commands = require('trace-commands')

class Commit {
    constructor() {
        this.hash = null
        this.extra_hashes = []
        this.author = null
        this.author_name = null
        this.author_email = null
        this.gh_name = null
        this.gh_username = null
        this.date = null
        this.message = ''

        // conventional fields
        this.subject = null
        this.type = null
        this.scope = null
        this.description = null
        this.body = ''
        this.footers = []
        this.breaking = false

        // whether the commit is conventional or not
        this.conventional = true

        // issue info
        this.issue = null
        this.gh_issue_username = null

        // delimiter
        this.tag = null
        this.is_parent_release = false
    }
}

class GitHubUser {
    constructor() {
        this.username = null
        this.name = null
        this.commits = 0
        this.commits_perc = 0
        this.is_owner = false
        this.is_admin = false
        this.is_affiliated = false
        this.is_regular = true
    }
}


async function getCurrentBranch(projectPath) {
    let branch = ''
    try {
        const exitCode = await exec.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: projectPath,
            listeners: {
                stdout: (data) => {
                    branch += data.toString()
                }
            }
        })
        if (exitCode === 0) {
            branch = branch.trim()
            if (branch.startsWith('heads/')) {
                branch = branch.slice(6)
            }
            return branch
        } else {
            console.error(`Git command execution failed with exit code ${exitCode}`)
        }
    } catch (error) {
        console.error(`Error executing Git command: ${error.message}`)
    }
    return null
}

async function getGithubRemote(gitPath) {
    let remoteOutput = ''
    try {
        // Get the remote URL using the git command
        await exec.exec('git remote -v', [], {
            cwd: gitPath,
            listeners: {
                stdout: (data) => {
                    remoteOutput += data.toString()
                }
            }
        })

        // Parse the output to find the GitHub remote URL
        const remoteLines = remoteOutput.trim().split('\n')
        for (const line of remoteLines) {
            if (line.startsWith('origin')) {
                const parts = line.split(/\s+/)
                if (parts.length >= 2 && parts[1].startsWith('https://github.com/')) {
                    let url = parts[1]
                    if (url.endsWith('.git')) {
                        url = url.slice(0, -4)
                    }
                    return url
                }
            }
        }
    } catch (error) {
        console.error(`Failed to execute 'git remote -v' command: ${error.message}`)
        return null
    }

    return null
}

function getGithubRepoOwner(repoUrl) {
    if (!repoUrl) {
        return null
    }

    // Remove leading "https://" or "http://" if present
    repoUrl = repoUrl.replace(/^https?:\/\//, '')

    // Extract the repository owner
    if (repoUrl.startsWith('github.com/')) {
        const pathParts = repoUrl.split('/')
        if (pathParts.length >= 2) {
            return pathParts[1]
        }
    }
    return null
}

function getGithubRepoName(repoUrl) {
    if (!repoUrl) {
        return null
    }

    // Remove leading "https://" or "http://" if present
    repoUrl = repoUrl.replace(/^https?:\/\//, '')

    // Extract the repository name
    if (repoUrl.startsWith('github.com/')) {
        const pathParts = repoUrl.split('/')
        if (pathParts.length >= 3) {
            return pathParts[2]
        }
    }
    return null
}

async function adjustParameters(inputs) {
    const envKeys = ['GITHUB_BASE_REF', 'GITHUB_REF_NAME']
    for (const envKey of envKeys) {
        if (!inputs.repo_branch) {
            inputs.repo_branch = process.env[envKey]
            if (inputs.repo_branch) {
                console.log(`Repository Branch ${inputs.repo_branch} from ${envKey}`)
                break
            }
        }
    }
    if (!inputs.repo_branch) {
        inputs.repo_branch = await getCurrentBranch(inputs.source_dir)
        if (inputs.repo_branch) {
            console.log(`Repository Branch ${inputs.repo_branch} from local path`)
        }
    }
    if (!inputs.access_token) {
        inputs.access_token = process.env['GITHUB_TOKEN']
        if (inputs.access_token) {
            console.log(`Access token **** from GITHUB_TOKEN`)
        }
    }

    inputs.repoUrl = await getGithubRemote(inputs.source_dir)
    inputs.repoOwner = getGithubRepoOwner(inputs.repoUrl)
    inputs.repoName = getGithubRepoName(inputs.repoUrl)
}

async function getLocalTags(projectPath, tagPattern) {
    const tags = []
    const commonExecOptions = {cwd: projectPath}

    // Get local tags
    let tagsOutput = ''
    await exec.exec('git', ['tag', '-l'], {
        ...commonExecOptions,
        listeners: {
            stdout: (data) => {
                tagsOutput += data.toString()
            }
        }
    })

    const tagLines = tagsOutput.split('\n').filter(line => line.trim() !== '')
    for (const tag of tagLines) {
        if (tagPattern.test(tag)) {
            let commitOutput = ''
            await exec.exec('git', ['rev-list', '-n', '1', tag], {
                ...commonExecOptions,
                listeners: {
                    stdout: (data) => {
                        commitOutput += data.toString()
                    }
                }
            })
            const commitId = commitOutput.trim()
            tags.push({name: tag, sha: commitId})
        }
    }

    // Get remote tags
    let lsRemoteOutput = ''
    await exec.exec('git', ['ls-remote', '--tags'], {
        ...commonExecOptions,
        listeners: {
            stdout: (data) => {
                lsRemoteOutput += data.toString()
            }
        }
    })

    const remoteLines = lsRemoteOutput.split('\n').filter(line => line.trim() !== '')
    for (const line of remoteLines) {
        const parts = line.split(/\s+/)
        if (parts.length === 2 && parts[1].startsWith('refs/tags/')) {
            const commitId = parts[0]
            const tag = parts[1].split('/').pop()
            if (tagPattern.test(tag)) {
                tags.push({name: tag, sha: commitId})
            }
        }
    }

    return tags
}

async function getGithubTags(repoUrl, tagPattern, accessToken) {
    if (!repoUrl) {
        return []
    }

    const url = `https://api.github.com/repos/${getGithubRepoOwner(repoUrl)}/${getGithubRepoName(repoUrl)}/tags`
    const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'My-User-Agent'
    }

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    const tags = []
    let page = 1
    const perPage = 100

    while (true) {
        const params = {
            page: page,
            per_page: perPage
        }

        try {
            const response = await axios.get(url, {headers, params})
            if (response.status === 200) {
                const pageTags = response.data
                if (pageTags.length > 0) {
                    for (const pageTag of pageTags) {
                        if (tagPattern.test(pageTag.name)) {
                            tags.push({name: pageTag.name, sha: pageTag.commit.sha})
                        }
                    }
                    page += 1
                } else {
                    break
                }
            } else {
                console.error(`Error: ${response.status} - ${response.statusText}`)
                return tags
            }
        } catch (error) {
            console.error(`Error: ${error.response.status} - ${error.response.statusText}`)
            return tags
        }
    }

    return tags
}

function removeTagDuplicates(tags, comparisonFields) {
    const uniqueItems = []
    const seenValues = new Set()

    for (const tag of tags) {
        // Generate a string representation of the comparison fields
        const tagStrings = comparisonFields.map(field => tag[field]).join('|')

        // Check if the comparison values have been seen before
        if (!seenValues.has(tagStrings)) {
            uniqueItems.push(tag)
            seenValues.add(tagStrings)
        }
    }

    return uniqueItems
}

async function processTags(projectPath, tagPattern, repoUrl, accessToken) {
    function fnlog(msg) {
        trace_commands.log('processTags: ' + msg)
    }

    let tags = await getLocalTags(projectPath, tagPattern)
    fnlog(`${tags.length} local tags`)

    if (tags.length === 0) {
        const repoTags = await getGithubTags(repoUrl, tagPattern, accessToken)
        fnlog(`${repoTags.length} repo tags`)
        tags = tags.concat(repoTags)
    }

    tags = removeTagDuplicates(tags, ['name', 'sha'])
    fnlog(`${tags.length} tags`)
    return tags
}

async function getIssueAuthor(repoUrl, issueNumber, accessToken) {
    // Extract the owner and repository name from the URL
    const urlParts = repoUrl.replace(/\/$/, '').split('/')
    const owner = urlParts[urlParts.length - 2]
    const repository = urlParts[urlParts.length - 1]

    // Construct the GitHub API URL for the issue
    const url = `https://api.github.com/repos/${owner}/${repository}/issues/${issueNumber}`
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    }

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    try {
        const response = await axios.get(url, {headers})
        if (response.status === 200) {
            const issueData = response.data
            const author = issueData.user.login
            return author
        }
    } catch (error) {
        console.error(`Error fetching issue author: ${error.message}`)
    }

    return null
}

function normalizeType(s) {
    // The units of information that make up Conventional Commits MUST NOT be treated as case sensitive
    // by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
    // BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE
    const categoryMapping = {
        'doc': 'docs',
        'documentation': 'docs',
        'fixes': 'fix',
        'bugfix': 'fix',
        'work': 'chore',
        'chores': 'chore',
        'maintenance': 'chore',
        'feature': 'feat',
        'cleanup': 'refactor',
        'performance': 'perf',
        'testing': 'test',
        'tests': 'test',
        'version': 'release',
        'integration': 'ci',
        'break': 'breaking',
        'undo': 'revert'
    }
    return categoryMapping[s.toLowerCase()] || s
}

async function populateConventional(commit, repoUrl, versionPattern, tags) {
    for (const line of commit.message.split('\n')) {
        if (!commit.subject) {
            // Is subject
            commit.subject = line
            const m = line.match(/([ \w_-]+)(\(([ \w_-]+)\))?(!?): ([^\n]*)\n?(.*)/)
            if (m) {
                // conventional commit
                commit.type = normalizeType(m[1])
                commit.scope = m[3]
                commit.description = m[5]
                commit.breaking = m[4] === '!'
                commit.conventional = true
            } else {
                // regular commit
                commit.description = commit.subject
                commit.type = 'other'
                commit.scope = null
                commit.breaking = commit.subject.includes('BREAKING')
                commit.conventional = false
            }
        } else {
            // Is body or footer
            const m = line.match(/(([^ ]+): )|(([^ ]+) #)|((BREAKING CHANGE): )/)
            if (m) {
                // is a footer
                if (m[1]) {
                    commit.footers.push([m[2], line.slice(m[2].length + 2).trim()])
                } else if (m[3]) {
                    commit.footers.push([m[4], line.slice(m[4].length + 1).trim()])
                } else if (m[5]) {
                    commit.footers.push([m[6], line.slice(m[6].length + 2).trim()])
                }
                if (commit.footers[commit.footers.length - 1][0].toLowerCase().startsWith('breaking')) {
                    commit.breaking = true
                }
            } else if (['breaking', 'breaking-change', 'breaking change'].includes(line.toLowerCase())) {
                // footer with no key and value
                // -> the whole message is breaking change footer
                commit.breaking = true
            } else {
                // this is a line from the body
                if (!commit.body) {
                    commit.body += line
                } else {
                    commit.body += '\n' + line
                }
            }
        }
    }

    const issueFooterKeys = ['Close', 'Closes', 'Closed', 'close', 'closes', 'closed',
        'Fix', 'Fixes', 'Fixed', 'fix', 'fixes', 'fixed',
        'Resolve', 'Resolves', 'Resolved', 'resolve', 'resolves', 'resolved']
    for (const [key, value] of commit.footers) {
        if (issueFooterKeys.includes(key) && value.startsWith('#')) {
            commit.issue = value.slice(1)
            commit.gh_issue_username = await getIssueAuthor(repoUrl, commit.issue)
            break
        }
    }

    for (const tag of tags) {
        if (commit.hash === tag.sha) {
            commit.tag = tag.name
            break
        }
    }

    commit.is_parent_release = false
    if (commit.tag !== null) {
        console.log(`Stopping at commit id ${commit.hash.slice(0, 8)} (tag ${commit.tag})`)
        commit.is_parent_release = true
    } else {
        let matches = commit.description.match(versionPattern)
        if (matches) {
            console.log(`Stopping at commit id ${commit.hash.slice(0, 8)} (description: ${commit.description})`)
            commit.is_parent_release = true
        } else {
            matches = commit.subject.match(versionPattern)
            if (matches) {
                console.log(`Stopping at commit id ${commit.hash.slice(0, 8)} (subject: ${commit.subject})`)
                commit.is_parent_release = true
            }
        }
    }

    return commit
}

async function getLocalCommits(projectPath, repoUrl, versionPattern, tags) {
    const commits = []
    let commitLogOutput = ''

    await exec.exec('git', ['--no-pager', 'log'], {
        cwd: projectPath,
        listeners: {
            stdout: (data) => {
                commitLogOutput += data.toString()
            }
        }
    })

    const commitLogLines = commitLogOutput.split('\n')
    let commit = new Commit()
    let msg = ''

    for (const line of commitLogLines) {
        if (line === '') continue

        if (line.startsWith('commit ') && !line.slice(7).includes(' ')) {
            if (commit.hash) {
                commit = await populateConventional(commit, repoUrl, versionPattern, tags)
                const isDetail = commit.subject.startsWith('[') && commit.subject.includes(']')
                if (!isDetail) {
                    commits.push(commit)
                    if (commits.length === 1) {
                        commits[0].is_parent_release = false
                    } else if (commits[commits.length - 1].is_parent_release) {
                        break
                    }
                }
                commit = new Commit()
            }
            commit.hash = line.slice(7)
        } else if (commit.hash && !commit.author && line.startsWith('Author: ')) {
            commit.author = line.slice(8)
            const p = commit.author.indexOf(' <')
            if (p !== -1) {
                commit.author_name = commit.author.slice(0, p)
                commit.author_email = commit.author.slice(p + 2, -1)
            }
        } else if (commit.author && !commit.date && line.startsWith('Date: ')) {
            commit.date = line.slice(6)
        } else if (commit.date && line.startsWith('    ')) {
            if (commit.message !== '') {
                commit.message += '\n' + line.slice(4)
            } else {
                commit.message += line.slice(4)
            }
        }
    }

    return commits
}

function removeCommitDuplicates(commits) {
    const uniqueCommits = []
    const seenValues = new Set()

    for (const commit of commits) {
        const comparisonValues = JSON.stringify([commit.type, commit.scope, commit.description])
        if (!seenValues.has(comparisonValues)) {
            uniqueCommits.push(commit)
            seenValues.add(comparisonValues)
        } else {
            let idx = -1
            for (let i = 0; i < uniqueCommits.length; i++) {
                const comparisonValues2 = JSON.stringify([uniqueCommits[i].type, uniqueCommits[i].scope, uniqueCommits[i].description])
                if (comparisonValues === comparisonValues2) {
                    idx = i
                    break
                }
            }
            if (idx !== -1) {
                if (uniqueCommits[idx].body !== commit.body) {
                    uniqueCommits[idx].body += commit.body
                }
                for (const footer of commit.footers) {
                    if (!uniqueCommits[idx].footers.includes(footer)) {
                        uniqueCommits[idx].footers.push(footer)
                    }
                }
                if (commit.breaking) {
                    uniqueCommits[idx].breaking = true
                }
                uniqueCommits[idx].extra_hashes.push(commit.hash)
            }
        }
    }

    return uniqueCommits
}

async function getGithubCommits(repoUrl, branch, versionPattern, tags, accessToken) {
    if (!repoUrl) {
        return []
    }

    const commits = []
    const url = `https://api.github.com/repos/${getGithubRepoOwner(repoUrl)}/${getGithubRepoName(repoUrl)}/commits`
    const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'My-User-Agent',
        'sha': branch
    }

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    let page = 1
    while (commits.length === 0 || !commits[commits.length - 1].is_parent_release) {
        const params = {
            page: page,
            per_page: 100
        }

        try {
            const response = await axios.get(url, {headers, params})
            if (response.status === 200) {
                const pageCommits = response.data
                if (pageCommits.length > 0) {
                    for (const pageCommit of pageCommits) {
                        let commit = new Commit()
                        commit.hash = pageCommit.sha
                        commit.author = `${pageCommit.commit.committer.name} <${pageCommit.commit.committer.email}>`
                        commit.author_name = pageCommit.commit.committer.name
                        commit.author_email = pageCommit.commit.committer.email
                        if (pageCommit.commit.committer.login) {
                            commit.gh_name = await getGithubProfileName(pageCommit.committer.login, accessToken)
                            commit.gh_username = pageCommit.commit.committer.login
                        }
                        commit.date = pageCommit.commit.committer.date
                        commit.message = pageCommit.commit.message
                        commit = await populateConventional(commit, repoUrl, versionPattern, tags)
                        const isDetail = commit.subject.startsWith('[') && commit.subject.includes(']')
                        if (!isDetail) {
                            commits.push(commit)
                            if (commits.length === 1) {
                                commits[0].is_parent_release = false
                            } else if (commits[commits.length - 1].is_parent_release) {
                                break
                            }
                        }
                    }
                    page += 1
                } else {
                    break
                }
            } else {
                core.error(`Error: ${response.status} - ${response.statusText}`)
                return commits
            }
        } catch (error) {
            core.error(`Error: ${error.response.status} - ${error.response.statusText}`)
            return commits
        }
    }

    return commits
}

async function processCommits(projectPath, repoUrl, versionPattern, tags, repoBranch, accessToken, checkUnconventional) {
    function fnlog(msg) {
        trace_commands.log('processCommits: ' + msg)
    }

    let commits = await getLocalCommits(projectPath, repoUrl, versionPattern, tags)

    if (checkUnconventional) {
        const unconventionalCommits = commits.filter(commit => !commit.conventional)
        if (unconventionalCommits.length === 1) {
            core.warning(`Commit "${unconventionalCommits[0].subject}" is not a conventional commit`, {
                title: 'Conventional Commits'
            })
        } else if (unconventionalCommits.length > 1) {
            core.warning(`${unconventionalCommits.length} unconventional commits`, {
                title: 'Conventional Commits'
            })
        }
    }

    fnlog(`${commits.length} local commits`)

    if (commits.length === 0 || !commits[commits.length - 1].is_parent_release) {
        const commitHashes = new Set(commits.map(commit => commit.hash))
        const repoCommits = await getGithubCommits(repoUrl, repoBranch, versionPattern, tags, accessToken)
        fnlog(`${repoCommits.length} repo commits`)

        for (const repoCommit of repoCommits) {
            if (!commitHashes.has(repoCommit.hash)) {
                commits.push(repoCommit)
            }
        }

        fnlog(`${commits.length} total commits`)
    }

    commits = removeCommitDuplicates(commits)
    return commits
}

async function getGithubProfileName(username, accessToken) {
    const url = `https://api.github.com/users/${username}`
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    }

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    try {
        const response = await axios.get(url, {headers})
        if (response.status === 200) {
            const profileData = response.data
            const githubProfileName = profileData.name
            if (githubProfileName) {
                return githubProfileName
            }
        }
    } catch (error) {
        console.error(`Error fetching GitHub profile name: ${error.message}`)
    }

    return null
}

async function getGithubUsername(email, accessToken) {
    const url = `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    }

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    try {
        const response = await axios.get(url, {headers})
        if (response.status === 200) {
            const searchResults = response.data
            const items = searchResults.items
            if (items && items.length > 0) {
                return items[0].login
            }
        }
    } catch (error) {
        console.error(`Error fetching GitHub username: ${error.message}`)
    }

    return null
}

async function populateGithubUsernames(commits, accessToken) {
    for (const commit of commits) {
        if (!commit.gh_username) {
            continue
        }
        let ghUsername = commit.gh_username
        let ghName = commit.gh_name
        if (!ghName) {
            ghName = await getGithubProfileName(ghUsername, accessToken)
        }
        if (ghName) {
            commit.gh_name = ghName
            for (const commit2 of commits) {
                if (commit2.author_email === commit.author_email) {
                    commit2.gh_username = ghUsername
                    commit2.gh_name = ghName
                }
            }
        }
    }

    for (const commit of commits) {
        if (commit.gh_username) {
            continue
        }
        const ghUsername = await getGithubUsername(commit.author_email, accessToken)
        const ghName = await getGithubProfileName(ghUsername, accessToken)
        if (ghName) {
            commit.gh_username = ghUsername
            commit.gh_name = ghName
            for (const commit2 of commits) {
                if (commit2.author_email === commit.author_email) {
                    commit2.gh_username = ghUsername
                    commit2.gh_name = ghName
                }
            }
        }
    }
}

async function checkGithubAdminPermissions(repoUrl, username, accessToken) {
    // Extract the repository owner and name from the URL
    const [, , , owner, repo] = repoUrl.replace(/\/$/, '').split('/')

    // Prepare the API endpoint URL
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}/permission`

    // Set the request headers with the access token for authentication
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    }
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    try {
        // Send the GET request to the API endpoint
        const response = await axios.get(apiUrl, {headers})
        if (response.status === 200) {
            const permissionData = response.data
            if (permissionData.permission === 'admin') {
                return true
            }
        }
    } catch (error) {
        console.error(`Error checking GitHub admin permissions: ${error.message}`)
    }

    return false
}

async function checkUserInstitution(repoUrl, username, accessToken) {
    // Extract the repository owner from the URL
    const [, , , owner] = repoUrl.replace(/\/$/, '').split('/')

    // Prepare the API endpoint URL to retrieve user information
    const apiUrl = `https://api.github.com/users/${username}`

    // Set the authorization header with the access token
    const headers = {}
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    try {
        // Send the GET request to the API endpoint
        const response = await axios.get(apiUrl, {headers})
        if (response.status === 200) {
            const userData = response.data
            const organizationsUrl = userData.organizations_url

            // Retrieve all organizations using pagination
            const organizations = []
            let page = 1
            while (true) {
                const orgsUrl = `${organizationsUrl}?page=${page}&per_page=100`
                const orgsResponse = await axios.get(orgsUrl, {headers})
                if (orgsResponse.status === 200) {
                    const orgsData = orgsResponse.data
                    if (orgsData.length > 0) {
                        organizations.push(...orgsData)
                        page += 1
                    } else {
                        break
                    }
                } else {
                    break
                }
            }

            // Check if the repository owner is in the organization list
            for (const org of organizations) {
                if (org.login === owner) {
                    return true
                }
            }
        }
    } catch (error) {
        console.error(`Error checking user institution: ${error.message}`)
    }

    return false
}

async function populateIssueData(commits, repoUrl, repoOwner, accessToken) {
    const authors = {}

    for (const commit of commits) {
        if (commit.gh_username) {
            if (!authors[commit.gh_username]) {
                authors[commit.gh_username] = new GitHubUser()
                authors[commit.gh_username].username = commit.gh_username
                authors[commit.gh_username].name = commit.gh_name
                authors[commit.gh_username].commits = 1
                authors[commit.gh_username].commits_perc = 1 / commits.length
                if (repoOwner && repoOwner === commit.gh_username) {
                    authors[commit.gh_username].is_owner = true
                }
                authors[commit.gh_username].is_admin = await checkGithubAdminPermissions(repoUrl, commit.gh_username, accessToken)
                authors[commit.gh_username].is_affiliated = await checkUserInstitution(repoUrl, commit.gh_username, accessToken)
            } else {
                authors[commit.gh_username].commits += 1
                authors[commit.gh_username].commits_perc = authors[commit.gh_username].commits / commits.length
            }
        }

        if (commit.gh_issue_username) {
            if (!authors[commit.gh_issue_username]) {
                authors[commit.gh_issue_username] = new GitHubUser()
                authors[commit.gh_issue_username].username = commit.gh_issue_username
                authors[commit.gh_issue_username].name = await getGithubProfileName(commit.gh_issue_username, accessToken)
                authors[commit.gh_issue_username].commits = 0
                authors[commit.gh_issue_username].commits_perc = 0
                if (repoOwner && repoOwner === commit.gh_issue_username) {
                    authors[commit.gh_issue_username].is_owner = true
                }
                authors[commit.gh_issue_username].is_admin = await checkGithubAdminPermissions(repoUrl, commit.gh_issue_username, accessToken)
                authors[commit.gh_issue_username].is_affiliated = await checkUserInstitution(repoUrl, commit.gh_issue_username, accessToken)
            }
        }
    }

    return authors
}

function calculatePercentile(data, percentile) {
    if (data.length === 0) {
        return 1
    }

    const sortedData = data.slice().sort((a, b) => a - b)
    const index = (percentile / 100) * (sortedData.length - 1)

    if (Number.isInteger(index)) {
        return sortedData[index]
    } else {
        const lower = sortedData[Math.floor(index)]
        const upper = sortedData[Math.ceil(index)]
        return lower + (index % 1) * (upper - lower)
    }
}

function identifyNonRegularContributors(authors) {
    // Create an array of commit counts
    const commitHist = Object.values(authors).map(author => author.commits)
    const commitSum = commitHist.reduce((sum, commits) => sum + commits, 0)
    const perc80 = calculatePercentile(commitHist, 80)

    for (const author of Object.values(authors)) {
        // 1. Author is not owner, admin, or affiliated
        if (author.is_admin || author.is_affiliated || author.is_owner) {
            author.is_regular = true
            continue
        }
        // 2. Has less than 10% of commits
        if (author.commits < commitSum / 10) {
            author.is_regular = false
            continue
        }
        // 3. Has 3 or fewer commits
        if (author.commits <= 3) {
            author.is_regular = false
            continue
        }
        // 4. Is not among 20% top contributors
        if (author.commits < perc80) {
            author.is_regular = false
            continue
        }
        author.is_regular = true
    }
}

function iconFor(s) {
    // https://github.com/favoloso/conventional-changelog-emoji#available-emojis
    const m = {
        'docs': '📖',
        'fix': '🐛',
        'style': '🎨',
        'chore': '🏗️',
        'build': '📦️',
        'feat': '🚀',
        'refactor': '♻️',
        'perf': '⚡️',
        'test': '🧪',
        'release': '🔖',
        'ci': '🚦',
        'improvement': '🛠️',
        'breaking': '🚨',
        'revert': '🔙',
        'other': '💬',
        null: '💬'
    }
    return m.hasOwnProperty(s) ? m[s] : s
}

function featureSubjectIcon() {
    const icons = ['✨', '💫', '🌟']
    const icon = icons[featureSubjectIcon.count % icons.length]
    featureSubjectIcon.count += 1
    return icon
}

// Initialize the count property
featureSubjectIcon.count = 0

function capitalizeSentences(text) {
    const sentences = text.split('. ')
    let result = ''
    for (let sentence of sentences) {
        sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1)
        sentence = sentence.trim()
        result += sentence
        if (!sentence.endsWith('.')) {
            result += '. '
        }
    }
    return result.trim()
}

function categorizeCommits(commits) {
    function fnlog(msg) {
        trace_commands.log('categorizeCommits: ' + msg)
    }

    let parentRelease = null
    const changes = {}

    for (const c of commits.slice().reverse()) {
        if (c.is_parent_release) {
            parentRelease = c
            continue
        }
        if (!changes[c.type]) {
            changes[c.type] = {}
        }
        if (!changes[c.type][c.scope]) {
            changes[c.type][c.scope] = []
        }
        changes[c.type][c.scope].push(c)
    }
    fnlog(`${Object.keys(changes).length} change categories:`)

    const changeTypePriority = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'build', 'test', 'ci', 'chore', 'release']
    for (const type of Object.keys(changes)) {
        if (!changeTypePriority.includes(type)) {
            changeTypePriority.push(type)
        }
    }
    if (!changeTypePriority.includes('other')) {
        changeTypePriority.push('other')
    }

    return {changes, changeTypePriority, parentRelease}
}

function humanize(s) {
    const mapping = {
        'docs': 'Documentation',
        'fix': 'Fixes',
        'style': 'Style',
        'chore': 'Chores',
        'build': 'Build',
        'feat': 'Features',
        'refactor': 'Refactor',
        'perf': 'Performance',
        'test': 'Tests',
        'release': 'Release',
        'ci': 'Continuous Integration',
        'improvement': 'Improvement',
        'breaking': 'Breaking',
        'revert': 'Revert',
        'other': 'Other'
    }
    return mapping[s] || s
}

function commitTypeDescription(s) {
    const mapping = {
        'docs': 'Documentation updates and improvements',
        'fix': 'Bug fixes and error corrections',
        'style': 'Code style and formatting changes',
        'chore': 'Routine tasks, maintenance, and housekeeping',
        'build': 'Build system and configuration changes',
        'feat': 'New features and additions',
        'refactor': 'Code refactoring and restructuring',
        'perf': 'Performance optimizations and enhancements',
        'test': 'Test cases and testing-related changes',
        'release': 'Release-specific changes and preparations',
        'ci': 'Changes related to continuous integration',
        'improvement': 'General improvements and enhancements',
        'breaking': 'Breaking changes and compatibility modifications',
        'revert': 'Reverted changes to previous versions',
        'other': 'Other changes not covered by specific categories'
    }
    return mapping[s] || ''
}

function generateOutput(changes, changeTypePriority, args, repoUrl, authors, parentRelease) {
    function fnlog(msg) {
        trace_commands.log('generateOutput: ' + msg)
    }

    let output = ''
    let footnotesOutput = ''
    let footnotesCount = 1

    for (const changeType of changeTypePriority) {
        if (changes.hasOwnProperty(changeType)) {
            const scopeChanges = changes[changeType] || {}

            // Title
            if (Object.keys(changes).length > 1 || (Object.keys(changes).length > 0 && changeType !== 'other')) {
                if (output) {
                    output += '\n'
                }
                output += `## ${iconFor(changeType)} ${humanize(changeType)}\n\n`
                const desc = commitTypeDescription(changeType)
                if (desc) {
                    output += `${desc}\n\n`
                }
            }

            // Scopes
            for (const [scope, scopedChanges] of Object.entries(scopeChanges)) {
                const multiline = scope !== null && scopedChanges.length > 1
                if (multiline) {
                    output += `- ${scope}:\n`
                }
                // Scope changes
                for (const commit of scopedChanges) {
                    // Padding
                    if (multiline) {
                        output += '    '
                    }
                    output += '- '

                    // Feat icon
                    if (commit.type === 'feat') {
                        output += `${featureSubjectIcon()} `
                    }

                    // Scope prefix
                    if (scope !== null && !multiline) {
                        output += `${scope}: `
                    }

                    // Description
                    output += `${capitalizeSentences(commit.description)}`

                    // Breaking
                    if (commit.breaking) {
                        output += ` (${iconFor('breaking')} BREAKING)`
                    }
                    // Body Footnote Link
                    if (commit.body) {
                        output += `[^${footnotesCount}]`
                        const footnote = commit.body.replace(/\n/g, '').trim()
                        footnotesOutput += `[^${footnotesCount}]: ${capitalizeSentences(footnote)}\n`
                        footnotesCount += 1
                    }

                    // Footer keys
                    if (commit.footers) {
                        output += ' ('
                        let first = true
                        for (const [key, value] of commit.footers) {
                            if (!first) {
                                output += ', '
                            }
                            first = false
                            if (value.startsWith('#')) {
                                output += `${key} ${value}`
                            } else {
                                output += `${key}: ${value}`
                            }
                        }
                        output += ')'
                    }

                    // Commit ids
                    if (args.link_commits) {
                        for (const h of [commit.hash, ...commit.extra_hashes]) {
                            output += ` [${h.slice(0, 7)}](${repoUrl}/commit/${h})`
                        }
                    } else {
                        for (const h of [commit.hash, ...commit.extra_hashes]) {
                            output += ` ${h.slice(0, 7)}`
                        }
                    }

                    // Thanks
                    if (args.thank_non_regular) {
                        const relatedUsernames = []
                        if (commit.gh_username !== null) {
                            relatedUsernames.push(commit.gh_username)
                        }
                        if (commit.gh_issue_username !== null && commit.gh_issue_username !== commit.gh_username) {
                            relatedUsernames.push(commit.gh_issue_username)
                        }
                        const thankList = relatedUsernames.filter(username => !authors[username].is_regular).map(username => `@${username}`)
                        if (thankList.length > 0) {
                            output += ` (thanks ${thankList.join(', ')})`
                        }
                    }
                    output += '\n'
                }
            }
        }
    }

    // Output parent release
    if (parentRelease) {
        output += '\n'
        output += '> Parent release: '
        if (repoUrl !== null && parentRelease.tag) {
            output += `[${parentRelease.tag}](${repoUrl}/releases/tag/${parentRelease.tag})`
        } else if (parentRelease.tag) {
            output += `> Parent release: ${parentRelease.tag}`
        }
        output += ` ${parentRelease.hash.slice(0, 7)}\n`
    }

    // Output footnotes
    if (footnotesOutput) {
        output += '\n'
        output += footnotesOutput
    }

    fnlog('CHANGELOG Contents:\n', output)

    return {output, footnotesOutput}
}

function writeChangelog(outputPath, output) {
    const absolutePath = path.resolve(outputPath)
    fs.writeFileSync(absolutePath, output)
}

async function main(inputs) {
    function fnlog(msg) {
        trace_commands.log('create-changelog: ' + msg)
    }

    core.startGroup('🧩 Adjusting parameters')
    await adjustParameters(inputs)
    // Print a table with the parameters
    for (const [name, value] of Object.entries(inputs)) {
        fnlog(`🧩 ${name.replaceAll('_', '-')} = ${JSON.stringify(value)}`)
    }
    core.endGroup()

    core.startGroup('🏷️ Identifying tags')
    let tags = await processTags(inputs.source_dir, inputs.tag_pattern, inputs.repoUrl, inputs.access_token)
    core.endGroup()

    core.startGroup('📜 Identifying commits')
    let commits = await processCommits(
        inputs.source_dir,
        inputs.repoUrl,
        inputs.version_pattern,
        tags,
        inputs.repo_branch,
        inputs.access_token,
        inputs.check_unconventional)

    // Limit the number of commits
    if (inputs.limit && commits.length > inputs.limit) {
        commits = commits.slice(0, inputs.limit)
        console.log(`Limited to ${inputs.limit} commits`)
    }
    core.endGroup()

    core.startGroup('👤 Populating GitHub usernames')
    await populateGithubUsernames(commits, inputs.access_token)
    core.endGroup()

    // Populate issue data
    core.startGroup('🔗 Populating issue data')
    const authors = await populateIssueData(commits, inputs.repoUrl, inputs.repoOwner, inputs.access_token)
    core.endGroup()

    // Identify non-regular contributors
    core.startGroup('👥 Identifying non-regular contributors')
    identifyNonRegularContributors(authors)
    core.endGroup()

    // Categorize commits
    core.startGroup('📦 Categorizing commits')
    const {changes, changeTypePriority, parentRelease} = categorizeCommits(commits)
    core.endGroup()

    // Generate output
    core.startGroup('📄 Generating output')
    const {
        output,
        footnotesOutput
    } = generateOutput(changes, changeTypePriority, inputs, inputs.repoUrl, authors, parentRelease)
    core.endGroup()

    // Write file
    core.startGroup('📝 Writing changelog')
    writeChangelog(inputs.output_path, output)
    core.endGroup()

    if (inputs.update_summary) {
        core.startGroup('📝 Updating summary')
        try {
            await core.summary
                .addRaw(`# Changelog\n\n${output}`)
                .write()
            fnlog('Summary written successfully.')
        } catch (error) {
            core.setFailed(`Failed to write summary: ${error.message}`)
        }
        core.endGroup()
    }
}

function toIntegerInput(input) {
    const parsedInt = parseInt(input)
    if (isNaN(parsedInt)) {
        return undefined
    } else {
        return parsedInt
    }
}

function normalizePath(path) {
    const pathIsString = typeof path === 'string' || path instanceof String
    if (pathIsString && process.platform === 'win32') {
        return path.replace(/\\/g, '/')
    }
    return path
}

async function run() {
    function fnlog(msg) {
        trace_commands.log('create-changelog: ' + msg)
    }

    try {
        let inputs = {
            // Configure options
            source_dir: normalizePath(core.getInput('source-dir')),
            version_pattern: new RegExp(core.getInput('version-pattern')),
            tag_pattern: new RegExp(core.getInput('tag-pattern')),
            output_path: normalizePath(core.getInput('output-path')),
            limit: toIntegerInput(core.getInput('limit')),
            thank_non_regular: core.getBooleanInput('thank-non-regular'),
            check_unconventional: core.getBooleanInput('check-unconventional'),
            link_commits: core.getBooleanInput('link-commits'),
            github_token: core.getInput('github-token'),
            update_summary: core.getBooleanInput('update-summary'),
            trace_commands: core.getBooleanInput('trace-commands')
        }

        // Resolve paths
        inputs.source_dir = path.resolve(inputs.source_dir)
        // output path, if relative, is relative to the source directory
        inputs.output_path = path.resolve(inputs.source_dir, inputs.output_path)

        // Set trace_commands when in debug mode or when
        // the user explicitly sets it to true.
        // This enables the log() function to print to the console.
        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        // Print a summary of the inputs
        core.startGroup('📥 Workflow Inputs')
        fnlog(`🧩 create-changelog.trace_commands: ${trace_commands}`)
        for (const [name, value] of Object.entries(inputs)) {
            core.info(`🧩 ${name.replaceAll('_', '-')}: ${JSON.stringify(value)}`)
        }
        core.endGroup()

        try {
            await main(inputs)
        } catch (error) {
            // Print stack trace
            fnlog(error.stack)
            // Print error message
            core.error(error)
            core.setFailed(error.message)
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.setFailed(error)
    })
}

module.exports = {
    Commit,
    GitHubUser,
    getCurrentBranch,
    getGithubRemote,
    getGithubRepoOwner,
    getGithubRepoName,
    adjustParameters,
    getLocalTags,
    getGithubTags,
    removeTagDuplicates,
    processTags,
    populateConventional,
    getLocalCommits,
    removeCommitDuplicates,
    getGithubCommits,
    processCommits,
    getGithubProfileName,
    getGithubUsername,
    populateGithubUsernames,
    checkGithubAdminPermissions,
    checkUserInstitution,
    populateIssueData,
    calculatePercentile,
    identifyNonRegularContributors,
    iconFor,
    featureSubjectIcon,
    capitalizeSentences,
    categorizeCommits,
    generateOutput,
    writeChangelog,
    toIntegerInput,
    normalizePath,
    run,
    main
}
