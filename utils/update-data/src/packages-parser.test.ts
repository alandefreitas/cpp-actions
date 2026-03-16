import {
    parsePackagesFile,
    extractCompilerPackages,
    resolveDefaultGcc,
    resolveDefaultClang
} from './packages-parser';
import type { ParsedPackage } from './packages-parser';

// ── Fixture: realistic trimmed Packages file for Ubuntu 22.04 (jammy) ───────

const jammyPackagesText = `Package: build-essential
Architecture: amd64
Version: 12.9ubuntu3
Depends: libc6-dev | libc-dev, gcc (>= 4:11.2), g++ (>= 4:11.2), make, dpkg-dev (>= 1.17.11)
Description: Informational list of build-essential packages

Package: gcc
Architecture: amd64
Version: 4:11.2.0-1ubuntu1
Depends: cpp (>= 4:11.2.0-1ubuntu1), gcc-11 (>= 11.2.0-1~)
Description: GNU C compiler

Package: gcc-11
Architecture: amd64
Version: 11.4.0-1ubuntu1~22.04
Depends: cpp-11 (= 11.4.0-1ubuntu1~22.04), binutils (>= 2.38),
 libcc1-0 (>= 11.4.0-1ubuntu1~22.04),
 libgcc-11-dev (= 11.4.0-1ubuntu1~22.04)
Description: GNU C compiler

Package: gcc-12
Architecture: amd64
Version: 12.3.0-1ubuntu1~22.04
Depends: cpp-12 (= 12.3.0-1ubuntu1~22.04), binutils (>= 2.38),
 libgcc-12-dev (= 12.3.0-1ubuntu1~22.04)
Description: GNU C compiler

Package: gcc-11-base
Architecture: amd64
Version: 11.4.0-1ubuntu1~22.04
Description: GCC, the GNU Compiler Collection (base package)

Package: g++-11
Architecture: amd64
Version: 11.4.0-1ubuntu1~22.04
Depends: gcc-11 (= 11.4.0-1ubuntu1~22.04), libstdc++-11-dev (= 11.4.0-1ubuntu1~22.04)
Description: GNU C++ compiler

Package: g++-12
Architecture: amd64
Version: 12.3.0-1ubuntu1~22.04
Depends: gcc-12 (= 12.3.0-1ubuntu1~22.04), libstdc++-12-dev (= 12.3.0-1ubuntu1~22.04)
Description: GNU C++ compiler

Package: clang
Architecture: amd64
Version: 1:14.0-55~exp2
Depends: clang-14 (>= 14~)
Description: C, C++ and Objective-C compiler (LLVM based)

Package: clang-14
Architecture: amd64
Version: 1:14.0.0-1ubuntu1.1
Depends: libc6 (>= 2.34), libclang-cpp14 (= 1:14.0.0-1ubuntu1.1),
 libgcc-s1 (>= 3.3.1), libllvm14 (= 1:14.0.0-1ubuntu1.1)
Description: C, C++ and Objective-C compiler

Package: clang-format-14
Architecture: amd64
Version: 1:14.0.0-1ubuntu1.1
Description: Tool to format C/C++/Obj-C code

Package: libcurl4
Architecture: amd64
Version: 7.81.0-1ubuntu1.16
Depends: libc6 (>= 2.17)
Description: easy-to-use client-side URL transfer library

Package: python3
Architecture: amd64
Version: 3.10.6-1~22.04
Depends: python3.10 (>= 3.10.6-1~)
Description: interactive high-level object-oriented language`;

// ── Fixture: Ubuntu 24.04 (noble) with GCC-13 default and Clang-18 ─────────

