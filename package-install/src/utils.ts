/**
 * Utility functions for package-install action.
 *
 * @module utils
 */

import * as crypto from 'crypto';
import * as exec from '@actions/exec';
import * as semver from 'semver';

/**
 * Generates a UUID v4 string.
 *
 * @returns A randomly generated UUID v4 string
 */
export function uuidV4(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const buffer = crypto.randomBytes(16);
    buffer[6] = (buffer[6] & 0x0f) | 0x40;
    buffer[8] = (buffer[8] & 0x3f) | 0x80;
    const hex = buffer.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted time string (e.g., "500ms", "2.5s", "1.5m")
 */
export function formatTime(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    if (ms < 1000 * 60) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${(ms / 1000 / 60).toFixed(1)}m`;
}

/**
 * Computes SHA1 hash of a string.
 *
 * @param input - String to hash
 * @returns Hexadecimal SHA1 hash string
 */
export function sha1sum(input: string): string {
    const hash = crypto.createHash('sha1');
    hash.update(input);
    return hash.digest('hex');
}

/**
 * Escapes a file path for safe use in shell commands.
 *
 * Adds quotes around paths containing whitespace or slashes.
 *
 * @param pathStr - Path string to escape
 * @returns Escaped path string
 */
export function escapePath(pathStr: string): string {
    // If there are no whitespaces or slashes (forwards or backwards), then
    // we don't need to quote the path.
    if (!pathStr.match(/[\\\/\s]/)) {
        return pathStr;
    }
    // Escape quotes
    pathStr = pathStr.replaceAll('"', '\\"');
    // Quote the path
    pathStr = `"${pathStr}"`;
    return pathStr;
}

/**
 * Checks if the given path is an MSVC compiler executable (cl.exe).
 *
 * @param executablePath - Path to check
 * @returns True if the path ends with cl.exe
 */
export function isMSVCCompilerExecutable(executablePath: string): boolean {
    if (!executablePath) {
        return false;
    }
    const normalized = executablePath.replace(/[\/]+/g, '/').toLowerCase();
    return normalized.endsWith('/cl.exe');
}

/**
 * Reads the version output from a compiler executable.
 *
 * Uses /Bv flag for MSVC, --version for other compilers.
 *
 * @param executablePath - Path to the compiler executable
 * @returns Compiler version output string
 */
export async function readCompilerVersion(executablePath: string): Promise<string> {
    if (!executablePath) {
        return '';
    }
    const args = isMSVCCompilerExecutable(executablePath) ? ['/Bv'] : ['--version'];
    const result = await exec.getExecOutput(escapePath(executablePath), args, {ignoreReturnCode: true});
    return result.stdout.trim();
}

/**
 * Compare versions that may not be valid semver (e.g., four-part or distro-suffixed).
 * Falls back to numeric component comparison when semver parsing fails.
 *
 * @param version - Version string to compare (can be non-standard semver)
 * @param threshold - Minimum version threshold to compare against
 * @returns True if version is greater than or equal to threshold
 */
export function semverGteLoose(version: string, threshold: string): boolean {
    const normalize = (v: string): string | null => semver.valid(v) || semver.valid(semver.coerce(v));
    const vNorm = normalize(version);
    const tNorm = normalize(threshold);
    const hasExtraSegments = (v: string): boolean => v.split('.').length > 3;
    if (vNorm && tNorm && !hasExtraSegments(version) && !hasExtraSegments(threshold)) {
        return semver.gte(vNorm, tNorm);
    }

    const toNumericParts = (v: string): number[] => v.split(/[^0-9]+/).filter(Boolean).map(Number);
    // Fallback: lexicographically compare numeric components to tolerate non-semver strings.
    const vParts = toNumericParts(version);
    const tParts = toNumericParts(threshold);
    const len = Math.max(vParts.length, tParts.length);
    for (let i = 0; i < len; i++) {
        const a = vParts[i] || 0;
        const b = tParts[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return true;
}
