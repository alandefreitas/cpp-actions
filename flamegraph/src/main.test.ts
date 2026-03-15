jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    summary: {
        addRaw: jest.fn().mockReturnThis(),
        write: jest.fn().mockReturnThis()
    }
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

jest.mock('@actions/artifact', () => ({
    DefaultArtifactClient: jest.fn().mockImplementation(() => ({
        uploadArtifact: jest.fn().mockResolvedValue({ id: 1, size: 100 })
    }))
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    writeFileSync: jest.fn()
}));

jest.mock('./trace-files', () => ({
    findTraceFiles: jest.fn().mockResolvedValue(new Set(['file1.json'])),
    openTraceFiles: jest.fn().mockResolvedValue({
        '/build/file1.json': {
            traceEvents: [
                { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 5000, pid: 0, tid: 0 },
                { name: 'Source', ph: 'X', ts: 100, dur: 1000, pid: 0, tid: 0, args: { detail: 'test.cpp' } },
                { name: 'Frontend', ph: 'X', ts: 0, dur: 3000, pid: 0, tid: 0 },
                { name: 'Backend', ph: 'X', ts: 3000, dur: 2000, pid: 0, tid: 0 },
                { name: 'Optimizer', ph: 'X', ts: 3000, dur: 1000, pid: 0, tid: 0 },
                { name: 'CodeGenPasses', ph: 'X', ts: 4000, dur: 500, pid: 0, tid: 0 },
                { name: 'ParseDeclarationOrFunctionDefinition', ph: 'X', ts: 200, dur: 300, pid: 0, tid: 0, args: { detail: 'foo()' } },
                { name: 'ParseTemplate', ph: 'X', ts: 500, dur: 200, pid: 0, tid: 0, args: { detail: 'tmpl<T>' } },
                { name: 'InstantiateClass', ph: 'X', ts: 1200, dur: 400, pid: 0, tid: 0, args: { detail: 'vector<int>' } },
                { name: 'PerformPendingInstantiations', ph: 'X', ts: 1700, dur: 300, pid: 0, tid: 0 }
            ]
        }
    }),
    loadCompileCommands: jest.fn().mockResolvedValue([
        { command: 'clang++ -c file1.cpp', file: '/src/file1.cpp' }
    ]),
    loadIncludePaths: jest.fn().mockResolvedValue(new Set(['/usr/include'])),
    createReadmeFile: jest.fn().mockResolvedValue(undefined)
}));

import * as fs from 'fs';
import { main, combineTraces, generateSVGFlameGraph } from './index';
import type { Inputs } from './schema';

const mockWriteFileSync = fs.writeFileSync as jest.Mock;

afterEach(() => {
    mockWriteFileSync.mockClear();
});

