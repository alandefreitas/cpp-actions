import * as fs from 'fs';

jest.mock('@actions/core', () => ({
    exportVariable: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn().mockReturnValue(false)
}));

import * as core from '@actions/core';
import * as io from '@actions/io';
import {
    buildSymbolizerCandidatePaths,
    findLlvmSymbolizer,
    exportSymbolizerEnvVars
} from './symbolizer-utils';

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockExportVariable = core.exportVariable as jest.MockedFunction<typeof core.exportVariable>;

beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockWhich.mockResolvedValue('');
});

describe('buildSymbolizerCandidatePaths', () => {
    it('returns Linux paths with version-specific entries', () => {
        const paths = buildSymbolizerCandidatePaths(14, 'linux');
        expect(paths).toEqual([
            '/usr/lib/llvm-14/bin/llvm-symbolizer',
            '/usr/bin/llvm-symbolizer-14',
            '/usr/bin/llvm-symbolizer'
        ]);
    });

    it('returns macOS Homebrew paths', () => {
        const paths = buildSymbolizerCandidatePaths(14, 'darwin');
        expect(paths).toContain('/opt/homebrew/opt/llvm@14/bin/llvm-symbolizer');
        expect(paths).toContain('/usr/local/opt/llvm@14/bin/llvm-symbolizer');
        expect(paths).toContain('/opt/homebrew/opt/llvm/bin/llvm-symbolizer');
        expect(paths).toContain('/usr/local/opt/llvm/bin/llvm-symbolizer');
    });

    it('returns Windows path', () => {
        const paths = buildSymbolizerCandidatePaths(14, 'win32');
        expect(paths).toEqual([
            'C:\\Program Files\\LLVM\\bin\\llvm-symbolizer.exe'
        ]);
    });

    it('returns empty array for unknown platform', () => {
        const paths = buildSymbolizerCandidatePaths(14, 'freebsd');
        expect(paths).toEqual([]);
    });
});

describe('findLlvmSymbolizer', () => {
    it('returns absolute path when existsSync finds symbolizer', async () => {
        mockExistsSync.mockImplementation((p) => {
            return String(p).includes('llvm-symbolizer');
        });
        const result = await findLlvmSymbolizer(14);
        expect(result).toMatch(/llvm-symbolizer/);
    });

    it('returns null when symbolizer not found anywhere', async () => {
        mockWhich.mockResolvedValue('');
        const result = await findLlvmSymbolizer(999);
        expect(result).toBeNull();
    });

    it('returns path from io.which when found', async () => {
        mockWhich
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('/usr/bin/llvm-symbolizer');
        const result = await findLlvmSymbolizer(999);
        expect(result).toBe('/usr/bin/llvm-symbolizer');
    });

    it('handles io.which throwing and continues searching', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/llvm-symbolizer');
        const result = await findLlvmSymbolizer(999);
        expect(result).toBe('/usr/bin/llvm-symbolizer');
    });

    it('returns null when io.which throws for all candidates', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        const result = await findLlvmSymbolizer(999);
        expect(result).toBeNull();
    });
});

describe('exportSymbolizerEnvVars', () => {
    it('exports all five env vars', () => {
        exportSymbolizerEnvVars('/usr/bin/llvm-symbolizer');

        expect(mockExportVariable).toHaveBeenCalledWith('LLVM_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer');
        expect(mockExportVariable).toHaveBeenCalledWith('ASAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer');
        expect(mockExportVariable).toHaveBeenCalledWith('MSAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer');
        expect(mockExportVariable).toHaveBeenCalledWith('TSAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer');
        expect(mockExportVariable).toHaveBeenCalledWith('UBSAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer');
        expect(mockExportVariable).toHaveBeenCalledTimes(5);
    });
});
