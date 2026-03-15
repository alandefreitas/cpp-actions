import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    parseExceptions,
    parseGitmodules,
    isModule,
    moduleForHeader,
    scanHeaderDependencies,
    scanSubdirectoryDependencies,
    scanModuleDependencies
} from './scanning';
import type { ExceptionsMap, SubmodulePaths } from './scanning';

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Creates a standard submodulePaths set for testing.
 *
 * @returns A SubmodulePaths set with common Boost modules
 */
function makeSubmodulePaths(): SubmodulePaths {
    return new Set([
        'libs/algorithm',
        'libs/function',
        'libs/core',
        'libs/config',
        'libs/numeric/conversion',
        'libs/smart_ptr',
        'libs/type_traits'
    ]);
}

// ── parseExceptions ─────────────────────────────────────────────────

describe('parseExceptions', () => {
    test('parses module:header mappings', () => {
        const content = 'numeric~conversion:\nboost/cast.hpp\nboost/numeric_cast.hpp\n';
        const result = parseExceptions(content);
        expect(result['boost/cast.hpp']).toBe('numeric/conversion');
        expect(result['boost/numeric_cast.hpp']).toBe('numeric/conversion');
    });

    test('handles multiple modules', () => {
        const content = 'algorithm:\nboost/algorithm.hpp\n\nfunction:\nboost/function.hpp\n';
        const result = parseExceptions(content);
        expect(result['boost/algorithm.hpp']).toBe('algorithm');
        expect(result['boost/function.hpp']).toBe('function');
    });

    test('skips empty lines between module and headers', () => {
        const content = 'core:\n\nboost/utility.hpp\n';
        const result = parseExceptions(content);
        expect(result['boost/utility.hpp']).toBe('core');
    });

    test('returns empty map for empty content', () => {
        expect(parseExceptions('')).toEqual({});
    });

    test('ignores lines before first module declaration', () => {
        const content = 'orphan_header.hpp\ncore:\nboost/core.hpp\n';
        const result = parseExceptions(content);
        expect(result).not.toHaveProperty('orphan_header.hpp');
        expect(result['boost/core.hpp']).toBe('core');
    });

    test('handles tilde replacement for nested modules', () => {
        const content = 'numeric~conversion:\nboost/cast.hpp\n';
        const result = parseExceptions(content);
        expect(result['boost/cast.hpp']).toBe('numeric/conversion');
    });
});

// ── parseGitmodules ─────────────────────────────────────────────────

describe('parseGitmodules', () => {
    test('extracts submodule paths', () => {
        const content = [
            '[submodule "algorithm"]',
            '  path = libs/algorithm',
            '  url = ../algorithm.git',
            '[submodule "core"]',
            '  path = libs/core',
            '  url = ../core.git'
        ].join('\n');
        const result = parseGitmodules(content);
        expect(result).toContain('libs/algorithm');
        expect(result).toContain('libs/core');
        expect(result.size).toBe(2);
    });

    test('returns empty set for empty content', () => {
        expect(parseGitmodules('').size).toBe(0);
    });

    test('handles lines without path key', () => {
        const content = '[submodule "test"]\n  url = ../test.git\n';
        const result = parseGitmodules(content);
        expect(result.size).toBe(0);
    });
});

// ── isModule ────────────────────────────────────────────────────────

describe('isModule', () => {
    const submodulePaths = makeSubmodulePaths();

    test('returns true for valid module', () => {
        expect(isModule('algorithm', submodulePaths)).toBe(true);
    });

    test('returns false for unknown module', () => {
        expect(isModule('nonexistent', submodulePaths)).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isModule('', submodulePaths)).toBe(false);
    });
});

// ── moduleForHeader ─────────────────────────────────────────────────

