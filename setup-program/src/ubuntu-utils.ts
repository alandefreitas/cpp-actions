/**
 * Ubuntu version detection utilities for setup-program action.
 *
 * @module ubuntu-utils
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as traceCommands from 'trace-commands';
import ubuntuVersionNames from '../ubuntu-versions.json';

/**
 * Retrieves the current Ubuntu version from /etc/os-release.
 *
 * @returns Ubuntu version string (e.g., "22.04") or null if not Ubuntu/not found
 */
export function getCurrentUbuntuVersion(): string | null {
    try {
        const osReleaseData = fs.readFileSync('/etc/os-release', 'utf8');
        const lines = osReleaseData.split('\n');
        const versionLine = lines.find(line => line.startsWith('VERSION_ID='));
        if (versionLine) {
            return versionLine.split('=')[1].replace(/"/g, '');
        }
        core.debug('Ubuntu version not found');
        return null;
    } catch {
        core.debug('Error reading /etc/os-release');
        return null;
    }
}

/**
 * Retrieves the Ubuntu release codename for the current version.
 *
 * Maps version numbers (e.g., "22.04") to codenames (e.g., "jammy").
 *
 * @returns Ubuntu codename or null if version not recognized
 */
export function getCurrentUbuntuName(): string | null {
    const version = getCurrentUbuntuVersion();
    if (version) {
        // look for "version" key in "ubuntuVersionNames"
        for (const [key, value] of Object.entries(ubuntuVersionNames)) {
            if (version.startsWith(key) || key.startsWith(version)) {
                return value;
            }
        }
    }
    traceCommands.log(`setup-program::getCurrentUbuntuName: Ubuntu name for version ${version} not supported`);
    return null;
}
