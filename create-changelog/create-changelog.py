#
# Copyright (c) 2023 Alan de Freitas (alandefreitas@gmail.com)
#
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
#
import argparse
import os
import subprocess
import re
import json
import requests


class Commit:
    def __init__(self):
        self.hash = None
        self.author = None
        self.author_name = None
        self.author_email = None
        self.gh_name = None
        self.gh_username = None
        self.date = None
        self.subject = None
        self.type = None
        self.scope = None
        self.description = None
        self.body = ''
        self.footers = []
        self.issue = None
        self.gh_issue_username = None
        self.breaking = False


class GitHubUser:
    def __init__(self):
        self.username = None
        self.name = None
        self.commits = 0
        self.commits_perc = 0
        self.is_owner = False
        self.is_admin = False
        self.is_affiliated = False
        self.is_regular = True


def normalize_type(s):
    # - The units of information that make up Conventional Commits MUST NOT be treated as case sensitive
    # by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
    # - BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE
    category_mapping = {
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
        'undo': 'revert',
    }
    return category_mapping.get(s.lower(), s)


def humanize(s):
    m = {
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
    if s in m:
        return m[s]
    return s


def get_github_profile_name(username):
    url = f"https://api.github.com/users/{username}"
    response = requests.get(url)

    if response.status_code == 200:
        profile_data = response.json()
        github_profile_name = profile_data.get("name")
        if github_profile_name:
            return github_profile_name
    return None


def get_github_username(email):
    url = f"https://api.github.com/search/users?q={email}+in:email"
    response = requests.get(url)

    if response.status_code == 200:
        search_results = response.json()
        items = search_results.get("items")
        if items:
            github_username = items[0].get("login")
            return github_username

    return None


def get_issue_author(repo_url, issue_number):
    # Extract the owner and repository name from the URL
    _, _, owner, repository = repo_url.rstrip('/').split('/')[-4:]

    # Make a GET request to the GitHub API to retrieve the issue information
    url = f"https://api.github.com/repos/{owner}/{repository}/issues/{issue_number}"
    response = requests.get(url)

    if response.status_code == 200:
        issue_data = response.json()
        author = issue_data['user']['login']
        return author

    return None


def get_github_remote(git_path):
    # Get the remote URL using the git command
    try:
        remote_output = subprocess.check_output("git remote -v", shell=True, stderr=subprocess.STDOUT, cwd=git_path)
    except subprocess.CalledProcessError as e:
        print(f"Failed to execute 'git remote -v' command: {e.output.decode()}")
        return None

    # Parse the output to find the GitHub remote URL
    remote_lines = remote_output.decode().strip().split('\n')
    for line in remote_lines:
        if line.startswith("origin"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].startswith("https://github.com/"):
                if parts[1].endswith('.git'):
                    parts[1] = parts[1][:-4]
                return parts[1]

    return None


def get_github_repo_owner(repo_url):
    # Remove leading "https://" or "http://" if present
    repo_url = repo_url.lstrip("https://").lstrip("http://")

    # Extract the repository owner
    if repo_url.startswith("github.com/"):
        path_parts = repo_url.split("/")
        if len(path_parts) >= 2:
            return path_parts[1]
    return None


import requests


def check_github_admin_permissions(repo_url, username, access_token):
    # Extract the repository owner and name from the URL
    _, _, _, owner, repo = repo_url.rstrip('/').split('/')

    # Prepare the API endpoint URL
    api_url = f"https://api.github.com/repos/{owner}/{repo}/collaborators/{username}/permission"

    # Set the request headers with the access token for authentication
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github.v3+json"
    }

    # Send the GET request to the API endpoint
    response = requests.get(api_url, headers=headers)

    if response.status_code == 200:
        permission_data = response.json()
        if permission_data.get("permission") == "admin":
            return True

    return False