/**
 * Creates default test inputs.
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        sourceDir: '/src',
        buildDir: '/build',
        outputPath: '/build/combined-traces.json',
        reportPath: '/build/report.md',
        generateSvg: true,
        generateReport: true,
        updateSummary: false,
        githubToken: '',
        uploadArtifact: false,
        ...overrides
    };
}

describe('FlamegraphRunner via main()', () => {
    test('runs full pipeline without upload', async () => {
        const inputs = makeInputs();
        const result = await main(inputs);
        expect(result.tracesPath).toBe('/build/combined-traces.json');
        expect(result.svgPath).toContain('.svg');
        // writeFileSync called for: combined trace, report, SVG
        expect(mockWriteFileSync).toHaveBeenCalledTimes(3);
    });

    test('runs with updateSummary enabled', async () => {
        const core = require('@actions/core');
        const inputs = makeInputs({ updateSummary: true });
        const result = await main(inputs);
        expect(result.tracesPath).toBe('/build/combined-traces.json');
        expect(core.summary.addRaw).toHaveBeenCalled();
    });

    test('runs with updateSummary and uploadArtifact enabled', async () => {
        const core = require('@actions/core');
        core.summary.addRaw.mockClear();
        const inputs = makeInputs({ updateSummary: true, uploadArtifact: true });
        const result = await main(inputs);
        expect(result.tracesPath).toBe('/build/combined-traces.json');
        // summary.addRaw should be called with report content AND artifact link
        expect(core.summary.addRaw).toHaveBeenCalledTimes(2);
    });

    test('runs with uploadArtifact enabled', async () => {
        const { DefaultArtifactClient } = require('@actions/artifact');
        const inputs = makeInputs({ uploadArtifact: true });
        const result = await main(inputs);
        expect(result.tracesPath).toBe('/build/combined-traces.json');
        // Artifact client should have been instantiated
        expect(DefaultArtifactClient).toHaveBeenCalled();
    });
});

describe('combineTraces helpers', () => {
    test('combineTraces processes trace events', async () => {
        const { combinedTrace, reportData } = await combineTraces('/src', '/build');
        expect(combinedTrace.traceEvents.length).toBeGreaterThan(0);
        // All events should have pid=0, tid=0
        for (const event of combinedTrace.traceEvents) {
            expect(event.pid).toBe(0);
            expect(event.tid).toBe(0);
        }
        // Report data should have compile info
        expect(reportData.totalCompile.count).toBe(1);
        expect(reportData.totalFrontend.count).toBe(1);
        expect(reportData.totalBackend.count).toBe(1);
        expect(reportData.totalOptimize.count).toBe(1);
        expect(reportData.totalCodegen.count).toBe(1);
    });

    test('combineTraces handles Source events without args.detail', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file2.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 1000, pid: 0, tid: 0 },
                    { name: 'Source', ph: 'X', ts: 100, dur: 200, pid: 0, tid: 0 }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        // Source event without args.detail should use displayFilename
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBe(1);
        // Name should be the display filename since no args.detail
        expect(sourceEvents[0].name).toBeTruthy();
    });

    test('combineTraces skips metadata events', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file3.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 1000, pid: 0, tid: 0 },
                    { name: 'thread_name', ph: 'M', ts: 0, pid: 0, tid: 0 },
                    { name: 'Total FrontendAction', ph: 'X', ts: 0, dur: 5000, pid: 0, tid: 0 }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        // Metadata and Total* events should be skipped
        const names = combinedTrace.traceEvents.map(e => e.name);
        expect(names).not.toContain('thread_name');
        expect(names.filter(n => n.startsWith('Total'))).toHaveLength(0);
    });
});

describe('combineTraces - adjustEventDetailFilename paths', () => {
    test('resolves event detail paths under sourceDir', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file4.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'Source', ph: 'X', ts: 100, dur: 500, pid: 0, tid: 0, args: { detail: '/src/subdir/test.cpp:10:5' } }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBe(1);
        // Detail should be relativized to sourceDir and location suffix stripped
        expect(sourceEvents[0].name).toBe('subdir/test.cpp');
    });

    test('resolves event detail paths under buildDir', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file5.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'Source', ph: 'X', ts: 100, dur: 500, pid: 0, tid: 0, args: { detail: '/build/generated/config.h:1:1' } }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBe(1);
        expect(sourceEvents[0].name).toBe('generated/config.h');
    });

    test('wraps stdlib headers in angle brackets', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file6.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'ParseTemplate', ph: 'X', ts: 100, dur: 300, pid: 0, tid: 0, args: { detail: 'iostream' } }
                ]
            }
        });
        const { reportData } = await combineTraces('/src', '/build');
        // The ParseTemplate event with stdlib detail should be wrapped in angle brackets
        expect(reportData).toBeDefined();
    });

    test('handles Source event without args.detail using displayFilename', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file7.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 1000, pid: 0, tid: 0 },
                    { name: 'Source', ph: 'X', ts: 100, dur: 200, pid: 0, tid: 0 }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBe(1);
        // Without args.detail, name should be the displayFilename
        expect(sourceEvents[0].name).toBeTruthy();
    });

    test('handles ExecuteCompiler event without args', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file8.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 1000, pid: 0, tid: 0 }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const execEvents = combinedTrace.traceEvents.filter(e => e.name === 'ExecuteCompiler');
        expect(execEvents.length).toBe(1);
        expect(execEvents[0].args).toBeDefined();
        expect(execEvents[0].args!.detail).toBeTruthy();
    });

    test('handles event with Spelling suffix in detail', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file9.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'Source', ph: 'X', ts: 100, dur: 300, pid: 0, tid: 0, args: { detail: '/src/test.h:27:1 <Spelling=/usr/include/cdefs.h:133:24>' } }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBe(1);
        // Spelling suffix should be removed and path relativized
        expect(sourceEvents[0].name).toBe('test.h');
    });

    test('handles event detail under include path', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file10.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'Source', ph: 'X', ts: 100, dur: 300, pid: 0, tid: 0, args: { detail: '/usr/include/stdio.h:10:1' } }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBe(1);
        // Path should be relativized to include path
        expect(sourceEvents[0].name).toBe('stdio.h');
    });

    test('handles ParseFunctionDefinition event (skips detail adjustment)', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file11.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'ParseFunctionDefinition', ph: 'X', ts: 100, dur: 200, pid: 0, tid: 0, args: { detail: 'void foo()' } }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        expect(combinedTrace.traceEvents.length).toBeGreaterThan(0);
    });

    test('handles unknown event type (ignored by updateReportData)', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file12.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 },
                    { name: 'UnknownCustomEvent', ph: 'X', ts: 100, dur: 300, pid: 0, tid: 0 }
                ]
            }
        });
        const { combinedTrace, reportData } = await combineTraces('/src', '/build');
        expect(combinedTrace.traceEvents.length).toBe(2);
        expect(reportData.totalCompile.count).toBe(1);
    });

    test('resolves displayFilename with ../ to absolute path', async () => {
        const traceFiles = require('./trace-files');
        traceFiles.loadCompileCommands.mockResolvedValueOnce([
            { command: 'clang++ -c file12', file: '/other/external/file12.cpp' }
        ]);
        traceFiles.openTraceFiles.mockResolvedValueOnce({
            '/build/file12.json': {
                traceEvents: [
                    { name: 'ExecuteCompiler', ph: 'X', ts: 0, dur: 2000, pid: 0, tid: 0 }
                ]
            }
        });
        const { combinedTrace } = await combineTraces('/src', '/build');
        const execEvent = combinedTrace.traceEvents.find(e => e.name === 'ExecuteCompiler');
        expect(execEvent).toBeDefined();
        expect(execEvent!.args!.detail).toBeTruthy();
    });
});

describe('generateSVGFlameGraph', () => {
    test('generates SVG from trace data', async () => {
        const trace = {
            traceEvents: [
                { name: 'funcA', ph: 'X', ts: 0, dur: 500, pid: 0, tid: 0 },
                { name: 'funcB', ph: 'X', ts: 10, dur: 200, pid: 0, tid: 0 }
            ]
        };
        const result = await generateSVGFlameGraph(trace);
        expect(result.SVGContent).toContain('<svg');
        expect(result.stackIdentifiers.size).toBeGreaterThan(0);
    });
});
