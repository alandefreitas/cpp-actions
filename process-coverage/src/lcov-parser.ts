/**
 * LCOV file parser and serializer.
 *
 * Parses LCOV v1 .info files into structured data, extracts coverage
 * metrics, and serializes structured data back to .info format.
 *
 * @module lcov-parser
 */

/** A single line coverage record (DA:line,count). */
export interface DaRecord {
    /** 1-based line number. */
    line: number;
    /** Execution count for this line. */
    count: number;
}

/** A single branch coverage record (BRDA:line,block,branch,count). */
export interface BrdaRecord {
    /** 1-based line number where the branch occurs. */
    line: number;
    /** Block number within the function. */
    block: number;
    /** Branch number within the block. */
    branch: number;
    /** Execution count for this branch, or `-1` if not taken. */
    count: number;
}

/** A function name record (FN:line,name). */
export interface FnRecord {
    /** 1-based line number where the function begins. */
    line: number;
    /** Function name. */
    name: string;
}

/** A function execution count record (FNDA:count,name). */
export interface FndaRecord {
    /** Execution count for this function. */
    count: number;
    /** Function name. */
    name: string;
}

/** A single source file section within an LCOV file. */
export interface LcovSection {
    /** Test name (TN: record), may be empty. */
    testName: string;
    /** Source file path (SF: record). */
    sourceFile: string;
    /** Function declarations (FN: records). */
    functions: FnRecord[];
    /** Function execution counts (FNDA: records). */
    functionData: FndaRecord[];
    /** Functions found count (FNF: record). */
    functionsFound: number;
    /** Functions hit count (FNH: record). */
    functionsHit: number;
    /** Line coverage data (DA: records). */
    lines: DaRecord[];
    /** Lines found count (LF: record). */
    linesFound: number;
    /** Lines hit count (LH: record). */
    linesHit: number;
    /** Branch coverage data (BRDA: records). */
    branches: BrdaRecord[];
    /** Branches found count (BRF: record). */
    branchesFound: number;
    /** Branches hit count (BRH: record). */
    branchesHit: number;
}

/** An LCOV file represented as an array of source file sections. */
export type LcovFile = LcovSection[];

/** Aggregated coverage metrics extracted from an LCOV file. */
export interface CoverageMetrics {
    /** Number of lines with execution count > 0. */
    linesCovered: number;
    /** Total number of instrumented lines. */
    linesTotal: number;
    /** Number of functions with execution count > 0. */
    functionsCovered: number;
    /** Total number of instrumented functions. */
    functionsTotal: number;
    /** Number of branches with execution count > 0. */
    branchesCovered: number;
    /** Total number of instrumented branches. */
    branchesTotal: number;
}

/**
 * Parses LCOV .info text content into structured data.
 *
 * Handles standard LCOV v1 records: TN, SF, FN, FNDA, FNF, FNH,
 * DA, LF, LH, BRDA, BRF, BRH, and end_of_record.
 *
 * @param content - Raw LCOV .info file content
 * @returns Parsed LCOV file as an array of sections
 */
