/**
 * Git repository utilities for setup-program action.
 *
 * Provides functions for fetching tags, extracting versions from tags,
 * and cloning repositories.
 *
 * @module git-utils
 */

import * as io from '@actions/io';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as semver from 'semver';
import * as traceCommands from 'trace-commands';
import gccDefaultTags from '../gcc-tags.json';
import clangDefaultTags from '../clang-tags.json';
import cmakeDefaultTags from '../cmake-tags.json';

import { type ExecOutput } from './types';

import { sleep } from './utils';

import {
    readVersionsFromFile,
    saveVersionsToFile
} from './version-cache';

import {
    updateAptPackageLists,
    installProgramWithApt,
    findProgramWithApt
} from './apt-utils';

/**
 * Options for fetching Git tags from a repository.
 */
export interface FetchGitTagsOptions {
    maxRetries?: number;
    defaultTags?: string[];
}

/**
 * Options for cloning a Git repository.
 */
export interface CloneGitRepoOptions {
    shallow?: boolean;
}

/**
 * Locates or installs Git on the system.
 *
 * First attempts to find Git in PATH. If not found on Linux, installs it via APT.
 *
 * @returns Path to the Git executable, or null if not found/installed
 */
export async function findGit(): Promise<string | null> {
    let gitPath: string;
    try {
        gitPath = await io.which('git');
    } catch {
        gitPath = '';
    }
    if (gitPath === '') {
        // Try to install git via APT
        await updateAptPackageLists();
        await installProgramWithApt('git', null, [], { tryAptitude: false, tryAlternatives: false });
        try {
            gitPath = await io.which('git');
        } catch {
            return null;
        }
    }
    return gitPath || null;
}

/**
 * Fetches all tags from a Git repository.
 *
 * Uses `git ls-remote --tags` to retrieve tags without cloning the entire repository.
 * Implements exponential backoff retry logic for transient network failures.
 *
 * @param repo - Git repository URL (e.g., "https://github.com/llvm/llvm-project")
 * @param options - Configuration options for retries and fallback tags
 * @returns Array of tag reference strings (e.g., ["refs/tags/v1.0.0"])
 * @throws Error if max retries reached and no default tags provided
 */
export async function fetchGitTags(repo: string, options: FetchGitTagsOptions = {}): Promise<string[]> {
    const { maxRetries = 10, defaultTags = [] } = options;
    try {
        // Find git in PATH
        let gitPath: string | null = null;
        try {
            gitPath = await findGit();
        } catch {
            gitPath = null;
        }
        // Install git if we have to
        if (!gitPath) {
            await findProgramWithApt(['git'], '*', true);
            gitPath = await findGit();
        }
        // Still no git? Fail
        if (!gitPath) {
            if (defaultTags.length > 0) {
                return defaultTags;
            }
            throw new Error('Git not found');
        }
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const args = ['ls-remote', '--tags', repo];
                const {
                    exitCode, stdout
                }: ExecOutput = await exec.getExecOutput(`"${gitPath}"`, args, { silent: true });
                if (exitCode !== 0) {
                    throw new Error('Git exited with non-zero exit code: ' + exitCode);
                }
                const stdoutTrimmed = stdout.trim();
                const tags = stdoutTrimmed.split('\n').filter(tag => tag.trim() !== '');
                const gitTags: string[] = [];
                for (const tag of tags) {
                    const parts = tag.split('\t');
                    if (parts.length > 1) {
                        const ref = parts[1];
                        if (!ref.endsWith('^{}')) {
                            gitTags.push(ref);
                        }
                    }
                }
                traceCommands.log('Git tags: ' + gitTags);
                return gitTags;
            } catch (error) {
                if (attempt < maxRetries) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    traceCommands.log('Error fetching Git tags: ' + errorMessage);
                    traceCommands.log(`Attempt ${attempt} of ${maxRetries}`);
                    // Exponential backoff
                    const delay = Math.max(60000, Math.pow(2, attempt - 1) * 1000);
                    traceCommands.log(`Retrying in ${delay} milliseconds...`);
                    await sleep(delay);
                } else {
                    if (defaultTags.length > 0) {
                        traceCommands.log('Using default tags: ' + defaultTags);
                        return defaultTags;
                    } else {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        throw new Error('Max retries reached. Error fetching Git tags: ' + errorMessage);
                    }
                }
            }
        }
        return defaultTags;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error('Error fetching Git tags: ' + errorMessage);
    }
}

/**
 * Extracts version numbers from Git repository tags.
 *
 * First checks for cached versions in a local file. If not found, fetches tags
 * from the repository and extracts versions using the provided regex pattern.
 * Results are cached to the file for future use.
 *
 * @param name - Human-readable name for logging (e.g., "GCC", "Clang")
 * @param repo - Git repository URL to fetch tags from
 * @param file - Cache filename to store/retrieve versions
 * @param regex - Regular expression with capture group for version extraction
 * @param defaultTags - Fallback tags if fetching fails
 * @returns Array of version strings sorted by semver
 */
