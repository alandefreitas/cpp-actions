import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as core from '@actions/core';

/**
 * Information about an installed Xcode and its Apple Clang version.
 */
export interface InstalledXcodeInfo {
    /** Absolute path to the Xcode.app bundle */
    xcodePath: string;
    /** Xcode version parsed from the directory name (e.g., "15.4") */
    xcodeVersion: string;
    /** Apple Clang version reported by xcrun clang --version (e.g., "15.0.0") */
    appleClangVersion: string;
}

/**
 * Scans /Applications/ for installed Xcode bundles and detects their Apple Clang versions.
 *
 * For each Xcode*.app found, runs `xcrun clang --version` with DEVELOPER_DIR pointed
 * at that Xcode's Developer directory, then parses the Apple Clang version from the output.
 * Broken installations (where xcrun fails) are skipped with a warning.
 *
 * @returns Array of installed Xcode info objects, sorted by Apple Clang version descending
 */
export async function scanInstalledXcodes(): Promise<InstalledXcodeInfo[]> {
    const applicationsDir = '/Applications';
    let entries: string[];
    try {
        entries = fs.readdirSync(applicationsDir);
    } catch {
        core.warning(`Cannot read ${applicationsDir}`);
        return [];
    }

    const xcodeApps = entries.filter((entry) => /^Xcode.*\.app$/.test(entry));
    const results: InstalledXcodeInfo[] = [];

    for (const app of xcodeApps) {
        const xcodePath = `${applicationsDir}/${app}`;
        const developerDir = `${xcodePath}/Contents/Developer`;

        // Parse Xcode version from directory name
        const versionMatch = app.match(/Xcode[_-]?(\d+\.\d+(?:\.\d+)?)/)
            ?? app.match(/Xcode\.app/) ;
        const xcodeVersion = versionMatch?.[1] ?? 'default';

        try {
            const { exitCode, stdout } = await exec.getExecOutput(
                'xcrun',
                ['clang', '--version'],
                {
                    env: { ...process.env, DEVELOPER_DIR: developerDir },
                    silent: true
                }
            );

            if (exitCode !== 0) {
                core.warning(`xcrun clang --version failed for ${xcodePath} (exit code ${exitCode})`);
                continue;
            }

            const clangMatch = stdout.match(/Apple clang version (\d+\.\d+\.\d+)/);
            if (!clangMatch) {
                core.warning(`Could not parse Apple Clang version from ${xcodePath}`);
                continue;
            }

            results.push({
                xcodePath,
                xcodeVersion,
                appleClangVersion: clangMatch[1]
            });
        } catch (error) {
            core.warning(`Failed to query ${xcodePath}: ${(error as Error).message}`);
        }
    }

    // Sort by Apple Clang version descending
    results.sort((a, b) => {
        const partsA = a.appleClangVersion.split('.').map(Number);
        const partsB = b.appleClangVersion.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if (partsB[i] !== partsA[i]) {
                return partsB[i] - partsA[i];
            }
        }
        return 0;
    });

    return results;
}