def check_user_institution(repo_url, username, access_token):
    # Extract the repository owner from the URL
    _, _, _, owner, _ = repo_url.rstrip('/').split('/')

    # Prepare the API endpoint URL to retrieve user information
    api_url = f"https://api.github.com/users/{username}"

    # Set the authorization header with the access token
    response = None
    if access_token is not None:
        headers = {
            "Authorization": f"Bearer {access_token}"
        }
    else:
        headers = {}
    response = requests.get(api_url, headers=headers)


    if response.status_code == 200:
        user_data = response.json()
        organizations_url = user_data.get("organizations_url")

        # Retrieve all organizations using pagination
        organizations = []
        page = 1
        while True:
            orgs_url = f"{organizations_url}?page={page}&per_page=100"
            orgs_response = requests.get(orgs_url, headers=headers)
            if orgs_response.status_code == 200:
                orgs_data = orgs_response.json()
                if len(orgs_data) > 0:
                    organizations.extend(orgs_data)
                    page += 1
                else:
                    break
            else:
                break

        # Check if the repository owner is in the organizations list
        for org in organizations:
            if org.get("login") == owner:
                return True

    return False

def calculate_percentile(data, percentile):
    """
    Calculate the percentile of a list of values.

    Args:
        data (list): List of numeric values.
        percentile (float): The desired percentile (between 0 and 100).

    Returns:
        float: The calculated percentile value.
    """
    if not data:
        return 1

    sorted_data = sorted(data)
    index = (percentile / 100) * (len(sorted_data) - 1)

    if index.is_integer():
        return sorted_data[int(index)]
    else:
        lower = sorted_data[int(index)]
        upper = sorted_data[int(index) + 1]
        return lower + (index % 1) * (upper - lower)

