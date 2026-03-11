import * as main from './index';
import * as fs from 'fs';
import * as path from 'path';
import { describePrettyErrors } from 'pretty-errors/test-helper';

test('createReadmeFile', async () => {
    const readmePath = path.join(__dirname, '../testOutput', 'README.md');
    await main.createReadmeFile(readmePath);
});

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

describePrettyErrors('flamegraph boom', 'Flamegraph failed');