const noblePackagesText = `Package: build-essential
Architecture: amd64
Version: 12.10ubuntu1
Depends: libc6-dev | libc-dev, gcc (>= 4:13.2), g++ (>= 4:13.2), make, dpkg-dev (>= 1.17.11)
Description: Informational list of build-essential packages

Package: gcc
Architecture: amd64
Version: 4:13.2.0-7ubuntu1
Depends: cpp (>= 4:13.2.0-7ubuntu1), gcc-13 (>= 13.2.0-2~)
Description: GNU C compiler

Package: gcc-13
Architecture: amd64
Version: 13.2.0-23ubuntu4
Depends: cpp-13 (= 13.2.0-23ubuntu4), binutils (>= 2.42)
Description: GNU C compiler

Package: gcc-14
Architecture: amd64
Version: 14.0.1-0ubuntu2
Depends: cpp-14 (= 14.0.1-0ubuntu2), binutils (>= 2.42)
Description: GNU C compiler

Package: clang
Architecture: amd64
Version: 1:18.0-59~exp2
Depends: clang-18 (>= 18~)
Description: C, C++ and Objective-C compiler (LLVM based)

Package: clang-18
Architecture: amd64
Version: 1:18.1.3-1ubuntu1
Depends: libc6 (>= 2.34), libclang-cpp18 (= 1:18.1.3-1ubuntu1)
Description: C, C++ and Objective-C compiler`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('parsePackagesFile', () => {
    it('parses well-formed entries with Package, Version, and Depends', () => {
        const result = parsePackagesFile(jammyPackagesText);
        const buildEssential = result.find(p => p.name === 'build-essential');
        expect(buildEssential).toBeDefined();
        expect(buildEssential!.version).toBe('12.9ubuntu3');
        expect(buildEssential!.depends).toContain('gcc (>= 4:11.2)');
    });

    it('handles multi-line Depends fields by joining continuation lines', () => {
        const result = parsePackagesFile(jammyPackagesText);
        const gcc11 = result.find(p => p.name === 'gcc-11');
        expect(gcc11).toBeDefined();
        expect(gcc11!.depends).toContain('libcc1-0');
        expect(gcc11!.depends).toContain('libgcc-11-dev');
    });

    it('handles entries with missing Depends field', () => {
        const result = parsePackagesFile(jammyPackagesText);
        const gccBase = result.find(p => p.name === 'gcc-11-base');
        expect(gccBase).toBeDefined();
        expect(gccBase!.depends).toBe('');
    });

    it('returns empty array for empty input', () => {
        expect(parsePackagesFile('')).toEqual([]);
    });

    it('returns empty array for whitespace-only input', () => {
        expect(parsePackagesFile('   \n\n   \n')).toEqual([]);
    });

    it('handles multiple blank lines between entries', () => {
        const text = `Package: foo
Version: 1.0



Package: bar
Version: 2.0`;
        const result = parsePackagesFile(text);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('foo');
        expect(result[1].name).toBe('bar');
    });

    it('skips lines without colons', () => {
        const text = `Package: test-pkg
Version: 1.0
This line has no colon
Description: A test package`;
        const result = parsePackagesFile(text);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test-pkg');
        expect(result[0].version).toBe('1.0');
    });

    it('handles tab continuation lines in Depends', () => {
        const text = `Package: mypkg
Version: 1.0
Depends: dep1,
\tdep2,
\tdep3`;
        const result = parsePackagesFile(text);
        expect(result[0].depends).toContain('dep1');
        expect(result[0].depends).toContain('dep2');
        expect(result[0].depends).toContain('dep3');
    });

    it('parses all entries from a realistic fixture', () => {
        const result = parsePackagesFile(jammyPackagesText);
        const names = result.map(p => p.name);
        expect(names).toContain('build-essential');
        expect(names).toContain('gcc');
        expect(names).toContain('gcc-11');
        expect(names).toContain('gcc-12');
        expect(names).toContain('clang');
        expect(names).toContain('clang-14');
        expect(names).toContain('libcurl4');
        expect(names).toContain('python3');
    });
});

