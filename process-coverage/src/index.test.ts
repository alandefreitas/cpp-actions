jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    getInput: jest.fn()
}));

jest.mock('action-schema', () => ({
    ...jest.requireActual('action-schema'),
    runAction: jest.fn()
}));

jest.mock('node:fs/promises', () => ({
    ...jest.requireActual('node:fs/promises'),
    readFile: jest.fn()
}));

jest.mock('node:fs', () => ({
    ...jest.requireActual('node:fs'),
    mkdirSync: jest.fn()
}));

jest.mock('./detect-compiler', () => ({
    resolveCompilerInfo: jest.fn(),
    discoverExecutables: jest.fn()
}));

jest.mock('./gcc-tools', () => ({
    findGcov: jest.fn(),
    findLcov: jest.fn(),
    findGenhtml: jest.fn()
}));

jest.mock('./clang-tools', () => ({
    findLlvmProfdata: jest.fn(),
    findLlvmCov: jest.fn()
}));

jest.mock('./gcc-pipeline', () => ({
    captureGccCoverage: jest.fn()
}));

jest.mock('./clang-pipeline', () => ({
    mergeProfrawFiles: jest.fn(),
    exportClangCoverage: jest.fn()
}));

jest.mock('./lcov-filter', () => ({
    ...jest.requireActual('./lcov-filter'),
    stripExclMarkers: jest.fn()
}));

jest.mock('./metrics-output', () => ({
    ...jest.requireActual('./metrics-output'),
    writeLcovFile: jest.fn()
}));

jest.mock('./new-code', () => ({
    ...jest.requireActual('./new-code'),
    getChangedLines: jest.fn()
}));

jest.mock('./summary', () => ({
    writeSummary: jest.fn()
}));

jest.mock('./html-report', () => ({
    generateHtmlReport: jest.fn(),
    uploadHtmlArtifact: jest.fn()
}));

jest.mock('./upload', () => ({
    runUploads: jest.fn()
}));

import * as os from 'node:os';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import * as core from '@actions/core';
import { runAction } from 'action-schema';

import { resolveCompilerInfo, discoverExecutables } from './detect-compiler';
import { findGcov, findLcov, findGenhtml } from './gcc-tools';
import { findLlvmProfdata, findLlvmCov } from './clang-tools';
import { captureGccCoverage } from './gcc-pipeline';
import { mergeProfrawFiles, exportClangCoverage } from './clang-pipeline';
import { stripExclMarkers } from './lcov-filter';
import { writeLcovFile } from './metrics-output';
import { getChangedLines } from './new-code';
import { writeSummary } from './summary';
import { generateHtmlReport, uploadHtmlArtifact } from './html-report';
import { runUploads } from './upload';
import type { LcovFile } from './lcov-parser';

import { main, inputsSchema, outputsSchema } from './index';
import type { Inputs } from './index';

const mockCore = core as jest.Mocked<typeof core>;
const mockReadFile = readFile as unknown as jest.Mock;
const mockMkdirSync = mkdirSync as unknown as jest.Mock;
const mockRunAction = runAction as unknown as jest.Mock;
const mockResolveCompilerInfo = resolveCompilerInfo as jest.MockedFunction<typeof resolveCompilerInfo>;
const mockDiscoverExecutables = discoverExecutables as jest.MockedFunction<typeof discoverExecutables>;
const mockFindGcov = findGcov as jest.MockedFunction<typeof findGcov>;
const mockFindLcov = findLcov as jest.MockedFunction<typeof findLcov>;
const mockFindGenhtml = findGenhtml as jest.MockedFunction<typeof findGenhtml>;
const mockFindLlvmProfdata = findLlvmProfdata as jest.MockedFunction<typeof findLlvmProfdata>;
const mockFindLlvmCov = findLlvmCov as jest.MockedFunction<typeof findLlvmCov>;
const mockCaptureGccCoverage = captureGccCoverage as jest.MockedFunction<typeof captureGccCoverage>;
const mockMergeProfrawFiles = mergeProfrawFiles as jest.MockedFunction<typeof mergeProfrawFiles>;
const mockExportClangCoverage = exportClangCoverage as jest.MockedFunction<typeof exportClangCoverage>;
const mockStripExclMarkers = stripExclMarkers as jest.MockedFunction<typeof stripExclMarkers>;
const mockWriteLcovFile = writeLcovFile as jest.MockedFunction<typeof writeLcovFile>;
const mockGetChangedLines = getChangedLines as jest.MockedFunction<typeof getChangedLines>;
const mockWriteSummary = writeSummary as jest.MockedFunction<typeof writeSummary>;
const mockGenerateHtmlReport = generateHtmlReport as jest.MockedFunction<typeof generateHtmlReport>;
const mockUploadHtmlArtifact = uploadHtmlArtifact as jest.MockedFunction<typeof uploadHtmlArtifact>;
const mockRunUploads = runUploads as jest.MockedFunction<typeof runUploads>;

