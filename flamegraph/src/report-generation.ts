/**
 * Report generation for flamegraph action.
 *
 * Provides classes and functions for collecting compilation statistics
 * and generating markdown reports.
 *
 * @module report-generation
 */

/**
 * Rounds a number to the specified precision.
 *
 * @param value - Number to round
 * @param precision - Number of decimal places
 * @returns Rounded number
 */
export function round(value: number, precision: number): number {
    return parseFloat(value.toFixed(precision));
}

/**
 * Formats a duration in microseconds to a human-readable string.
 *
 * @param microseconds - Duration in microseconds
 * @returns Formatted time string with appropriate unit
 */
export function formatTimeStr(microseconds: number): string {
    if (microseconds < 1000) {
        return `${round(microseconds, 2)} µs`;
    }
    if (microseconds < 1000000) {
        const milliseconds = round(microseconds / 1000, 2);
        return `${milliseconds} ms`;
    }
    if (microseconds < 60000000) {
        const seconds = round(microseconds / 1000000, 2);
        return `${seconds} s`;
    }
    if (microseconds < 3600000000) {
        const minutes = round(microseconds / 60000000, 2);
        return `${minutes} min`;
    }
    const hours = round(microseconds / 3600000000, 2);
    return `${hours} h`;
}

/**
 * Escapes HTML special characters in a string.
 *
 * @param str - String to escape
 * @returns HTML-escaped string
 */
export function HTMLEscape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Converts template parameters in a string to placeholders.
 *
 * @param inputString - String with template parameters
 * @returns String with template parameters replaced
 */
export function convertTemplateString(inputString: string): string {
    let level = 0;
    let outputStr = '';
    for (const c of inputString) {
        if (level === 0) {
            outputStr += c;
        }
        if (c === '<') {
            if (level === 0) {
                outputStr += '$';
            }
            level += 1;
        } else if (c === '>') {
            level -= 1;
            if (level === 0) {
                outputStr += c;
            }
        }
    }
    return outputStr;
}

/**
 * Checks if a symbol is from the standard library.
 *
 * @param symbolStr - Symbol name to check
 * @returns True if the symbol is a standard library symbol
 */
export function isStdSymbol(symbolStr: string): boolean {
    return symbolStr.startsWith('std::') ||
        symbolStr.startsWith('__gnu_cxx::') ||
        symbolStr.startsWith('_M_') ||
        symbolStr.startsWith('_mm_') ||
        symbolStr.startsWith('__');
}

/**
 * Class to store count and duration values.
 */
export class CountDuration {
    count: number;
    duration: number;

    constructor(count = 0, duration = 0) {
        this.count = count;
        this.duration = duration;
    }

    /**
     * Updates count and duration with the given increments.
     *
     * @param countIncrement - Amount to add to count
     * @param durationIncrement - Amount to add to duration
     */
    update(countIncrement: number, durationIncrement: number): void {
        this.count += countIncrement;
        this.duration += durationIncrement;
    }

    /**
     * Calculates the average duration per count.
     *
     * @returns Average duration per event
     */
    averageDuration(): number {
        return this.duration / this.count;
    }
}

/**
 * Main class to store report data.
 */
export class ReportData {
    totalCompile: CountDuration;
    totalFrontend: CountDuration;
    totalParsing: CountDuration;
    totalInstantiations: CountDuration;
    totalBackend: CountDuration;
    totalCodegen: CountDuration;
    totalOptimize: CountDuration;
    fileCompile: Record<string, CountDuration>;
    fileParse: Record<string, CountDuration>;
    symbolParse: Record<string, CountDuration>;
    symbolInstantiate: Record<string, CountDuration>;
    symbolSetInstantiate: Record<string, CountDuration>;

    constructor() {
        this.totalCompile = new CountDuration();
        this.totalFrontend = new CountDuration();
        this.totalParsing = new CountDuration();
        this.totalInstantiations = new CountDuration();
        this.totalBackend = new CountDuration();
        this.totalCodegen = new CountDuration();
        this.totalOptimize = new CountDuration();
        this.fileCompile = {};
        this.fileParse = {};
        this.symbolParse = {};
        this.symbolInstantiate = {};
        this.symbolSetInstantiate = {};
    }

