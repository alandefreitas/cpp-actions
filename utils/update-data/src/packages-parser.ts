/**
 * Apt Packages file parser and compiler version extraction.
 *
 * Parses RFC 822-style apt Packages file text and extracts GCC/Clang
 * compiler version information, including default version resolution
 * via the build-essential dependency chain.
 *
 * @module packages-parser
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * A compiler version entry for a specific Ubuntu release.
 */
export interface CompilerVersionEntry {
    /** Major version number of the compiler (e.g., 11 for gcc-11). */
    major: number;
    /** Full package version string from the apt repository (e.g., "11.4.0-1ubuntu1~22.04"). */
    package_version: string;
    /** Whether this version is the build-essential / meta-package default. */
    is_default: boolean;
}

/**
 * A single package entry parsed from an apt Packages file.
 */
export interface ParsedPackage {
    /** Package name (e.g., "gcc-11"). */
    name: string;
    /** Package version string (e.g., "11.4.0-1ubuntu1~22.04"). */
    version: string;
    /** Raw Depends field value, or empty string if absent. */
    depends: string;
}

/**
 * Structured compiler version data extracted from apt packages.
 */
export interface ExtractedCompilerVersions {
    /** GCC versioned packages found (e.g., gcc-11, gcc-12). */
    gcc: CompilerVersionEntry[];
    /** Clang versioned packages found (e.g., clang-14, clang-15). */
    clang: CompilerVersionEntry[];
}

// ── Packages file parser ────────────────────────────────────────────────────

/**
 * Parses RFC 822-style apt Packages file text into structured package entries.
 *
 * The Packages file format consists of blocks of `Key: Value` lines separated
 * by blank lines. Continuation lines (starting with whitespace) are appended
 * to the previous field value. Only Package, Version, and Depends fields are
 * extracted.
 *
 * @param text - Raw text content of an apt Packages file
 * @returns Array of parsed package objects with name, version, and depends fields
 */
export function parsePackagesFile(text: string): ParsedPackage[] {
    const packages: ParsedPackage[] = [];
    const blocks = text.split(/\n\n+/);

    for (const block of blocks) {
        const trimmed = block.trim();
        if (trimmed === '') {
            continue;
        }

        let name = '';
        let version = '';
        let depends = '';
        let lastKey = '';

        const lines = trimmed.split('\n');
        for (const line of lines) {
            // Continuation line: starts with space or tab
            if (line.startsWith(' ') || line.startsWith('\t')) {
                if (lastKey === 'depends') {
                    depends += ' ' + line.trim();
                }
                continue;
            }

            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) {
                continue;
            }

            const key = line.substring(0, colonIdx).trim().toLowerCase();
            const value = line.substring(colonIdx + 1).trim();

            if (key === 'package') {
                name = value;
                lastKey = 'package';
            } else if (key === 'version') {
                version = value;
                lastKey = 'version';
            } else if (key === 'depends') {
                depends = value;
                lastKey = 'depends';
            } else {
                lastKey = key;
            }
        }

        if (name !== '') {
            packages.push({ name, version, depends });
        }
    }

    return packages;
}

// ── Compiler extraction ─────────────────────────────────────────────────────

/**
 * Filters parsed packages for versioned GCC (gcc-N, g++-N) and Clang (clang-N)
 * compiler packages and returns structured version data.
 *
 * Only packages matching the `gcc-N` or `clang-N` naming pattern (where N is
 * a number) are included. The `g++-N` packages are not separately tracked
 * since they share the same version as the corresponding `gcc-N`.
 *
 * @param packages - Array of parsed package entries from {@link parsePackagesFile}
 * @returns Extracted GCC and Clang version entries (with `is_default` set to false)
 */
export function extractCompilerPackages(packages: ParsedPackage[]): ExtractedCompilerVersions {
    const gccVersions: CompilerVersionEntry[] = [];
    const clangVersions: CompilerVersionEntry[] = [];
    const seenGcc = new Set<number>();
    const seenClang = new Set<number>();

    for (const pkg of packages) {
        // Match gcc-N (but not g++-N, gcc-N-base, gcc-N-multilib, etc.)
        const gccMatch = pkg.name.match(/^gcc-(\d+)$/);
        if (gccMatch) {
            const major = parseInt(gccMatch[1], 10);
            if (!seenGcc.has(major)) {
                seenGcc.add(major);
                gccVersions.push({
                    major,
                    package_version: pkg.version,
                    is_default: false
                });
            }
        }

        // Match clang-N (but not clang-N-doc, clang-N-examples, etc.)
        const clangMatch = pkg.name.match(/^clang-(\d+)$/);
        if (clangMatch) {
            const major = parseInt(clangMatch[1], 10);
            if (!seenClang.has(major)) {
                seenClang.add(major);
                clangVersions.push({
                    major,
                    package_version: pkg.version,
                    is_default: false
                });
            }
        }
    }

    // Sort by major version
    gccVersions.sort((a, b) => a.major - b.major);
    clangVersions.sort((a, b) => a.major - b.major);

    return { gcc: gccVersions, clang: clangVersions };
}

// ── Dependency chain helpers ────────────────────────────────────────────────

/**
 * Extracts the first alternative from a single dependency clause.
 *
 * @param clause - A single dependency clause (e.g., "gcc-11 (>= 11.4.0-1ubuntu1)")
 * @returns Bare package name of the first alternative
 */
function firstDepName(clause: string): string {
    const first = clause.split('|')[0].trim();
    return first.replace(/\s*\(.*\)/, '').trim();
}

/**
 * Resolves the default GCC major version by following the build-essential
 * dependency chain: build-essential -> gcc -> gcc-N.
 *
 * @param packages - Array of parsed package entries from {@link parsePackagesFile}
 * @returns The default GCC major version as a string (e.g., "11"), or null if
 *          the dependency chain cannot be resolved
 */
export function resolveDefaultGcc(packages: ParsedPackage[]): string | null {
    const byName = new Map<string, ParsedPackage>();
    for (const pkg of packages) {
        if (!byName.has(pkg.name)) {
            byName.set(pkg.name, pkg);
        }
    }

    const buildEssential = byName.get('build-essential');
    if (!buildEssential) {
        return null;
    }

    const beDeps = buildEssential.depends.split(',').map(d => firstDepName(d));
    const gccDepName = beDeps.find(d => d === 'gcc');
    if (!gccDepName) {
        return null;
    }

    const gccPkg = byName.get('gcc');
    if (!gccPkg) {
        return null;
    }

    const gccDeps = gccPkg.depends.split(',').map(d => firstDepName(d));
    for (const dep of gccDeps) {
        const match = dep.match(/^gcc-(\d+)$/);
        if (match) {
            return match[1];
        }
    }

    return null;
}

/**
 * Resolves the default Clang major version by examining the `clang`
 * meta-package's dependency on `clang-N`.
 *
 * @param packages - Array of parsed package entries from {@link parsePackagesFile}
 * @returns The default Clang major version as a string (e.g., "14"), or null if
 *          the clang meta-package is not found or has no versioned dependency
 */
export function resolveDefaultClang(packages: ParsedPackage[]): string | null {
    const byName = new Map<string, ParsedPackage>();
    for (const pkg of packages) {
        if (!byName.has(pkg.name)) {
            byName.set(pkg.name, pkg);
        }
    }

    const clangPkg = byName.get('clang');
    if (!clangPkg) {
        return null;
    }

    const deps = clangPkg.depends.split(',').map(d => firstDepName(d));
    for (const dep of deps) {
        const match = dep.match(/^clang-(\d+)$/);
        if (match) {
            return match[1];
        }
    }

    return null;
}
