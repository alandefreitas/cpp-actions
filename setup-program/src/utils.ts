/**
 * Utility functions for setup-program action.
 *
 * @module utils
 */

/**
 * Escapes special regex characters in a string.
 *
 * @param string - String to escape for use in a regular expression
 * @returns Escaped string safe for regex pattern construction
 */
export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes leading zeros from semver version components.
 *
 * Converts "01.02.03" to "1.2.3" for proper semver comparison.
 *
 * @param version - Version string with potentially leading zeros
 * @returns Cleaned version string without leading zeros
 */
export function removeSemverLeadingZeros(version: string): string {
    const components = version.split('.');
    const cleanedComponents = components.map(component => parseInt(component, 10));
    return cleanedComponents.join('.');
}

/**
 * Renders a template string by replacing placeholders with data values.
 *
 * Placeholders use mustache-style syntax: {{key}}.
 *
 * @param template - Template string with {{key}} placeholders
 * @param data - Object mapping placeholder keys to replacement values
 * @returns Rendered string with placeholders replaced
 */
export function renderTemplate(template: string, data: Record<string, string | number>): string {
    const tokenRegex = /{{\s*([^\s{}]+)\s*}}/g;
    return template.replaceAll(tokenRegex, (match, key) => {
        const value = data[key];
        return value !== undefined ? String(value) : match;
    });
}

/**
 * Returns the GitHub Actions runner OS name based on current platform.
 *
 * @returns "Windows", "macOS", or "Linux" depending on process.platform
 */
export function getRunnerOs(): string {
    const platform = process.platform;
    if (platform === 'win32') {
        return 'Windows';
    } else if (platform === 'darwin') {
        return 'macOS';
    } else {
        return 'Linux';
    }
}

/**
 * Pauses execution for a specified duration.
 *
 * @param ms - Duration to wait in milliseconds
 * @returns Promise that resolves after the specified duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalizes an architecture string to a standard format.
 *
 * Maps various architecture names (x86, win32, ia32, amd64, x86_64, etc.)
 * to their canonical forms (x86, x64, arm, arm64).
 *
 * @param arch - Architecture string to normalize
 * @returns Normalized architecture: 'x86', 'x64', 'arm', 'arm64', or original
 */
export function normalizeArchitectureInput(arch: string): string {
    if (!arch) {
        return '';
    }
    const token = arch.toLowerCase();
    if (['x86', 'win32', 'ia32', 'i386', 'i486', 'i586', 'i686'].includes(token)) {
        return 'x86';
    }
    if (['x64', 'amd64', 'x86_64', 'x86-64'].includes(token)) {
        return 'x64';
    }
    if (['arm', 'arm32'].includes(token)) {
        return 'arm';
    }
    if (['arm64', 'aarch64'].includes(token)) {
        return 'arm64';
    }
    return arch;
}