export function parseLcov(content: string): LcovFile {
    const sections: LcovFile = [];
    let current: LcovSection | null = null;

    const lines = content.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '' || line === 'end_of_record') {
            if (line === 'end_of_record' && current) {
                sections.push(current);
                current = null;
            }
            continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
            continue;
        }

        const tag = line.substring(0, colonIdx);
        const value = line.substring(colonIdx + 1);

        if (tag === 'TN') {
            current = createEmptySection();
            current.testName = value;
            continue;
        }

        if (tag === 'SF') {
            if (!current) {
                current = createEmptySection();
            }
            current.sourceFile = value;
            continue;
        }

        if (!current) {
            continue;
        }

        switch (tag) {
            case 'FN': {
                const commaIdx = value.indexOf(',');
                current.functions.push({
                    line: parseInt(value.substring(0, commaIdx), 10),
                    name: value.substring(commaIdx + 1)
                });
                break;
            }
            case 'FNDA': {
                const commaIdx = value.indexOf(',');
                current.functionData.push({
                    count: parseInt(value.substring(0, commaIdx), 10),
                    name: value.substring(commaIdx + 1)
                });
                break;
            }
            case 'FNF':
                current.functionsFound = parseInt(value, 10);
                break;
            case 'FNH':
                current.functionsHit = parseInt(value, 10);
                break;
            case 'DA': {
                const parts = value.split(',');
                current.lines.push({
                    line: parseInt(parts[0], 10),
                    count: parseInt(parts[1], 10)
                });
                break;
            }
            case 'LF':
                current.linesFound = parseInt(value, 10);
                break;
            case 'LH':
                current.linesHit = parseInt(value, 10);
                break;
            case 'BRDA': {
                const parts = value.split(',');
                const countStr = parts[3];
                current.branches.push({
                    line: parseInt(parts[0], 10),
                    block: parseInt(parts[1], 10),
                    branch: parseInt(parts[2], 10),
                    count: countStr === '-' ? -1 : parseInt(countStr, 10)
                });
                break;
            }
            case 'BRF':
                current.branchesFound = parseInt(value, 10);
                break;
            case 'BRH':
                current.branchesHit = parseInt(value, 10);
                break;
        }
    }

    // Flush trailing section if the file lacks a final end_of_record
    if (current) {
        sections.push(current);
    }

    return sections;
}

/**
 * Serializes structured LCOV data back to .info text format.
 *
 * Produces a valid LCOV file that can be consumed by tools like
 * genhtml, codecov, or coveralls.
 *
 * @param file - Parsed LCOV file sections
 * @returns LCOV .info formatted text
 */
export function serializeLcov(file: LcovFile): string {
    const output: string[] = [];

    for (const section of file) {
        output.push(`TN:${section.testName}`);
        output.push(`SF:${section.sourceFile}`);

        for (const fn of section.functions) {
            output.push(`FN:${fn.line},${fn.name}`);
        }
        for (const fnda of section.functionData) {
            output.push(`FNDA:${fnda.count},${fnda.name}`);
        }
        output.push(`FNF:${section.functionsFound}`);
        output.push(`FNH:${section.functionsHit}`);

        for (const da of section.lines) {
            output.push(`DA:${da.line},${da.count}`);
        }
        output.push(`LF:${section.linesFound}`);
        output.push(`LH:${section.linesHit}`);

        for (const brda of section.branches) {
            const countStr = brda.count === -1 ? '-' : String(brda.count);
            output.push(`BRDA:${brda.line},${brda.block},${brda.branch},${countStr}`);
        }
        output.push(`BRF:${section.branchesFound}`);
        output.push(`BRH:${section.branchesHit}`);

        output.push('end_of_record');
    }

    return output.join('\n') + '\n';
}

/**
 * Extracts aggregated coverage metrics from parsed LCOV data.
 *
 * Sums line, function, and branch coverage across all sections,
 * computing totals from the actual DA/FNDA/BRDA records rather
 * than relying on the summary count fields.
 *
 * @param file - Parsed LCOV file sections
 * @returns Aggregated coverage metrics
 */
export function extractMetrics(file: LcovFile): CoverageMetrics {
    let linesCovered = 0;
    let linesTotal = 0;
    let functionsCovered = 0;
    let functionsTotal = 0;
    let branchesCovered = 0;
    let branchesTotal = 0;

    for (const section of file) {
        for (const da of section.lines) {
            linesTotal++;
            if (da.count > 0) {
                linesCovered++;
            }
        }

        for (const fnda of section.functionData) {
            functionsTotal++;
            if (fnda.count > 0) {
                functionsCovered++;
            }
        }

        for (const brda of section.branches) {
            branchesTotal++;
            if (brda.count > 0) {
                branchesCovered++;
            }
        }
    }

    return {
        linesCovered,
        linesTotal,
        functionsCovered,
        functionsTotal,
        branchesCovered,
        branchesTotal
    };
}

/**
 * Creates an empty LCOV section with default values.
 *
 * @returns A new empty LcovSection
 */
function createEmptySection(): LcovSection {
    return {
        testName: '',
        sourceFile: '',
        functions: [],
        functionData: [],
        functionsFound: 0,
        functionsHit: 0,
        lines: [],
        linesFound: 0,
        linesHit: 0,
        branches: [],
        branchesFound: 0,
        branchesHit: 0
    };
}