    /**
     * Adds file data of the specified type.
     *
     * @param fileName - File name to add data for
     * @param count - Count value
     * @param duration - Duration value
     * @param type - Type of data (compile or parse)
     */
    addFileData(fileName: string, count: number, duration: number, type: 'compile' | 'parse' = 'compile'): void {
        const key = (type === 'compile' ? 'fileCompile' : 'fileParse') as 'fileCompile' | 'fileParse';
        if (!this[key][fileName]) {
            this[key][fileName] = new CountDuration(count, duration);
        } else {
            this[key][fileName].update(count, duration);
        }
    }

    /**
     * Adds file compile data.
     *
     * @param fileName - File name
     * @param count - Count value
     * @param duration - Duration value
     */
    addFileCompileData(fileName: string, count: number, duration: number): void {
        this.addFileData(fileName, count, duration, 'compile');
    }

    /**
     * Adds file parse data.
     *
     * @param fileName - File name
     * @param count - Count value
     * @param duration - Duration value
     */
    addFileParseData(fileName: string, count: number, duration: number): void {
        this.addFileData(fileName, count, duration, 'parse');
    }

    /**
     * Adds symbol data of the specified type.
     *
     * @param symbolName - Symbol name
     * @param count - Count value
     * @param duration - Duration value
     * @param type - Type of data (parse, instantiate, or set_instantiate)
     */
    addSymbolData(symbolName: string, count: number, duration: number, type: 'parse' | 'instantiate' | 'set_instantiate' = 'parse'): void {
        const keyMap = { parse: 'symbolParse', instantiate: 'symbolInstantiate', set_instantiate: 'symbolSetInstantiate' } as const;
        const key = keyMap[type];
        if (!this[key][symbolName]) {
            this[key][symbolName] = new CountDuration(count, duration);
        } else {
            this[key][symbolName].update(count, duration);
        }

        if (type === 'instantiate') {
            const symbolSet = convertTemplateString(symbolName);
            this.addSymbolData(symbolSet, count, duration, 'set_instantiate');
        }
    }

    /**
     * Adds symbol parse data.
     *
     * @param symbolName - Symbol name
     * @param count - Count value
     * @param duration - Duration value
     */
    addSymbolParseData(symbolName: string, count: number, duration: number): void {
        this.addSymbolData(symbolName, count, duration, 'parse');
    }

    /**
     * Adds symbol instantiation data.
     *
     * @param symbolName - Symbol name
     * @param count - Count value
     * @param duration - Duration value
     */
    addSymbolInstantiateData(symbolName: string, count: number, duration: number): void {
        this.addSymbolData(symbolName, count, duration, 'instantiate');
    }
}

/**
 * Filters out standard library symbols from a map.
 *
 * @param symbolsMap - Map of symbols to their count/duration data
 * @returns Map containing only non-standard-library symbols
 */
export function filterProjectSymbols(symbolsMap: Record<string, CountDuration>): Record<string, CountDuration> {
    const projectSymbols: Record<string, CountDuration> = {};
    for (const [symbol, v] of Object.entries(symbolsMap)) {
        if (!isStdSymbol(symbol)) {
            projectSymbols[symbol] = v;
        }
    }
    return projectSymbols;
}

/**
 * Generates a markdown table for a report section.
 *
 * @param columnName - Name for the first column
 * @param data - Map of item names to their count/duration data
 * @returns Markdown table string
 */