describe('moduleForHeader', () => {
    const submodulePaths = makeSubmodulePaths();
    const exceptions: ExceptionsMap = {
        'boost/cast.hpp': 'numeric/conversion'
    };

    test('returns exception mapping when header is in exceptions', () => {
        expect(moduleForHeader('boost/cast.hpp', exceptions, submodulePaths)).toBe('numeric/conversion');
    });

    test('matches boost/module.hpp pattern', () => {
        expect(moduleForHeader('boost/function.hpp', {}, submodulePaths)).toBe('function');
    });

    test('matches boost/module.h pattern', () => {
        expect(moduleForHeader('boost/function.h', {}, submodulePaths)).toBe('function');
    });

    test('matches boost/module.hxx pattern', () => {
        expect(moduleForHeader('boost/function.hxx', {}, submodulePaths)).toBe('function');
    });

    test('matches boost/nested/module.hpp pattern', () => {
        expect(moduleForHeader('boost/numeric/conversion.hpp', {}, submodulePaths)).toBe('numeric/conversion');
    });

    test('matches boost/nested/module/header.hpp pattern', () => {
        expect(moduleForHeader('boost/numeric/conversion/cast.hpp', {}, submodulePaths)).toBe('numeric/conversion');
    });

    test('matches boost/module/header.hpp pattern', () => {
        expect(moduleForHeader('boost/algorithm/string.hpp', {}, submodulePaths)).toBe('algorithm');
    });

    test('returns null for unrecognized header', () => {
        expect(moduleForHeader('boost/unknown/deep/header.hpp', {}, submodulePaths)).toBeNull();
    });

    test('returns null for non-boost header', () => {
        expect(moduleForHeader('std/vector.hpp', {}, submodulePaths)).toBeNull();
    });

    test('returns null when module extracted from header is not in submodulePaths', () => {
        expect(moduleForHeader('boost/nonexistent.hpp', {}, submodulePaths)).toBeNull();
    });
});

// ── scanHeaderDependencies ──────────────────────────────────────────

describe('scanHeaderDependencies', () => {
    const submodulePaths = makeSubmodulePaths();
    const exceptions: ExceptionsMap = {};

    test('finds #include <boost/...> dependencies', () => {
        const content = '#include <boost/algorithm/string.hpp>\n#include <boost/function.hpp>\n';
        const result = scanHeaderDependencies(content, exceptions, submodulePaths);
        expect(result).toContain('algorithm');
        expect(result).toContain('function');
    });

    test('finds #include "boost/..." dependencies', () => {
        const content = '#include "boost/core/lightweight_test.hpp"\n';
        const result = scanHeaderDependencies(content, exceptions, submodulePaths);
        expect(result).toContain('core');
    });

    test('handles leading whitespace before #include', () => {
        const content = '  \t#  include  <boost/function.hpp>\n';
        const result = scanHeaderDependencies(content, exceptions, submodulePaths);
        expect(result).toContain('function');
    });

    test('ignores non-boost includes', () => {
        const content = '#include <vector>\n#include "mylib/header.hpp"\n';
        const result = scanHeaderDependencies(content, exceptions, submodulePaths);
        expect(result.size).toBe(0);
    });

    test('deduplicates modules', () => {
        const content = '#include <boost/algorithm/string.hpp>\n#include <boost/algorithm/join.hpp>\n';
        const result = scanHeaderDependencies(content, exceptions, submodulePaths);
        expect(result.size).toBe(1);
        expect(result).toContain('algorithm');
    });

    test('skips headers that do not resolve to a module', () => {
        const content = '#include <boost/unknown_module.hpp>\n';
        const result = scanHeaderDependencies(content, exceptions, submodulePaths);
        expect(result.size).toBe(0);
    });

    test('returns empty set for empty file', () => {
        expect(scanHeaderDependencies('', exceptions, submodulePaths).size).toBe(0);
    });
});

// ── scanSubdirectoryDependencies ────────────────────────────────────

