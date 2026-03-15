const mockUploadArtifact = jest.fn().mockResolvedValue({ id: 1, size: 100 });

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    summary: {
        addRaw: jest.fn().mockReturnThis()
    }
}));

jest.mock('@actions/artifact', () => ({
    DefaultArtifactClient: jest.fn().mockImplementation(() => ({
        uploadArtifact: mockUploadArtifact
    }))
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as core from '@actions/core';
import * as main from './index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describePrettyErrors } from 'pretty-errors/test-helper';

/**
 * Save stack identifiers to a file
 */
function saveStackIdentifiers(stackIdentifiers: main.ArrayMap): void {
    const stackIdentifiersPath = path.join(__dirname, '../testOutput', 'stackedTraces.txt');
    let contents = '';
    for (const [key, value] of stackIdentifiers) {
        contents += `${key.join(';')} ${value.toFixed(1)}\n`;
    }
    fs.writeFileSync(stackIdentifiersPath, contents);
}

test('combineTraces+Report+Flamegraph', async () => {
    const sourceDir = path.join(__dirname, '../fixtures');
    const buildDir = sourceDir;
    const testOutputDir = path.join(__dirname, '../testOutput');
    fs.mkdirSync(testOutputDir, { recursive: true });
    // Combine and get report data
    const { combinedTrace, reportData } = await main.combineTraces(sourceDir, buildDir);
    expect(combinedTrace.traceEvents.length).toBeGreaterThan(1500);
    const combinedTracePath = path.join(__dirname, '../testOutput', 'combinedTraces.json');
    fs.writeFileSync(combinedTracePath, JSON.stringify(combinedTrace, null, 2));
    expect(reportData.totalCompile.count).toBe(2);
    const reportContent = main.generateReport(reportData);
    expect(reportContent).toBeTruthy();
    const reportPath = path.join(__dirname, '../testOutput', 'report.md');
    fs.writeFileSync(reportPath, reportContent);
    // Generate Flamegraph
    const imagePath = path.join(__dirname, '../testOutput', 'flamegraph.svg');
    const { stackIdentifiers, SVGContent } = await main.generateSVGFlameGraph(combinedTrace);
    saveStackIdentifiers(stackIdentifiers);
    fs.writeFileSync(imagePath, SVGContent);
    expect(fs.existsSync(imagePath)).toBeTruthy();
});

describe('main()', () => {
    let tmpDir: string;
    const fixtureDir = path.join(__dirname, '../fixtures');

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flamegraph-main-'));
        jest.clearAllMocks();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('runs full pipeline with upload and summary enabled', async () => {
        const inputs = {
            traceCommands: false,
            sourceDir: fixtureDir,
            buildDir: fixtureDir,
            outputPath: path.join(tmpDir, 'combined.json'),
            reportPath: path.join(tmpDir, 'report.md'),
            generateSvg: true,
            generateReport: true,
            updateSummary: true,
            githubToken: '',
            uploadArtifact: true
        };

        const result = await main.main(inputs);

        expect(result.tracesPath).toBe(inputs.outputPath);
        expect(result.svgPath).toBe(inputs.outputPath + '.svg');
        expect(fs.existsSync(inputs.outputPath)).toBe(true);
        expect(fs.existsSync(inputs.reportPath)).toBe(true);
        expect(fs.existsSync(result.svgPath)).toBe(true);

        // Verify summary was updated
        expect(core.summary.addRaw).toHaveBeenCalled();

        // Verify artifact was uploaded
        expect(mockUploadArtifact).toHaveBeenCalledWith(
            'time-traces',
            expect.arrayContaining([inputs.outputPath, inputs.reportPath]),
            fixtureDir,
            expect.any(Object)
        );
    });

    test('skips summary and upload when disabled', async () => {
        const inputs = {
            traceCommands: false,
            sourceDir: fixtureDir,
            buildDir: fixtureDir,
            outputPath: path.join(tmpDir, 'combined.json'),
            reportPath: path.join(tmpDir, 'report.md'),
            generateSvg: true,
            generateReport: true,
            updateSummary: false,
            githubToken: '',
            uploadArtifact: false
        };

        const result = await main.main(inputs);

        expect(result.tracesPath).toBe(inputs.outputPath);
        expect(result.svgPath).toBe(inputs.outputPath + '.svg');
        expect(fs.existsSync(inputs.outputPath)).toBe(true);

        // Summary should NOT be updated
        expect(core.summary.addRaw).not.toHaveBeenCalled();

        // Artifact should NOT be uploaded
        expect(mockUploadArtifact).not.toHaveBeenCalled();
    });
});

describePrettyErrors('flamegraph boom', 'Flamegraph failed');