if __name__ == "__main__":
    # Args
    parser = argparse.ArgumentParser(description='Creates a changelog from the commit history.')
    parser.add_argument('--dir', help="directory to scan", default=os.getcwd())
    parser.add_argument('--version-pattern', help="regex pattern indicating a version commit",
                        default='(Bump|Set)\s+version')
    parser.add_argument('--tag-pattern', help="regex indicating a tagged commit",
                        default='v.*\..*\..*')
    parser.add_argument('-o', '--output', help="output file", default='CHANGELOG.md')
    parser.add_argument('--limit', type=int, help="max number of commits in the log", default=0)
    parser.add_argument('--thank-non-regular', action='store_true', help="Thank non-regular contributors")
    args = parser.parse_args()

    # Parameters
    project_path = args.dir
    version_pattern = re.compile(args.version_pattern, flags=re.IGNORECASE)
    tag_pattern = re.compile(args.tag_pattern, flags=re.IGNORECASE)
    output_path = args.output

    # Get tagged commits
    tagged_commit_hashes = set()
    commit_tags = {}
    tags_result = subprocess.run(['git', 'tag', '-l'], stdout=subprocess.PIPE, cwd=project_path)
    tags_output = tags_result.stdout.decode('utf-8').splitlines()
    for tag in tags_output:
        matches = re.search(tag_pattern, tag)
        if matches:
            commit_result = subprocess.run(['git', 'rev-list', '-n', '1', tag], stdout=subprocess.PIPE,
                                           cwd=project_path)
            commit_id = commit_result.stdout.decode('utf-8').strip()
            tagged_commit_hashes.add(commit_id)
            commit_tags[commit_id] = tag
    ls_remote_result = subprocess.run(['git', 'ls-remote', '--tags'], stdout=subprocess.PIPE, cwd=project_path)
    ls_remote_output = ls_remote_result.stdout.decode('utf-8').splitlines()
    for line in ls_remote_output:
        parts = line.split()
        if len(parts) == 2 and parts[1].startswith("refs/tags/"):
            commit_id = parts[0]
            tag = parts[1].split('/')[-1]
            matches = re.search(tag_pattern, tag)
            if matches:
                tagged_commit_hashes.add(commit_id)
                commit_tags[commit_id] = tag
    print(f'{len(tagged_commit_hashes)} tagged commits')

    # Parse commit log
    result = subprocess.run(['git', '--no-pager', 'log'], stdout=subprocess.PIPE, cwd=project_path)
    commit_log_output = result.stdout.decode('utf-8').splitlines()
    commits = []
    commit = Commit()
    delimiter_commit_id = ''
    msg = ''
    for line in commit_log_output:
        if line == '':
            continue
        if line.startswith('commit ') and ' ' not in line[7:]:
            if commit.hash:
                commits.append(commit)
                commit = Commit()
            commit.hash = line[len('commit '):]
            if commits and commit.hash in tagged_commit_hashes:
                print(f'Stopping at commit id {commit.hash[:8]} (tag {commit_tags[commit.hash]})')
                delimiter_commit_id = commit.hash
                break
        if commit.hash and not commit.author and line.startswith('Author: '):
            commit.author = line[len('Author: '):]
            p = commit.author.find(' <')
            if p != -1:
                commit.author_name = commit.author[:p]
                commit.author_email = commit.author[p + 2:-1]
            continue
        if commit.author and not commit.date and line.startswith('Date: '):
            commit.date = line[len('Date: '):]
            continue
        if commit.date and line.startswith('    '):
            msg = line[4:]
            if not commit.subject:
                # Is subject
                commit.subject = msg
                if commits:
                    matches = re.search(version_pattern, commit.subject)
                    if matches:
                        print(f'Stopping at commit id {commit.hash[:8]} (subject: {commit.subject})')
                        break
                m = re.match(r'([ \d\w_-]+)(\(([ \d\w_-]+)\))?(!?): ([^\n]*)\n?(.*)', msg)
                if m:
                    commit.type = normalize_type(m[1])
                    commit.scope = m[3]
                    commit.description = m[5]
                    if commits:
                        matches = re.search(version_pattern, commit.description)
                        if matches:
                            print(f'Stopping at commit id {commit.hash[:8]} (description: {commit.description})')
                            break
                    commit.breaking = m[4] == '!'
                else:
                    # regular commit
                    commit.description = commit.subject
                    commit.type = 'other'
                    commit.scope = None
                    commit.breaking = commit.subject.find('BREAKING') != -1
            else:
                m = re.match(r'(([^ ]+): )|(([^ ]+) #)|((BREAKING CHANGE): )', msg)
                if m:
                    # is footer
                    if m[1]:
                        commit.footers.append((m[2], msg[len(m[2]) + 2:].strip()))
                    elif m[3]:
                        commit.footers.append((m[4], msg[len(m[4]) + 1:].strip()))
                    elif m[5]:
                        commit.footers.append((m[6], msg[len(m[6]) + 2:].strip()))
                    if commit.footers[-1][0].lower().startswith('breaking'):
                        commit.breaking = True
                elif msg.lower() in ['breaking', 'breaking-change', 'breaking change']:
                    # footer with no key and value
                    # the whole message is breaking change footer
                    commit.breaking = True
                else:
                    # if body
                    if not commit.body:
                        commit.body += msg
                    else:
                        commit.body += '\n' + msg
    if commit.hash and commit.subject:
        commits.append(commit)
    print(f'{len(commits)} commits')
    if args.limit:
        commits = commits[:args.limit]
        print(f'Limited to {args.limit}')

    # Populate with github usernames
    for c in commits:
        if c.gh_username is not None:
            continue
        gh_username = get_github_username(c.author_email)
        gh_name = get_github_profile_name(gh_username)
        if gh_name is not None:
            c.gh_username = gh_username
            c.gh_name = gh_name
            for c2 in commits:
                if c2.author_email == c.author_email:
                    c2.gh_username = gh_username
                    c2.gh_name = gh_name

    # Populate issue data
    issue_footer_keys = ['Close', 'Closes', 'Closed', 'close', 'closes', 'closed',
                         'Fix', 'Fixes', 'Fixed', 'fix', 'fixes', 'fixed',
                         'Resolve', 'Resolves', 'Resolved', 'resolve', 'resolves', 'resolved']
    repo_url = get_github_remote(project_path)
    owner = None
    if repo_url is not None:
        owner = get_github_repo_owner(repo_url)
    access_token = os.getenv("GITHUB_TOKEN")
    if repo_url is not None:
        for c in commits:
            for [key, value] in c.footers:
                if key in issue_footer_keys and value.startswith('#'):
                    c.issue = value[1:]
                    c.gh_issue_username = get_issue_author(repo_url, c.issue)
                    break

    # Author list
    authors = {}
    for c in commits:
        if c.gh_username is not None:
            if c.gh_username not in authors:
                authors[c.gh_username] = GitHubUser()
                authors[c.gh_username].username = c.gh_username
                authors[c.gh_username].name = c.gh_name
                authors[c.gh_username].commits = 1
                authors[c.gh_username].commits_perc = 1 / len(commits)
                if owner is not None and owner == c.gh_username:
                    authors[c.gh_username].is_owner = True
                authors[c.gh_username].is_admin = check_github_admin_permissions(repo_url, c.gh_username, access_token)
                authors[c.gh_username].is_affiliated = check_user_institution(repo_url, c.gh_username, access_token)
            else:
                authors[c.gh_username].commits += 1
                authors[c.gh_username].commits_perc = authors[c.gh_username].commits / len(commits)
        if c.gh_issue_username is not None:
            if c.gh_issue_username not in authors:
                authors[c.gh_issue_username] = GitHubUser()
                authors[c.gh_issue_username].username = c.gh_issue_username
                authors[c.gh_issue_username].name = get_github_profile_name(c.gh_issue_username)
                authors[c.gh_issue_username].commits = 0
                authors[c.gh_issue_username].commits_perc = 0.
                if owner is not None and owner == c.gh_issue_username:
                    authors[c.gh_issue_username].is_owner = True
                authors[c.gh_issue_username].is_admin = check_github_admin_permissions(repo_url, c.gh_issue_username, access_token)
                authors[c.gh_issue_username].is_affiliated = check_user_institution(repo_url, c.gh_issue_username, access_token)

    # Identify non-regular contributors
    commit_hist = [author.commits for author in authors.values()]
    commit_sum = sum(commit_hist)
    perc_80 = calculate_percentile(commit_hist, 80)
    for author in authors.values():
        # 1. Is not owner, admin, or affiliated
        if author.is_admin or author.is_affiliated or author.is_owner:
            author.is_regular = True
            continue
        # 2. Has less than 10% of commits, or
        if author.commits < commit_sum / 10:
            author.is_regular = False
            continue
        # 3. Has less than 3 of commits, or
        if author.commits <= 3:
            author.is_regular = False
            continue
        # 4. Is not among 20% top contributors
        if author.commits < perc_80:
            author.is_regular = False
            continue
        author.is_regular = True

    # Footer tokens (differentiating from body):
    # - One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a
    # word token, followed by either a :<space> or <space># separator, followed by a string value
    # (this is inspired by the git trailer convention).
    # - A footer’s token MUST use - in place of whitespace characters, e.g., Acked-by
    # (this helps differentiate the footer section from a multi-paragraph body). An exception is made
    # for BREAKING CHANGE, which MAY also be used as a token.
    # - A footer’s value MAY contain spaces and newlines, and parsing MUST terminate when the next valid
    # footer token/separator pair is observed.
    # - The footer keywords recognized by github:
    # https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue

    # Create dictionary of changes by type and scope
    changes = {}
    for c in reversed(commits):
        if c.type not in changes:
            changes[c.type] = {}
        if c.scope not in changes[c.type]:
            changes[c.type][c.scope] = []
        changes[c.type][c.scope].append(c)
    print(f'{len(changes)} change categories:')

    # Sort commit type by priority
    change_type_priority = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'build', 'test', 'ci', 'chore',
                            'release']
    for type in changes.keys():
        if type not in change_type_priority:
            change_type_priority.append(type)
    if 'other' not in change_type_priority:
        change_type_priority.append('other')


    # https://github.com/favoloso/conventional-changelog-emoji#available-emojis
    def icon_for(s):
        m = {
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
            None: '💬'
        }
        if s in m:
            return m[s]
        return s


    def feature_subject_icon():
        icon = [
            '✨',
            '💫',
            '🌟',
        ][feature_subject_icon.count % 3]
        feature_subject_icon.count += 1
        return icon


    feature_subject_icon.count = 0


    def capitalize_sentences(text: str):
        sentences = text.split('. ')
        r = ''
        for sentence in sentences:
            sentence = sentence[0].upper() + sentence[1:]
            sentence = sentence.strip()
            r += sentence
            if not sentence.endswith('.'):
                r += '. '
        return r.strip()


    # Generate output
    output = ''
    footnotes_output = ''
    footnotes_count = 1
    for change_type in change_type_priority:
        if change_type in changes:
            scope_changes = changes[change_type]
            if len(changes) > 1 or (len(changes) > 0 and change_type[0] != 'other'):
                if output:
                    output += '\n'
                output += f'## {icon_for(change_type)} {humanize(change_type)}\n\n'
            for [scope, scope_changes] in scope_changes.items():
                scope_prefix = ''
                multiline = scope is not None and len(scope_changes) > 1
                if multiline:
                    output += f'- {scope}:\n'
                for commit in scope_changes:
                    # Padding
                    if multiline:
                        output += '    '
                    output += '- '
                    # Feat icon
                    if commit.type == 'feat':
                        output += f'{feature_subject_icon()} '
                    # Scope prefix
                    if scope is not None and not multiline:
                        output += f'{scope}: '
                    # Description
                    output += f'{capitalize_sentences(commit.description)}'
                    # Breaking
                    if commit.breaking:
                        output += f' ({icon_for("breaking")} BREAKING)'
                    # Body Footnote Link
                    if commit.body:
                        output += f"[^{footnotes_count}]"
                        footnote = commit.body.replace("\n", "").strip()
                        footnotes_output += f'[^{footnotes_count}]: {capitalize_sentences(footnote)}\n'
                        footnotes_count += 1
                    # Footer keys
                    if commit.footers:
                        output += ' ('
                        first = True
                        for [key, value] in commit.footers:
                            if first:
                                first = False
                            else:
                                output += ', '
                            if value.startswith('#'):
                                output += f'{key} {value}'
                            else:
                                output += f'{key}: {value}'
                        output += ')'
                    # Commit id
                    output += f' {commit.hash[:7]}'
                    # Thanks
                    related_usernames = []
                    if commit.gh_username is not None:
                        related_usernames.append(commit.gh_username)
                    if commit.gh_issue_username is not None and commit.gh_issue_username != commit.gh_username:
                        related_usernames.append(commit.gh_issue_username)
                    thank_list = [f'@{username}' for username in related_usernames if authors[username].is_regular == False]
                    if thank_list:
                        output += f' (thanks {", ".join(thank_list)})'
                    output += '\n'

    # Output parent release
    if delimiter_commit_id in tagged_commit_hashes and delimiter_commit_id in commit_tags:
        parent_tag = commit_tags[delimiter_commit_id]
        cmd = ['git', 'config', '--get', 'remote.origin.url']
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        output += '\n'
        if result.returncode == 0:
            # Decode output and remove any trailing whitespace
            repo_url = result.stdout.strip()
            if repo_url.endswith('.git'):
                repo_url = repo_url[:-len('.git')]
            output += f'> Parent release: [{parent_tag}]({repo_url}/releases/tag/{parent_tag}) {delimiter_commit_id}\n'
        else:
            output += f'> Parent release: {parent_tag} {delimiter_commit_id}\n'

    # Output footnotes
    if footnotes_output:
        output += '\n'
        output += footnotes_output

    print(f'CHANGELOG Contents:\n', output)

    output_path = os.path.abspath(output_path)
    print(f'Generating CHANGELOG: {output_path}')
    with open(output_path, "w") as f:
        f.write(output)