export async function findVersionsFromTags(name: string, repo: string, file: string, regex: RegExp, defaultTags: string[] = []): Promise<string[]> {
    const versionsFromFile = readVersionsFromFile(file);
    if (versionsFromFile !== null) {
        traceCommands.log(`${name} versions (from file): ` + versionsFromFile);
        return versionsFromFile;
    }
    const tags = await fetchGitTags(repo, {
        maxRetries: 3,
        defaultTags
    });
    let versions: string[] = [];
    for (const tag of tags) {
        if (tag.match(regex)) {
            const match = tag.match(regex);
            if (match && match[1]) {
                const version = match[1];
                versions.push(version);
            }
        }
    }
    versions = versions.sort(semver.compare);
    traceCommands.log(`${name} versions: ` + versions);
    saveVersionsToFile(versions, file);
    return versions;
}

/**
 * Retrieves available GCC compiler versions from the official GCC Git repository.
 *
 * @returns Array of GCC version strings (e.g., ["10.3.0", "11.2.0", "12.1.0"])
 */
export async function findGCCVersions(): Promise<string[]> {
    return await findVersionsFromTags(
        'GCC',
        'git://gcc.gnu.org/git/gcc.git',
        'gcc-versions.txt',
        /^refs\/tags\/releases\/gcc-(\d+\.\d+\.\d+)$/,
        gccDefaultTags);
}

/**
 * Retrieves available Clang compiler versions from the LLVM GitHub repository.
 *
 * @returns Array of Clang version strings (e.g., ["14.0.0", "15.0.0", "16.0.0"])
 */
export async function findClangVersions(): Promise<string[]> {
    return await findVersionsFromTags(
        'Clang',
        'https://github.com/llvm/llvm-project',
        'clang-versions.txt',
        /^refs\/tags\/llvmorg-(\d+\.\d+\.\d+)$/,
        clangDefaultTags);
}

/**
 * Retrieves available CMake versions from the Kitware GitHub repository.
 *
 * @returns Array of CMake version strings (e.g., ["3.24.0", "3.25.0", "3.26.0"])
 */
export async function findCMakeVersions(): Promise<string[]> {
    return await findVersionsFromTags(
        'CMake',
        'https://github.com/Kitware/CMake.git',
        'cmake-versions.txt',
        /^refs\/tags\/v(\d+\.\d+\.\d+)$/,
        cmakeDefaultTags);
}

/**
 * Clones a Git repository to a local directory.
 *
 * Supports cloning by branch/tag name or by commit hash. When cloning by hash,
 * uses init/fetch/checkout workflow instead of direct clone.
 *
 * @param repo - Git repository URL to clone
 * @param destPath - Local directory path for the cloned repository
 * @param ref - Optional branch, tag, or commit hash to checkout
 * @param options - Clone options (shallow clone by default)
 * @throws Error if Git is not available or cloning fails
 */
export async function cloneGitRepo(repo: string, destPath: string, ref: string | undefined = undefined, options: CloneGitRepoOptions = { shallow: true }): Promise<void> {
    try {
        const gitPath = await findGit();
        if (!gitPath) {
            throw new Error('Git not found');
        }
        // Clean the destPath
        if (fs.existsSync(destPath)) {
            await io.rmRF(destPath);
        }

        const refIsHash = ref ? /^[0-9a-f]{40}$/.test(ref) : false;
        if (!refIsHash) {
            // Clone the repository with the specified reference
            const args: string[] = [];
            args.push('clone');
            args.push(repo);
            args.push(destPath);
            if (options.shallow) {
                args.push('--depth');
                args.push('1');
            }
            if (ref) {
                args.push('--branch');
                args.push(ref);
            }
            await exec.exec(`"${gitPath}"`, args);
        } else {
            // Reference is a commit hash: init and checkout
            await io.rmRF(destPath);
            await io.mkdirP(destPath);
            await exec.exec(`"${gitPath}"`, ['config', '--global', 'init.defaultBranch', 'master'], { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['config', '--global', 'advice.detachedHead', 'false'], { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['init'], { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['remote', 'add', 'origin', repo], { cwd: destPath });
            const args: string[] = ['fetch'];
            if (options.shallow) {
                args.push('--depth');
                args.push('1');
            }
            args.push('origin');
            if (ref) {
                args.push(ref);
            }
            await exec.exec(`"${gitPath}"`, args, { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['checkout', 'FETCH_HEAD'], { cwd: destPath });
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error('Error cloning Git repository: ' + errorMessage);
    }
}