// Captured once at import time, before beforeEach clears mock call history.
const runActionCalls = mockRunAction.mock.calls.slice();

/**
 * LCOV content with two source files:
 * - `/repo/src/a.cpp`: 1 of 2 lines covered, 1 of 1 function, 1 of 2 branches
 * - `/repo/test/t.cpp`: 1 of 1 line covered
 */
const RAW_LCOV = [
    'TN:',
    'SF:/repo/src/a.cpp',
    'FN:1,foo',
    'FNDA:3,foo',
    'FNF:1',
    'FNH:1',
    'DA:1,3',
    'DA:2,0',
    'BRDA:1,0,0,1',
    'BRDA:1,0,1,0',
    'BRF:2',
    'BRH:1',
    'LF:2',
    'LH:1',
    'end_of_record',
    'TN:',
    'SF:/repo/test/t.cpp',
    'DA:5,1',
    'LF:1',
    'LH:1',
    'end_of_record',
    ''
].join('\n');

const OUTPUT_DIR = path.join(os.tmpdir(), 'process-coverage');
const LCOV_OUT = path.join(OUTPUT_DIR, 'lcov.info');

/**
 * Builds a complete Inputs object with defaults matching the schema.
 *
 * @param overrides - Input values to override
 * @returns Complete Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        compiler: '',
        compilerVersion: '',
        cxx: '',
        buildDir: ['build'],
        include: [],
        exclude: [],
        summary: false,
        htmlReport: false,
        htmlReportArtifact: '<auto>',
        htmlReportRetentionDays: 30,
        diffBase: '',
        stripExclMarkers: false,
        binaries: [],
        profrawPattern: '*.profraw',
        codecovToken: '',
        codecovFlags: '',
        codecovArgs: '',
        coverallsToken: '',
        coverallsArgs: '',
        failOnUploadError: true,
        ...overrides
    };
}

/**
 * Returns the source file paths of an LCOV data argument.
 *
 * @param data - Parsed LCOV data
 * @returns Source file paths in order
 */
function sourceFiles(data: LcovFile): string[] {
    return data.map(s => s.sourceFile);
}

