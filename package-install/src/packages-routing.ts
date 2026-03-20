/**
 * OS-native package routing for the cross-platform `packages` input.
 *
 * Routes generic package names to the appropriate package manager based on
 * the runner platform and translates the unified `@version` syntax to
 * PM-native version formats.
 *
 * @module packages-routing
 */

/**
 * Routing result indicating which packages should be installed by each package manager.
 */
export interface RoutedPackages {
    /** Packages to install with apt-get (Linux) */
    apt: string[];
    /** Packages to install with Homebrew (macOS) */
    brew: string[];
    /** Packages to install with Chocolatey (Windows) */
    choco: string[];
}

/**
 * Translates a package name with `@version` syntax to the apt-get convention.
 *
 * apt-get uses a hyphen between name and version (e.g., `gcc-14`, `clang-18`).
 *
 * @param pkg - Package name, optionally with `@version` suffix
 * @returns Translated package name in apt-get format
 */
function translateForApt(pkg: string): string {
    const atIndex = pkg.indexOf('@');
    if (atIndex === -1) {
        return pkg;
    }
    const name = pkg.substring(0, atIndex);
    const version = pkg.substring(atIndex + 1);
    return `${name}-${version}`;
}

/**
 * Translates a package name with `@version` syntax to the Chocolatey convention.
 *
 * Chocolatey uses `--version=X.Y.Z` as a separate argument after the package name
 * (e.g., `cmake --version=14`).
 *
 * @param pkg - Package name, optionally with `@version` suffix
 * @returns Translated package string in Chocolatey format
 */
function translateForChoco(pkg: string): string {
    const atIndex = pkg.indexOf('@');
    if (atIndex === -1) {
        return pkg;
    }
    const name = pkg.substring(0, atIndex);
    const version = pkg.substring(atIndex + 1);
    return `${name} --version=${version}`;
}

/**
 * Routes packages to the OS-native package manager and translates version syntax.
 *
 * On Linux, routes to apt-get with `pkg@ver` → `pkg-ver` translation.
 * On macOS, routes to brew with `pkg@ver` passed through (native brew syntax).
 * On Windows, routes to choco with `pkg@ver` → `pkg --version=ver` translation.
 *
 * @param packages - List of package names with optional `@version` suffix
 * @param platform - The OS platform string (e.g., `process.platform`)
 * @returns Object indicating which packages each PM should install
 */
export function routePackages(packages: string[], platform: string): RoutedPackages {
    const result: RoutedPackages = { apt: [], brew: [], choco: [] };

    if (packages.length === 0) {
        return result;
    }

    switch (platform) {
        case 'linux':
            result.apt = packages.map(translateForApt);
            break;
        case 'darwin':
            // brew uses @version natively — pass through as-is
            result.brew = [...packages];
            break;
        case 'win32':
            result.choco = packages.map(translateForChoco);
            break;
    }

    return result;
}

/**
 * Merges routed packages into existing PM-specific lists, deduplicating entries.
 *
 * @param existing - Current PM-specific package list
 * @param routed - Additional packages from the routing step
 * @returns Merged and deduplicated package list
 */
export function mergePackages(existing: string[], routed: string[]): string[] {
    const seen = new Set(existing);
    const merged = [...existing];
    for (const pkg of routed) {
        if (!seen.has(pkg)) {
            seen.add(pkg);
            merged.push(pkg);
        }
    }
    return merged;
}
