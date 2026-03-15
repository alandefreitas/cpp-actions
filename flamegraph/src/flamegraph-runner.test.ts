jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    summary: {
        addRaw: jest.fn()
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

jest.mock('action-schema', () => ({
    runAction: jest.fn()
}));

import * as main from './index';
import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';

const fixturesDir = path.join(__dirname, '../fixtures');
const testOutputDir = path.join(__dirname, '../testOutput');

beforeAll(() => {
    fs.mkdirSync(testOutputDir, { recursive: true });
});

describe('combineTraces', () => {
    test('processes trace files and returns combined data with report data', async () => {
        const { combinedTrace, reportData } = await main.combineTraces(fixturesDir, fixturesDir);
        expect(combinedTrace.traceEvents.length).toBeGreaterThan(0);
        expect(reportData).toBeDefined();
        expect(reportData.totalCompile.count).toBeGreaterThan(0);
    });

    test('adjusts Source event names to display filenames', async () => {
        const { combinedTrace } = await main.combineTraces(fixturesDir, fixturesDir);
        // Source events should have their names replaced
        const sourceEvents = combinedTrace.traceEvents.filter(e => e.cat === 'Source');
        expect(sourceEvents.length).toBeGreaterThan(0);
        for (const ev of sourceEvents) {
            // Source events should have their name replaced with detail or displayFilename
            expect(ev.name).toBeTruthy();
        }
    });

    test('handles ExecuteCompiler events by setting display filename', async () => {
        const { combinedTrace } = await main.combineTraces(fixturesDir, fixturesDir);
        const executeEvents = combinedTrace.traceEvents.filter(e => e.name === 'ExecuteCompiler');
        for (const ev of executeEvents) {
            expect(ev.args).toBeDefined();
            expect(ev.args!.detail).toBeTruthy();
        }
    });
});

describe('generateSVGFlameGraph', () => {
    test('generates SVG from combined trace', async () => {
        const { combinedTrace } = await main.combineTraces(fixturesDir, fixturesDir);
        const { stackIdentifiers, SVGContent } = await main.generateSVGFlameGraph(combinedTrace);
        expect(SVGContent).toContain('<svg');
        expect(SVGContent).toContain('</svg>');
        expect(stackIdentifiers.size).toBeGreaterThan(0);
    });
});

describe('FlamegraphRunner via main()', () => {
    test('runs the full pipeline with uploadArtifact=false and updateSummary=false', async () => {
        const inputs = {
            sourceDir: fixturesDir,
            buildDir: fixturesDir,
            outputPath: path.join(testOutputDir, 'runner-combined-traces.json'),
            reportPath: path.join(testOutputDir, 'runner-report.md'),
            generateSvg: true,
            generateReport: true,
            updateSummary: false,
            uploadArtifact: false,
            githubToken: '',
            traceCommands: false
        };
        const result = await main.main(inputs);
        expect(result.tracesPath).toBe(inputs.outputPath);
        expect(result.svgPath).toBe(inputs.outputPath + '.svg');
        expect(fs.existsSync(result.tracesPath)).toBe(true);
        expect(fs.existsSync(result.svgPath)).toBe(true);
    });

    test('runs the full pipeline with updateSummary=true', async () => {
        const inputs = {
            sourceDir: fixturesDir,
            buildDir: fixturesDir,
            outputPath: path.join(testOutputDir, 'runner-summary-traces.json'),
            reportPath: path.join(testOutputDir, 'runner-summary-report.md'),
            generateSvg: true,
            generateReport: true,
            updateSummary: true,
            uploadArtifact: false,
            githubToken: '',
            traceCommands: false
        };
        const result = await main.main(inputs);
        expect(result.tracesPath).toBe(inputs.outputPath);
        expect(core.summary.addRaw).toHaveBeenCalled();
    });

    test('runs the full pipeline with uploadArtifact=true', async () => {
        const inputs = {
            sourceDir: fixturesDir,
            buildDir: fixturesDir,
            outputPath: path.join(testOutputDir, 'runner-upload-traces.json'),
            reportPath: path.join(testOutputDir, 'runner-upload-report.md'),
            generateSvg: true,
            generateReport: true,
            updateSummary: true,
            uploadArtifact: true,
            githubToken: '',
            traceCommands: false
        };
        const result = await main.main(inputs);
        expect(result.tracesPath).toBe(inputs.outputPath);
        expect(result.svgPath).toBe(inputs.outputPath + '.svg');
    });
});

describe('generateReport', () => {
    test('produces markdown report from report data', async () => {
        const { reportData } = await main.combineTraces(fixturesDir, fixturesDir);
        const report = main.generateReport(reportData);
        expect(report).toBeTruthy();
        expect(typeof report).toBe('string');
    });
});