describe('process-coverage main', () => {
    const origPlatform = process.platform;

    beforeEach(() => {
        jest.clearAllMocks();
        mockResolveCompilerInfo.mockResolvedValue({ compiler: 'gcc', majorVersion: '14' });
        mockFindGcov.mockResolvedValue('/usr/bin/gcov-14');
        mockFindLcov.mockResolvedValue('/usr/bin/lcov');
        mockCaptureGccCoverage.mockResolvedValue('/tmp/raw.info');
        mockFindLlvmProfdata.mockResolvedValue('/usr/bin/llvm-profdata-18');
        mockFindLlvmCov.mockResolvedValue('/usr/bin/llvm-cov-18');
        mockMergeProfrawFiles.mockResolvedValue('/tmp/merged.profdata');
        mockExportClangCoverage.mockResolvedValue('/tmp/clang.info');
        mockDiscoverExecutables.mockResolvedValue([]);
        mockReadFile.mockResolvedValue(RAW_LCOV);
        mockStripExclMarkers.mockImplementation(async (data) => data);
        mockWriteLcovFile.mockResolvedValue(LCOV_OUT);
        mockGetChangedLines.mockResolvedValue(new Map());
        mockWriteSummary.mockResolvedValue(undefined);
        mockFindGenhtml.mockResolvedValue('/usr/bin/genhtml');
        mockGenerateHtmlReport.mockResolvedValue(path.join(OUTPUT_DIR, 'html-report'));
        mockUploadHtmlArtifact.mockResolvedValue(undefined);
        mockRunUploads.mockResolvedValue(undefined);
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    describe('module wiring', () => {
        it('registers the action with runAction using the schemas', () => {
            expect(runActionCalls).toHaveLength(1);
            const options = runActionCalls[0][0];
            expect(options.title).toBe('Process Coverage');
            expect(options.inputsSchema).toBe(inputsSchema);
            expect(options.outputsSchema).toBe(outputsSchema);
            expect(options.callerModule).toBeDefined();
        });

        it('runAction main callback runs the full pipeline', async () => {
            const options = runActionCalls[0][0];
            const result = await options.main(makeInputs());
            expect(result.lcovFile).toBe(LCOV_OUT);
            expect(mockResolveCompilerInfo).toHaveBeenCalledTimes(1);
            expect(mockRunUploads).toHaveBeenCalledTimes(1);
        });

        it('creates the output directory under the temp dir', async () => {
            await main(makeInputs());
            expect(mockMkdirSync).toHaveBeenCalledWith(OUTPUT_DIR, { recursive: true });
        });
    });

    describe('compiler detection', () => {
        it('passes compiler inputs to resolveCompilerInfo', async () => {
            await main(makeInputs({
                compiler: 'gcc',
                compilerVersion: '14',
                cxx: '/usr/bin/g++-14',
                buildDir: ['b1', 'b2'],
                profrawPattern: 'x.profraw'
            }));
            expect(mockResolveCompilerInfo).toHaveBeenCalledWith({
                compiler: 'gcc',
                compilerVersion: '14',
                cxx: '/usr/bin/g++-14',
                buildDir: ['b1', 'b2'],
                profrawPattern: 'x.profraw'
            });
            expect(mockCore.info).toHaveBeenCalledWith('Compiler: gcc 14');
        });

        it('logs the compiler without version when the major version is unknown', async () => {
            mockResolveCompilerInfo.mockResolvedValue({ compiler: 'gcc', majorVersion: '' });
            await main(makeInputs());
            expect(mockCore.info).toHaveBeenCalledWith('Compiler: gcc');
            expect(mockFindGcov).toHaveBeenCalledWith('');
        });

        it('closes the log group and propagates detection errors', async () => {
            mockResolveCompilerInfo.mockRejectedValue(new Error('no compiler'));
            await expect(main(makeInputs())).rejects.toThrow('no compiler');
            expect(mockCore.startGroup).toHaveBeenCalledTimes(1);
            expect(mockCore.endGroup).toHaveBeenCalledTimes(1);
            expect(mockFindGcov).not.toHaveBeenCalled();
        });
    });

    describe('GCC capture', () => {
        it('finds gcov/lcov for the major version and captures from build dirs', async () => {
            await main(makeInputs({ buildDir: ['build', 'build2'] }));
            expect(mockFindGcov).toHaveBeenCalledWith('14');
            expect(mockFindLcov).toHaveBeenCalled();
            expect(mockCaptureGccCoverage).toHaveBeenCalledWith({
                lcovPath: '/usr/bin/lcov',
                gcovPath: '/usr/bin/gcov-14',
                buildDirs: ['build', 'build2'],
                outputDir: OUTPUT_DIR
            });
            expect(mockReadFile).toHaveBeenCalledWith('/tmp/raw.info', 'utf-8');
            expect(mockFindLlvmCov).not.toHaveBeenCalled();
        });

        it('propagates tool lookup failures without capturing', async () => {
            mockFindLcov.mockRejectedValue(new Error('lcov missing'));
            await expect(main(makeInputs())).rejects.toThrow('lcov missing');
            expect(mockCaptureGccCoverage).not.toHaveBeenCalled();
        });

        it('propagates capture failures', async () => {
            mockCaptureGccCoverage.mockRejectedValue(new Error('capture failed'));
            await expect(main(makeInputs())).rejects.toThrow('capture failed');
            expect(mockReadFile).not.toHaveBeenCalled();
        });
    });

    describe('Clang capture', () => {
        beforeEach(() => {
            mockResolveCompilerInfo.mockResolvedValue({ compiler: 'clang', majorVersion: '18' });
        });

        it('merges profraw and exports with explicit binaries', async () => {
            await main(makeInputs({
                buildDir: ['build'],
                profrawPattern: 'default-*.profraw',
                binaries: ['build/test_a']
            }));
            expect(mockFindLlvmProfdata).toHaveBeenCalledWith('18');
            expect(mockFindLlvmCov).toHaveBeenCalledWith('18');
            expect(mockMergeProfrawFiles).toHaveBeenCalledWith({
                llvmProfdataPath: '/usr/bin/llvm-profdata-18',
                buildDirs: ['build'],
                profrawPattern: 'default-*.profraw',
                outputDir: OUTPUT_DIR
            });
            expect(mockDiscoverExecutables).not.toHaveBeenCalled();
            expect(mockExportClangCoverage).toHaveBeenCalledWith({
                llvmCovPath: '/usr/bin/llvm-cov-18',
                profdataPath: '/tmp/merged.profdata',
                binaries: ['build/test_a'],
                outputDir: OUTPUT_DIR
            });
            expect(mockReadFile).toHaveBeenCalledWith('/tmp/clang.info', 'utf-8');
            expect(mockFindGcov).not.toHaveBeenCalled();
        });

        it('auto-discovers executables when no binaries are given', async () => {
            mockDiscoverExecutables.mockResolvedValue(['build/t1', 'build/t2']);
            await main(makeInputs({ buildDir: ['build'] }));
            expect(mockDiscoverExecutables).toHaveBeenCalledWith(['build']);
            expect(mockCore.info).toHaveBeenCalledWith('Discovered 2 executable(s): build/t1, build/t2');
            expect(mockExportClangCoverage).toHaveBeenCalledWith(
                expect.objectContaining({ binaries: ['build/t1', 'build/t2'] })
            );
        });

        it('passes an empty binary list to export when discovery finds nothing', async () => {
            await main(makeInputs());
            expect(mockCore.info).not.toHaveBeenCalledWith(expect.stringContaining('Discovered'));
            expect(mockExportClangCoverage).toHaveBeenCalledWith(
                expect.objectContaining({ binaries: [] })
            );
        });

        it('propagates tool lookup failures without merging', async () => {
            mockFindLlvmCov.mockRejectedValue(new Error('llvm-cov missing'));
            await expect(main(makeInputs())).rejects.toThrow('llvm-cov missing');
            expect(mockMergeProfrawFiles).not.toHaveBeenCalled();
        });

        it('propagates merge failures without exporting', async () => {
            mockMergeProfrawFiles.mockRejectedValue(new Error('no profraw'));
            await expect(main(makeInputs())).rejects.toThrow('no profraw');
            expect(mockExportClangCoverage).not.toHaveBeenCalled();
        });

        it('propagates export failures', async () => {
            mockExportClangCoverage.mockRejectedValue(new Error('export failed'));
            await expect(main(makeInputs())).rejects.toThrow('export failed');
            expect(mockReadFile).not.toHaveBeenCalled();
        });
    });

    describe('filtering', () => {
        it('keeps all sections and computes outputs when no filters are set', async () => {
            const result = await main(makeInputs());
            const written = mockWriteLcovFile.mock.calls[0][0];
            expect(sourceFiles(written)).toEqual(['/repo/src/a.cpp', '/repo/test/t.cpp']);
            expect(mockWriteLcovFile.mock.calls[0][1]).toBe(OUTPUT_DIR);
            expect(result).toEqual(expect.objectContaining({
                lcovFile: LCOV_OUT,
                htmlReportDir: '',
                linesCovered: '2',
                linesTotal: '3',
                linesPercent: '66.7',
                functionsCovered: '1',
                functionsTotal: '1',
                branchesCovered: '1',
                branchesTotal: '2',
                branchesPercent: '50.0'
            }));
            expect(mockCore.info).toHaveBeenCalledWith('Coverage: 2/3 lines, 1/1 functions, 1/2 branches');
            expect(mockCore.info).not.toHaveBeenCalledWith(expect.stringContaining('Filtered LCOV'));
        });

        it('applies include patterns', async () => {
            const result = await main(makeInputs({ include: ['/repo/src/**'] }));
            expect(sourceFiles(mockWriteLcovFile.mock.calls[0][0])).toEqual(['/repo/src/a.cpp']);
            expect(result.linesCovered).toBe('1');
            expect(result.linesTotal).toBe('2');
            expect(mockCore.info).toHaveBeenCalledWith('Filtered LCOV: 1 section(s) remaining');
        });

        it('applies exclude patterns', async () => {
            const result = await main(makeInputs({ exclude: ['/repo/src/**'] }));
            expect(sourceFiles(mockWriteLcovFile.mock.calls[0][0])).toEqual(['/repo/test/t.cpp']);
            expect(result.branchesTotal).toBe('0');
            expect(mockCore.info).toHaveBeenCalledWith('Coverage: 1/1 lines, 0/0 functions');
        });

        it('reports the number of lines stripped by exclusion markers', async () => {
            mockStripExclMarkers.mockImplementation(async (data) =>
                data.map(s => ({ ...s, lines: s.lines.filter(l => l.count > 0) }))
            );
            const result = await main(makeInputs({ stripExclMarkers: true }));
            expect(mockStripExclMarkers).toHaveBeenCalledTimes(1);
            expect(mockCore.info).toHaveBeenCalledWith('Stripped 1 line(s) via LCOV_EXCL / GCOV_EXCL markers');
            expect(result.linesTotal).toBe('2');
        });

        it('reports when no exclusion markers were found', async () => {
            await main(makeInputs({ stripExclMarkers: true }));
            expect(mockCore.info).toHaveBeenCalledWith('No LCOV_EXCL / GCOV_EXCL markers found');
        });

        it('skips marker stripping when disabled', async () => {
            await main(makeInputs({ stripExclMarkers: false }));
            expect(mockStripExclMarkers).not.toHaveBeenCalled();
        });

        it('propagates read errors of the raw LCOV file', async () => {
            mockReadFile.mockRejectedValue(new Error('ENOENT'));
            await expect(main(makeInputs())).rejects.toThrow('ENOENT');
            expect(mockWriteLcovFile).not.toHaveBeenCalled();
        });
    });

    describe('new-code analysis', () => {
        it('computes new-code metrics from changed lines', async () => {
            mockGetChangedLines.mockResolvedValue(new Map([
                ['/repo/src/a.cpp', new Set([1, 2])]
            ]));
            const result = await main(makeInputs({ diffBase: 'origin/main' }));
            expect(mockGetChangedLines).toHaveBeenCalledWith('origin/main');
            expect(result.newLinesCovered).toBe('1');
            expect(result.newLinesTotal).toBe('2');
            expect(result.newLinesPercent).toBe('50.0');
            expect(mockCore.info).toHaveBeenCalledWith('New code: 1/2 lines covered');
        });

        it('reports zero new-code metrics when nothing changed', async () => {
            const result = await main(makeInputs());
            expect(result.newLinesCovered).toBe('0');
            expect(result.newLinesTotal).toBe('0');
            expect(result.newLinesPercent).toBe('0.0');
            expect(mockCore.info).not.toHaveBeenCalledWith(expect.stringContaining('New code:'));
        });

        it('warns and continues when the diff analysis throws an Error', async () => {
            mockGetChangedLines.mockRejectedValue(new Error('git exploded'));
            const result = await main(makeInputs());
            expect(mockCore.warning).toHaveBeenCalledWith('New-code analysis failed: git exploded');
            expect(result.newLinesTotal).toBe('0');
            expect(result.linesTotal).toBe('3');
        });

        it('warns with the stringified value when a non-Error is thrown', async () => {
            mockGetChangedLines.mockRejectedValue('bad ref');
            await main(makeInputs());
            expect(mockCore.warning).toHaveBeenCalledWith('New-code analysis failed: bad ref');
        });
    });

    describe('HTML report', () => {
        const reportDir = path.join(OUTPUT_DIR, 'html-report');

        it('is skipped when html-report is disabled', async () => {
            await main(makeInputs({ htmlReport: false }));
            expect(mockFindGenhtml).not.toHaveBeenCalled();
            expect(mockGenerateHtmlReport).not.toHaveBeenCalled();
        });

        it('generates the report and uploads it with an auto-generated artifact name', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            const result = await main(makeInputs({ htmlReport: true, htmlReportRetentionDays: 7 }));
            expect(mockGenerateHtmlReport).toHaveBeenCalledWith(LCOV_OUT, reportDir, '/usr/bin/genhtml');
            expect(result.htmlReportDir).toBe(reportDir);
            expect(mockUploadHtmlArtifact).toHaveBeenCalledWith(reportDir, 'coverage-report-gcc-linux', 7);
        });

        it('uses the compiler and platform in the auto artifact name', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockResolveCompilerInfo.mockResolvedValue({ compiler: 'clang', majorVersion: '18' });
            await main(makeInputs({ htmlReport: true, binaries: ['b'] }));
            expect(mockUploadHtmlArtifact).toHaveBeenCalledWith(reportDir, 'coverage-report-clang-darwin', 30);
        });

        it('uses a custom artifact name as-is', async () => {
            await main(makeInputs({ htmlReport: true, htmlReportArtifact: 'my-report' }));
            expect(mockUploadHtmlArtifact).toHaveBeenCalledWith(reportDir, 'my-report', 30);
        });

        it('skips the upload when the artifact name is empty', async () => {
            const result = await main(makeInputs({ htmlReport: true, htmlReportArtifact: '' }));
            expect(result.htmlReportDir).toBe(reportDir);
            expect(mockUploadHtmlArtifact).not.toHaveBeenCalled();
        });

        it('leaves html-report-dir empty when generation produces nothing', async () => {
            mockGenerateHtmlReport.mockResolvedValue('');
            const result = await main(makeInputs({ htmlReport: true }));
            expect(result.htmlReportDir).toBe('');
            expect(mockUploadHtmlArtifact).not.toHaveBeenCalled();
        });

        it('warns and passes no genhtml path when genhtml cannot be found', async () => {
            mockFindGenhtml.mockRejectedValue(new Error('not installed'));
            await main(makeInputs({ htmlReport: true }));
            expect(mockCore.warning).toHaveBeenCalledWith(
                'Failed to find or install genhtml — skipping HTML report. not installed'
            );
            expect(mockGenerateHtmlReport).toHaveBeenCalledWith(LCOV_OUT, reportDir, undefined);
        });

        it('stringifies non-Error genhtml lookup failures', async () => {
            mockFindGenhtml.mockRejectedValue('boom');
            await main(makeInputs({ htmlReport: true }));
            expect(mockCore.warning).toHaveBeenCalledWith(
                'Failed to find or install genhtml — skipping HTML report. boom'
            );
        });
    });

    describe('step summary', () => {
        it('is skipped when summary is disabled', async () => {
            await main(makeInputs({ summary: false }));
            expect(mockWriteSummary).not.toHaveBeenCalled();
        });

        it('writes metrics, new-code data and codecov flag', async () => {
            const changed = new Map([['/repo/src/a.cpp', new Set([1])]]);
            mockGetChangedLines.mockResolvedValue(changed);
            await main(makeInputs({ summary: true, codecovToken: 'tok' }));
            expect(mockWriteSummary).toHaveBeenCalledTimes(1);
            const [metrics, newCode, opts] = mockWriteSummary.mock.calls[0];
            expect(metrics).toEqual(expect.objectContaining({ linesCovered: 2, linesTotal: 3 }));
            expect(newCode).toEqual(expect.objectContaining({ coveredLines: 1, totalLines: 1 }));
            expect(opts!.codecov).toBe(true);
            expect(opts!.changedLines).toBe(changed);
            expect(sourceFiles(opts!.lcovData!)).toEqual(['/repo/src/a.cpp', '/repo/test/t.cpp']);
        });

        it('passes codecov=false when no token is set', async () => {
            await main(makeInputs({ summary: true }));
            expect(mockWriteSummary.mock.calls[0][2]!.codecov).toBe(false);
        });

        it('warns instead of failing when the summary throws', async () => {
            mockWriteSummary.mockRejectedValue(new Error('no GITHUB_STEP_SUMMARY'));
            const result = await main(makeInputs({ summary: true }));
            expect(mockCore.warning).toHaveBeenCalledWith('Step summary failed: no GITHUB_STEP_SUMMARY');
            expect(result.lcovFile).toBe(LCOV_OUT);
            expect(mockRunUploads).toHaveBeenCalled();
        });

        it('stringifies non-Error summary failures', async () => {
            mockWriteSummary.mockRejectedValue(42);
            await main(makeInputs({ summary: true }));
            expect(mockCore.warning).toHaveBeenCalledWith('Step summary failed: 42');
        });
    });

    describe('uploads', () => {
        it('forwards upload settings and the final LCOV file', async () => {
            await main(makeInputs({
                failOnUploadError: false,
                codecovToken: 'ctok',
                codecovFlags: 'unit',
                codecovArgs: '--verbose',
                coverallsToken: 'vtok',
                coverallsArgs: '--debug'
            }));
            expect(mockRunUploads).toHaveBeenCalledWith({
                lcovFile: LCOV_OUT,
                failOnUploadError: false,
                codecovToken: 'ctok',
                codecovFlags: 'unit',
                codecovArgs: '--verbose',
                coverallsToken: 'vtok',
                coverallsArgs: '--debug'
            });
        });

        it('propagates upload failures', async () => {
            mockRunUploads.mockRejectedValue(new Error('codecov down'));
            await expect(main(makeInputs())).rejects.toThrow('codecov down');
        });
    });
});
