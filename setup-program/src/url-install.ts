/**
 * URL-based program installation for setup-program action.
 *
 * @module url-install
 */

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import { type ProgramResult } from './types';

import {
    renderTemplate,
    getRunnerOs
} from './utils';

import {
    getAllSubdirectories
} from './file-utils';

import {
    downloadAndExtract,
    stripSingleDirectoryFromPath
} from './download-utils';

import {
    findProgramInPaths
} from './program-search';

import {
    moveWithPermissions
} from './system-utils';

/**
 * Downloads, extracts, and installs a program from a URL.
 *
 * Supports URL templates with placeholders like {{name}}, {{version}}, {{os}}, etc.
 * After extraction, searches for the executable and optionally updates PATH.
 *
 * @param names - Array of executable names to search for after installation
 * @param version - Version string used for template rendering and caching
 * @param checkLatest - If true, prefer latest matching version when searching
 * @param urlTemplate - URL or URL template for the archive download
 * @param updateEnvironment - If true, adds installation directories to PATH
 * @param installPrefix - Optional custom installation directory (uses tool cache if null)
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function installProgramFromUrl(
    names: string[],
    version: string,
    checkLatest: boolean,
    urlTemplate: string,
    updateEnvironment: boolean,
    installPrefix: string | null): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('installProgramFromUrl');

    let outputVersion: string | null = null;
    let outputPath: string | null = null;

    // Render URL template
    const coercedVersion = semver.coerce(version) || semver.coerce('0.0.0');
    if (!coercedVersion) {
        return { outputVersion, outputPath };
    }
    let url = urlTemplate;
    const mayBeTemplate = url.includes('{{');
    if (mayBeTemplate) {
        const context: Record<string, string | number> = {
            name: names[0],
            platform: process.platform,
            arch: process.arch,
            os: getRunnerOs().toLowerCase(),
            version: coercedVersion.toString(),
            major: coercedVersion.major,
            minor: coercedVersion.minor,
            patch: coercedVersion.patch
        };
        // Convert data to JSON string
        url = renderTemplate(url, context);
        if (urlTemplate !== url) {
            fnlog(`Template data: ${JSON.stringify(context)}`);
            fnlog(`Template "${urlTemplate}" rendered as "${url}"`);
        }
    }

    // Download and extract archive to temporary directory
    const extPath = await downloadAndExtract(url);
    fnlog(`Downloaded and extracted ${url} to ${extPath}`);
    if (!extPath) {
        return { outputVersion, outputPath };
    }

    // Strip single directory from the path if that's the case
    fnlog(`Stripping single directory from ${extPath}`);
    const stripped = await stripSingleDirectoryFromPath(extPath);
    if (stripped) {
        fnlog(`Stripped single directory from ${extPath}`);
    } else {
        fnlog(`No single directory to strip from ${extPath}`);
    }

    // Create environment variable <tool name>_ROOT with the installation path
    for (const name of names) {
        const envVarName = `${name.toUpperCase()}_ROOT`;
        core.exportVariable(envVarName, extPath);
    }

    // Install to prefix or to cache directory
    let finalInstallPrefix: string;
    if (installPrefix) {
        fnlog(`Moving ${extPath} to ${installPrefix}`);
        const moveOk = await moveWithPermissions(extPath, installPrefix);
        if (!moveOk) {
            fnlog(`Failed to move ${extPath} to ${installPrefix}. Aborting.`);
            return { outputVersion, outputPath };
        }
        finalInstallPrefix = installPrefix;
    } else {
        // Cache
        finalInstallPrefix = await tc.cacheDir(extPath, names[0], coercedVersion.toString());
        fnlog(`Caching ${names[0]} in ${finalInstallPrefix}`);
    }

    fnlog(`Installed in ${finalInstallPrefix}`);
    if (updateEnvironment) {
        core.addPath(finalInstallPrefix);
        const binPath = path.join(finalInstallPrefix, 'bin');
        if (fs.existsSync(binPath)) {
            core.addPath(binPath);
        }
    }

    // Recursively iterate subdirectories of extPath looking for ${name} executable
    fnlog(`Looking for ${names.join(', ')} binary in ${extPath} subdirectories`);
    const installPrefixSubdirectories = [finalInstallPrefix, path.join(finalInstallPrefix, 'bin')].concat(getAllSubdirectories(finalInstallPrefix));
    fnlog(`Looking for ${names.join(', ')} binary in installed ${finalInstallPrefix} subdirectories`);
    const result = await findProgramInPaths(installPrefixSubdirectories, names, '*', checkLatest, true);
    if (result.outputPath) {
        fnlog(`Found ${names.join(', ')} binary in ${result.outputPath}`);
    }
    outputVersion = result.outputVersion;
    outputPath = result.outputPath;

    return { outputVersion, outputPath };
}