export function sectionTable(columnName: string, data: Record<string, CountDuration>): string {
    const sortedData = Object.entries(data).sort((a, b) => b[1].duration - a[1].duration);
    let totalDuration = 0;
    for (const [_, v] of Object.entries(data)) {
        totalDuration += v.duration;
    }

    let content = `Total Time: ${formatTimeStr(totalDuration)}\n\n`;

    let totalMajorityDuration = 0;
    let totalMajorityCount = 0;
    for (const [_, v] of sortedData) {
        totalMajorityDuration += v.duration;
        totalMajorityCount += 1;
        if (totalMajorityDuration > totalDuration / 2) {
            break;
        }
    }
    const isPlural = totalMajorityCount !== 1;
    content += `${totalMajorityCount}/${sortedData.length} item${isPlural ? 's' : ''} (${round(100 * totalMajorityCount / sortedData.length, 2)}%) contribute${isPlural ? '' : 's'} to ${round(100 * totalMajorityDuration / totalDuration, 2)}% of the time\n\n`;

    function appendTable(maxRows: number) {
        content += `| ${columnName} | %    | Total Time | Avg. | Count |\n`;
        content += '| --------- | ---------- | ---------- | ------------ | ----- |\n';
        let n = 0;
        for (const [keyName, v] of sortedData) {
            content += `| ${HTMLEscape(keyName)} | ${round(100 * v.duration / totalDuration, 2)}% | ${formatTimeStr(v.duration)} | ${formatTimeStr(v.duration / v.count)} | ${v.count} |\n`;
            n += 1;
            if (n > maxRows) {
                break;
            }
        }
        content += '\n\n';
    }

    appendTable(7);
    if (sortedData.length <= 7) {
        return content;
    }
    content += '<details>\n<summary>More...</summary>\n\n';
    appendTable(100);
    content += '</details>\n\n';
    return content;
}

/**
 * Generates a markdown report summarizing compilation time statistics.
 *
 * Creates tables showing time spent in each compilation phase (frontend, backend,
 * parsing, instantiation, code generation, optimization) and per-file breakdowns.
 *
 * @param reportData - Aggregate statistics collected from trace processing
 * @returns Markdown-formatted report string
 */
export function generateReport(reportData: ReportData): string {
    let content = `# Time Trace Report\n\n`;
    content += `## Summary\n\n`;
    content += `| Step | %     | Total Time | Avg. | Count |\n`;
    content += `| --------- | ----- | ---------- | ------------ | ----- |\n`;
    const totalCompile = reportData.totalCompile.duration;
    if (reportData.totalCompile.count !== 0) {
        const datum = reportData.totalCompile;
        content += `| Compile   | 100%   | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.totalFrontend.count !== 0) {
        const datum = reportData.totalFrontend;
        content += `| 1) Frontend   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${reportData.totalFrontend.count} |\n`;
    }
    if (reportData.totalParsing.count !== 0) {
        const datum = reportData.totalParsing;
        content += `| 1A) Parsing   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.totalInstantiations.count !== 0) {
        const datum = reportData.totalInstantiations;
        content += `| 1B) Instantiations   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.totalBackend.count !== 0) {
        const datum = reportData.totalBackend;
        content += `| 2) Backend   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.totalCodegen.count !== 0) {
        const datum = reportData.totalCodegen;
        content += `| 2A) Code Generation   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.totalOptimize.count !== 0) {
        const datum = reportData.totalOptimize;
        content += `| 2B) Optimization   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    content += `\n\n`;

    content += `## Files\n\n`;
    content += '### Compile\n\n';
    content += sectionTable('File', reportData.fileCompile);
    content += '### Parse\n\n';
    content += sectionTable('File', reportData.fileParse);

    content += '## Project Symbols\n\n';
    content += '### Parse\n\n';
    content += sectionTable('Symbol', filterProjectSymbols(reportData.symbolParse));
    content += '### Instantiate\n\n';
    content += sectionTable('Symbol', filterProjectSymbols(reportData.symbolInstantiate));
    content += '### Instantiate Sets\n\n';
    content += sectionTable('Symbol Set', filterProjectSymbols(reportData.symbolSetInstantiate));

    content += '## All Symbols\n\n';
    content += '### Parse\n\n';
    content += sectionTable('Symbol', reportData.symbolParse);
    content += '### Instantiate\n\n';
    content += sectionTable('Symbol', reportData.symbolInstantiate);
    content += '### Instantiate Sets\n\n';
    content += sectionTable('Symbol Set', reportData.symbolSetInstantiate);
    return content;
}
