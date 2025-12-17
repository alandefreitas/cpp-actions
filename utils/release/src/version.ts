/**
 * Version calculation and validation utilities.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { askChoice, askInput } from './prompt';

/**
 * Semver version components.
 */
export interface SemverVersion {
    major: number;
    minor: number;
    patch: number;
}

/**
 * Validates that a string is a valid semver version tag.
 * @param tag - The tag to validate (with or without 'v' prefix)
 * @returns True if valid semver format
 */
export function isValidSemver(tag: string): boolean {
    const normalized = tag.startsWith('v') ? tag.slice(1) : tag;
    return /^\d+\.\d+\.\d+$/.test(normalized);
}

/**
 * Normalizes a version string to include 'v' prefix.
 * @param version - The version string
 * @returns Normalized version with 'v' prefix
 */
export function normalizeTag(version: string): string {
    return version.startsWith('v') ? version : `v${version}`;
}

/**
 * Extracts the version without 'v' prefix.
 * @param tag - The version tag
 * @returns Version string without 'v' prefix
 */
export function extractVersion(tag: string): string {
    return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * Parses a semver string into components.
 * @param version - The version string (with or without 'v' prefix)
 * @returns Parsed version components
 */
export function parseSemver(version: string): SemverVersion {
    const normalized = extractVersion(version);
    const [major, minor, patch] = normalized.split('.').map(Number);
    return { major, minor, patch };
}

/**
 * Formats semver components as a version string.
 * @param version - The version components
 * @param includeV - Whether to include 'v' prefix
 * @returns Formatted version string
 */
export function formatSemver(version: SemverVersion, includeV = true): string {
    const str = `${version.major}.${version.minor}.${version.patch}`;
    return includeV ? `v${str}` : str;
}

/**
 * Compares two semver strings.
 * @param a - First version (with or without 'v')
 * @param b - Second version (with or without 'v')
 * @returns 1 if a>b, -1 if a<b, 0 if equal
 */
export function compareSemver(a: string, b: string): number {
    const va = parseSemver(a);
    const vb = parseSemver(b);

    if (va.major !== vb.major) return Math.sign(va.major - vb.major);
    if (va.minor !== vb.minor) return Math.sign(va.minor - vb.minor);
    return Math.sign(va.patch - vb.patch);
}

/**
 * Reads the root package.json version if available.
 * @param cwd - Working directory
 * @returns Version with 'v' prefix or null if unavailable/invalid
 */
export function getPackageVersion(cwd: string): string | null {
    try {
        const pkgPath = path.join(cwd, 'package.json');
        const contents = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(contents);
        const version = typeof pkg.version === 'string' ? pkg.version : null;

        if (version && isValidSemver(version)) {
            return normalizeTag(version);
        }
    } catch {
        // Ignore read/parse errors and fall back to git tags
    }

    return null;
}

/**
 * Gets the latest tag from the remote repository.
 * @param cwd - Working directory
 * @returns The latest semver tag or null if none found
 */
export function getLatestTag(cwd: string): string | null {
    try {
        const output = execSync('git ls-remote --tags origin', {
            cwd,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const tags: string[] = [];
        for (const line of output.split('\n')) {
            const match = line.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/);
            if (match) {
                tags.push(match[1]);
            }
        }

        if (tags.length === 0) {
            return null;
        }

        // Sort by semver descending
        tags.sort((a, b) => {
            const va = parseSemver(a);
            const vb = parseSemver(b);
            if (va.major !== vb.major) return vb.major - va.major;
            if (va.minor !== vb.minor) return vb.minor - va.minor;
            return vb.patch - va.patch;
        });

        return tags[0];
    } catch {
        return null;
    }
}

/**
 * Gets feature commits since the given tag.
 * @param tag - The tag to compare against
 * @param cwd - Working directory
 * @returns Array of feature commit messages
 */
export function getFeatureCommitsSince(tag: string, cwd: string): string[] {
    try {
        const output = execSync(`git log --format=%s ${tag}..HEAD`, {
            cwd,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        return output
            .split('\n')
            .filter(line => /^feat(\(|:)/.test(line))
            .filter(line => line.trim() !== '');
    } catch {
        return [];
    }
}

/**
 * Determines the next version based on the latest tag and prompts user if needed.
 * @param cwd - Working directory
 * @returns Promise resolving to the selected version tag
 */
export async function determineVersion(cwd: string): Promise<string> {
    const latestTag = getLatestTag(cwd);
    const packageVersion = getPackageVersion(cwd);

    if (packageVersion) {
        if (!latestTag || compareSemver(packageVersion, latestTag) >= 1) {
            const latestLabel = latestTag ?? 'no remote tag';
            console.log(`Detected local version ${packageVersion} (latest tag: ${latestLabel}).`);
            console.log('Using package.json version without suggesting an additional bump.');
            return packageVersion;
        }
    }

    if (!latestTag) {
        console.log('No existing tags found on origin. Defaulting to initial release tag v0.1.0.');
        const input = await askInput('Enter desired tag (press enter to accept v0.1.0)', 'v0.1.0');
        return normalizeTag(input);
    }

    const current = parseSemver(latestTag);
    const patchBump = formatSemver({
        ...current,
        patch: current.patch + 1
    });
    const minorBump = formatSemver({
        major: current.major,
        minor: current.minor + 1,
        patch: 0
    });

    const featureCommits = getFeatureCommitsSince(latestTag, cwd);

    if (featureCommits.length > 0) {
        console.log(`\nFeature commits since ${latestTag}:`);
        for (const commit of featureCommits) {
            console.log(`  - ${commit}`);
        }
        console.log('');

        const choice = await askChoice('Select version bump:', [
            { label: minorBump, description: 'Minor bump (includes features)' },
            { label: patchBump, description: 'Patch bump' },
            { label: 'Custom', description: 'Enter custom version' }
        ], 2); // Default to patch

        if (choice === 2) {
            const custom = await askInput('Enter custom tag (vX.Y.Z)');
            return normalizeTag(custom);
        }

        return choice === 0 ? minorBump : patchBump;
    } else {
        console.log(`\nNo feature commits detected since ${latestTag}.`);
        console.log(`Suggested tag: ${patchBump}`);

        const confirmed = await askInput(`Is this appropriate? (y/n or enter custom tag)`, 'y');

        if (confirmed.toLowerCase() === 'y' || confirmed.toLowerCase() === 'yes') {
            return patchBump;
        } else if (confirmed.toLowerCase() === 'n' || confirmed.toLowerCase() === 'no') {
            const custom = await askInput('Please enter the desired tag');
            return normalizeTag(custom);
        } else {
            // User entered a custom tag directly
            return normalizeTag(confirmed);
        }
    }
}