describe('extractCompilerPackages', () => {
    it('extracts gcc-N packages and ignores gcc-N-base and g++-N', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const result = extractCompilerPackages(packages);
        const gccMajors = result.gcc.map(v => v.major);
        expect(gccMajors).toContain(11);
        expect(gccMajors).toContain(12);
        expect(gccMajors).toHaveLength(2);
    });

    it('extracts clang-N packages and ignores clang-format-N', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const result = extractCompilerPackages(packages);
        const clangMajors = result.clang.map(v => v.major);
        expect(clangMajors).toContain(14);
        expect(clangMajors).toHaveLength(1);
    });

    it('sets is_default to false for all extracted packages', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const result = extractCompilerPackages(packages);
        for (const entry of [...result.gcc, ...result.clang]) {
            expect(entry.is_default).toBe(false);
        }
    });

    it('sorts results by major version ascending', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const result = extractCompilerPackages(packages);
        for (let i = 1; i < result.gcc.length; i++) {
            expect(result.gcc[i].major).toBeGreaterThan(result.gcc[i - 1].major);
        }
    });

    it('includes package_version from the parsed data', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const result = extractCompilerPackages(packages);
        const gcc11 = result.gcc.find(v => v.major === 11);
        expect(gcc11!.package_version).toBe('11.4.0-1ubuntu1~22.04');
    });

    it('returns empty arrays when no compiler packages are present', () => {
        const packages: ParsedPackage[] = [
            { name: 'libcurl4', version: '7.81.0', depends: '' },
            { name: 'python3', version: '3.10.6', depends: '' }
        ];
        const result = extractCompilerPackages(packages);
        expect(result.gcc).toHaveLength(0);
        expect(result.clang).toHaveLength(0);
    });

    it('deduplicates packages with the same major version', () => {
        const packages: ParsedPackage[] = [
            { name: 'gcc-12', version: '12.3.0-1', depends: '' },
            { name: 'gcc-12', version: '12.3.0-2', depends: '' }
        ];
        const result = extractCompilerPackages(packages);
        expect(result.gcc).toHaveLength(1);
        expect(result.gcc[0].package_version).toBe('12.3.0-1');
    });
});

describe('resolveDefaultGcc', () => {
    it('follows build-essential -> gcc -> gcc-N chain for jammy', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const defaultVersion = resolveDefaultGcc(packages);
        expect(defaultVersion).toBe('11');
    });

    it('follows build-essential -> gcc -> gcc-N chain for noble', () => {
        const packages = parsePackagesFile(noblePackagesText);
        const defaultVersion = resolveDefaultGcc(packages);
        expect(defaultVersion).toBe('13');
    });

    it('returns null when build-essential is missing', () => {
        const packages: ParsedPackage[] = [
            { name: 'gcc', version: '4:11.2.0', depends: 'gcc-11' }
        ];
        expect(resolveDefaultGcc(packages)).toBeNull();
    });

    it('returns null when gcc meta-package is missing', () => {
        const packages: ParsedPackage[] = [
            { name: 'build-essential', version: '12.9', depends: 'gcc (>= 4:11.2), make' }
        ];
        expect(resolveDefaultGcc(packages)).toBeNull();
    });

    it('returns null when build-essential does not depend on gcc', () => {
        const packages: ParsedPackage[] = [
            { name: 'build-essential', version: '12.9', depends: 'make, dpkg-dev' },
            { name: 'gcc', version: '4:11.2.0', depends: 'gcc-11' }
        ];
        expect(resolveDefaultGcc(packages)).toBeNull();
    });

    it('returns null when gcc has no gcc-N dependency', () => {
        const packages: ParsedPackage[] = [
            { name: 'build-essential', version: '12.9', depends: 'gcc (>= 4:11.2), make' },
            { name: 'gcc', version: '4:11.2.0', depends: 'cpp (>= 4:11.2)' }
        ];
        expect(resolveDefaultGcc(packages)).toBeNull();
    });
});

describe('resolveDefaultClang', () => {
    it('resolves clang -> clang-N for jammy (clang-14)', () => {
        const packages = parsePackagesFile(jammyPackagesText);
        const defaultVersion = resolveDefaultClang(packages);
        expect(defaultVersion).toBe('14');
    });

    it('resolves clang -> clang-N for noble (clang-18)', () => {
        const packages = parsePackagesFile(noblePackagesText);
        const defaultVersion = resolveDefaultClang(packages);
        expect(defaultVersion).toBe('18');
    });

    it('returns null when clang meta-package is missing', () => {
        const packages: ParsedPackage[] = [
            { name: 'clang-14', version: '1:14.0.0', depends: '' }
        ];
        expect(resolveDefaultClang(packages)).toBeNull();
    });

    it('returns null when clang has no clang-N dependency', () => {
        const packages: ParsedPackage[] = [
            { name: 'clang', version: '1:14.0', depends: 'libc6' }
        ];
        expect(resolveDefaultClang(packages)).toBeNull();
    });
});
