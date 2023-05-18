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


class Commit:
    def __init__(self):
        self.hash = None
        self.author = None
        self.date = None
        self.subject = None
        self.type = None
        self.scope = None
        self.description = None
        self.body = ''
        self.footers = []
        self.breaking = False


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


if __name__ == "__main__":
    # Args
    parser = argparse.ArgumentParser(description='Installs the dependencies needed to test a Boost library.')
    parser.add_argument('--dir', help="directory to scan", default=os.getcwd())
    parser.add_argument('--version-pattern', help="regex pattern indicating a version commit",
                        default='(Bump|Set)\s+version')
    parser.add_argument('--tag-pattern', help="regex indicating a tagged commit",
                        default='v.*\..*\..*')
    parser.add_argument('-o', '--output', help="output file", default='CHANGELOG.md')
    parser.add_argument('--limit', type=int, help="max number of commits in the log", default=0)
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
        matches = re.findall(tag_pattern, tag)
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
            matches = re.findall(tag_pattern, tag)
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
                delimiter_commit_id = commit.hash
                break
        if commit.hash and not commit.author and line.startswith('Author: '):
            commit.author = line[len('Author: '):]
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
                    matches = re.findall(version_pattern, commit.subject)
                    if matches:
                        break
                m = re.match(r'([ \d\w_-]+)(\(([ \d\w_-]+)\))?(!?): ([^\n]*)\n?(.*)', msg)
                if m:
                    commit.type = normalize_type(m[1])
                    commit.scope = m[3]
                    commit.description = m[5]
                    commit.breaking = m[4] == '!'
                else:
                    # regular commit
                    commit.description = commit.subject
                    commit.type = 'other'
                    commit.scope = None
                    commit.breaking = commit.subject.find('BREAKING') != -1
            else:
                # Is body or footer
                m = re.match(r'(([^ ]): )|(([^ ]) #)|(BREAKING CHANGE)', msg)
                if m:
                    # is footer
                    if m[1]:
                        commit.footers.append((m[2], msg[len(m[2]) + 2:].strip()))
                    elif m[3]:
                        commit.footers.append((m[4], msg[len(m[4]) + 1:].strip()))
                    elif m[5]:
                        commit.footers.append((m[5], msg[len(m[5]) + 1:].strip()))
                    if commit.footers[-1][0].lower().startswith('breaking'):
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


    def good_icon():
        icon = [
            '✨',
            '💫',
            '🌟',
        ][good_icon.count % 3]
        good_icon.count += 1
        return icon


    good_icon.count = 0


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
            for [scope, commits] in scope_changes.items():
                scope_prefix = ''
                multiline = scope is not None and len(commits) > 1
                if multiline:
                    output += f'- {scope}:\n'
                for commit in commits:
                    # Padding
                    if multiline:
                        output += '    '
                    output += '- '
                    # Feat icon
                    if commit.type == 'feat':
                        output += f'{good_icon()} '
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
                    # Commit id
                    output += f' {commit.hash}'
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