describe('scanSubdirectoryDependencies', () => {
    const submodulePaths = makeSubmodulePaths();
    const exceptions: ExceptionsMap = {};
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scanning-test-'));
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    test('returns empty set for non-existent directory', async () => {
        const result = await scanSubdirectoryDependencies('/nonexistent/path', exceptions, submodulePaths);
        expect(result.size).toBe(0);
    });

    test('scans .hpp files for boost includes', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'test.hpp'),
            '#include <boost/algorithm/string.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('algorithm');
    });

    test('scans .cpp files', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'impl.cpp'),
            '#include <boost/function.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('function');
    });

    test('scans .h files', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'header.h'),
            '#include <boost/core/noncopyable.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('core');
    });

    test('scans .cc files', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'source.cc'),
            '#include <boost/smart_ptr/shared_ptr.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('smart_ptr');
    });

    test('scans .cxx files', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'source.cxx'),
            '#include <boost/type_traits.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('type_traits');
    });

    test('scans .ipp files', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'impl.ipp'),
            '#include <boost/config.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('config');
    });

    test('ignores non-C++ files', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'readme.txt'),
            '#include <boost/algorithm/string.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result.size).toBe(0);
    });

    test('recurses into subdirectories', async () => {
        const subDir = path.join(tmpDir, 'sub');
        await fsp.mkdir(subDir);
        await fsp.writeFile(
            path.join(subDir, 'nested.hpp'),
            '#include <boost/function.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('function');
    });

    test('aggregates modules from multiple files and subdirectories', async () => {
        await fsp.writeFile(
            path.join(tmpDir, 'a.hpp'),
            '#include <boost/algorithm/string.hpp>\n'
        );
        const subDir = path.join(tmpDir, 'inner');
        await fsp.mkdir(subDir);
        await fsp.writeFile(
            path.join(subDir, 'b.cpp'),
            '#include <boost/function.hpp>\n'
        );
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result).toContain('algorithm');
        expect(result).toContain('function');
    });

    test('returns empty set for directory with no C++ files', async () => {
        await fsp.writeFile(path.join(tmpDir, 'notes.md'), '# Notes\n');
        const result = await scanSubdirectoryDependencies(tmpDir, exceptions, submodulePaths);
        expect(result.size).toBe(0);
    });
});

// ── scanModuleDependencies ──────────────────────────────────────────

describe('scanModuleDependencies', () => {
    const submodulePaths = makeSubmodulePaths();
    const exceptions: ExceptionsMap = {};
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'module-deps-test-'));
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    test('scans include/ and src/ subdirectories', async () => {
        const includeDir = path.join(tmpDir, 'include');
        const srcDir = path.join(tmpDir, 'src');
        await fsp.mkdir(includeDir);
        await fsp.mkdir(srcDir);
        await fsp.writeFile(
            path.join(includeDir, 'header.hpp'),
            '#include <boost/algorithm/string.hpp>\n'
        );
        await fsp.writeFile(
            path.join(srcDir, 'impl.cpp'),
            '#include <boost/function.hpp>\n'
        );
        const result = await scanModuleDependencies(tmpDir, 'test_module', exceptions, submodulePaths);
        expect(result).toContain('algorithm');
        expect(result).toContain('function');
    });

    test('excludes self-references', async () => {
        const includeDir = path.join(tmpDir, 'include');
        await fsp.mkdir(includeDir);
        await fsp.writeFile(
            path.join(includeDir, 'header.hpp'),
            '#include <boost/algorithm/string.hpp>\n'
        );
        const result = await scanModuleDependencies(tmpDir, 'algorithm', exceptions, submodulePaths);
        expect(result).not.toContain('algorithm');
        expect(result.size).toBe(0);
    });

    test('handles missing include/ and src/ directories', async () => {
        const result = await scanModuleDependencies(tmpDir, 'test_module', exceptions, submodulePaths);
        expect(result.size).toBe(0);
    });

    test('handles only include/ existing', async () => {
        const includeDir = path.join(tmpDir, 'include');
        await fsp.mkdir(includeDir);
        await fsp.writeFile(
            path.join(includeDir, 'api.hpp'),
            '#include <boost/core/noncopyable.hpp>\n'
        );
        const result = await scanModuleDependencies(tmpDir, 'test_module', exceptions, submodulePaths);
        expect(result).toContain('core');
    });

    test('handles only src/ existing', async () => {
        const srcDir = path.join(tmpDir, 'src');
        await fsp.mkdir(srcDir);
        await fsp.writeFile(
            path.join(srcDir, 'impl.cpp'),
            '#include <boost/config.hpp>\n'
        );
        const result = await scanModuleDependencies(tmpDir, 'test_module', exceptions, submodulePaths);
        expect(result).toContain('config');
    });
});
