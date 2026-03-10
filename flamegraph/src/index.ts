import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact';
import * as fs from 'fs';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import { runAction } from 'action-schema';

import {
    TraceEvent,
    Trace,
    CompileCommand,
    UploadArtifactsInputs,
    MainInputs,
    MainOutputs,
    RawInputs
} from './types';

import { inputsSchema, outputsSchema } from './schema';

import {
    createReadmeFile,
    findTraceFiles,
    openTraceFiles,
    loadCompileCommands,
    loadIncludePaths
} from './trace-files';

import {
    ReportData,
    generateReport
} from './report-generation';

import {
    ArrayMap,
    stackCollapseChromeTracing,
    generateFlameGraph,
    GenerateSVGFlameGraphResult
} from './flamegraph-svg';

/**
 * Gets a display-friendly filename for a trace file.
 *
 * @param filename - The original filename
 * @param buildDir - Build directory path
 * @param compileCommands - Array of compile command entries
 * @param sourceDir - Source directory path
 * @returns Shortened display filename
 */
function getDisplayFilename(filename: string, buildDir: string, compileCommands: CompileCommand[], sourceDir: string): string {
    // Make relative to buildDir
    let displayFilename = path.relative(buildDir, filename);

    // Remove ".json" extension
    displayFilename = displayFilename.slice(0, -5);

    // Attempt to find the original source file
    for (const compileCommand of compileCommands) {
        if (compileCommand.command.includes(displayFilename)) {
            displayFilename = compileCommand.file;
            displayFilename = path.relative(sourceDir, displayFilename);
            break;
        }
    }

    // Remove any segment with the ".dir" suffix
    let segments = displayFilename.split(/[\\/]/);
    segments = segments.filter(segment => !segment.endsWith('.dir'));
    // Remove any "CMakeFiles" segment
    segments = segments.filter(segment => segment !== 'CMakeFiles');
    displayFilename = segments.join('/');

    // If we ended up with a relative path outside the buildDir, make it absolute
    if (displayFilename.includes('../')) {
        displayFilename = path.resolve(displayFilename);
    }

    return displayFilename;
}

/**
 * Checks if a path is a subpath of another path.
 *
 * @param childPath - The potential child path
 * @param parentPath - The potential parent path
 * @returns True if childPath is within parentPath
 */
function isSubpath(childPath: string, parentPath: string): boolean {
    const childPathAbs = path.resolve(childPath);
    const parentPathAbs = path.resolve(parentPath);
    return childPathAbs.startsWith(parentPathAbs + path.sep);
}

/**
 * Adjusts the args.detail field of an event to be a path relative to source or build dir.
 *
 * @param event - The trace event to adjust
 * @param includePaths - Set of include paths for resolution
 * @param sourceDir - Source directory path
 * @param buildDir - Build directory path
 */
function adjustEventDetailFilename(event: TraceEvent, includePaths: Set<string>, sourceDir: string, buildDir: string): void {
    const fnlog = trace_commands.scoped('adjustEventDetailFilename');

    fnlog(`Adjust event detail filename`);
    const eventDetailIsExistingFile =
        event.args &&
        event.args.detail &&
        typeof event.args.detail === 'string';
    if (!eventDetailIsExistingFile) {
        fnlog(`Event does not have a detail field to adjust`);
        return;
    }
    if (event.name === 'ParseFunctionDefinition') {
        // Can't resolve a function definition
        fnlog(`Event is a function definition, can't resolve the file`);
        return;
    }
    if (!event.args || !event.args.detail) {
        return;
    }
    // Some paths contain a spelling, such as:
    // unistd.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>
    const spellingIndex = event.args.detail.indexOf(' <Spelling=');
    if (spellingIndex !== -1) {
        fnlog(`Event has a spelling field, removing it from ${event.args.detail}`);
        event.args.detail = event.args.detail.slice(0, spellingIndex);
        fnlog(`Event detail: ${event.args.detail}`);
    }
    // Some paths contains a final location suffix, such
    // unistd.h:27:1
    // We want to remove these two numbers with regex
    const locationRegex = /:[0-9]+:[0-9]+$/;
    event.args.detail = event.args.detail.replace(locationRegex, '');
    if (isSubpath(event.args.detail, sourceDir)) {
        fnlog(`Event is a source file ${event.args.detail}`);
        event.args.detail = path.relative(sourceDir, event.args.detail);
        fnlog(`Event detail: ${event.args.detail}`);
    } else if (isSubpath(event.args.detail, buildDir)) {
        fnlog(`Event is a build file ${event.args.detail}`);
        event.args.detail = path.relative(buildDir, event.args.detail);
        fnlog(`Event detail: ${event.args.detail}`);
    } else {
        for (const includePath of includePaths) {
            if (isSubpath(event.args.detail, includePath)) {
                fnlog(`Event is an include file ${event.args.detail}`);
                event.args.detail = path.relative(includePath, event.args.detail);
                fnlog(`Event detail: ${event.args.detail}`);
                break;
            }
        }
    }
    event.args.detail = event.args.detail.replace(/\\/g, '/');
    // Remove common stdlib prefixes like llvm-18/lib/clang/18/include with regex
    const commonStdlibPrefixRegexes: [RegExp, string][] = [
        [/^llvm-[0-9]+\/lib\/clang\/[0-9]+\/include\//, '<clang>/'],
        [/^x86_64-linux-gnu\//, '<glibc>/'],
        [/^c\+\+\/[0-9]+\//, '<libstdc++>/']];
    for (const [prefixRegex, newPrefix] of commonStdlibPrefixRegexes) {
        event.args.detail = event.args.detail.replace(prefixRegex, newPrefix);
    }
    // Identify standard library headers. These headers have no extension,
    // no path separator, are all lowercase, and the characters are all
    // alphanumeric or underscores.
    const isStdLibHeader = !path.extname(event.args.detail) &&
        !event.args.detail.includes('/') &&
        /^[a-z0-9_]+$/.test(event.args.detail);
    if (isStdLibHeader) {
        // We put them in angle brackets to distinguish them from user
        // and detail headers
        event.args.detail = `<${event.args.detail}>`;
    }
    fnlog(`Final event detail: ${event.args.detail}`);
}

/**
 * Represents a timestamp range with start and end times.
 */
class TimestampRange {
    start: number;
    end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }
}

/**
 * Collection of timestamp ranges for tracking accounted-for time periods.
 */
class TimestampRanges {
    private ranges: TimestampRange[];

    constructor() {
        this.ranges = [];
    }

    /**
     * Adds a new range to the collection.
     *
     * @param start - Start timestamp
     * @param end - End timestamp
     */
    addRange(start: number, end: number): void {
        this.ranges.push(new TimestampRange(start, end));
    }

    /**
     * Gets all ranges in the collection.
     *
     * @returns Array of timestamp ranges
     */
    getRanges(): TimestampRange[] {
        return this.ranges;
    }

    /**
     * Checks if a timestamp falls within any range.
     *
     * @param ts - Timestamp to check
     * @returns True if timestamp is within any range
     */
    includes(ts: number): boolean {
        for (const range of this.ranges) {
            if (range.start <= ts && ts < range.end) {
                return true;
            }
        }
        return false;
    }
}

/**
 * Updates the report data with event data for compilation analysis.
 *
 * @param event - The trace event to process
 * @param reportData - Report data to update
 * @param parsingRegions - Tracked parsing time regions
 * @param instantiationRegions - Tracked instantiation time regions
 * @param displayFilename - Display filename for the event
 */
function updateReportData(event: TraceEvent, reportData: ReportData, parsingRegions: TimestampRanges, instantiationRegions: TimestampRanges, displayFilename: string): void {
    const fnlog = trace_commands.scoped('adjustEventDetailFilename');

    if (event.name === 'Source') {
        fnlog(`Adding source event ${event.name} (${event.ph}) with duration ${event.dur}`);
        // Add to total
        const ts = event.ts;
        const dur = event.dur || 0;
        const accountedFor = parsingRegions.includes(ts);
        if (!accountedFor) {
            reportData.total_parsing.update(1, dur);
            parsingRegions.addRange(ts, ts + dur);
        }
        // Add to file total
        // ! Some Source events don't have a filename. We default to
        // the display filename
        const file =
            event.args && event.args.detail ?
                event.args.detail :
                displayFilename;
        reportData.addFileParseData(file, 1, dur);
    } else if (event.name.startsWith('Parse') && event.args && event.args.detail) {
        fnlog(`Adding parse event ${event.name} (${event.ph}) with duration ${event.dur}`);
        // const fileParseEventNames = ['ParseDeclarationOrFunctionDefinition', 'ParseTranslationUnit', 'ParseFunctionDefinition']
        const fileParseEventNames = ['ParseDeclarationOrFunctionDefinition'];
        if (fileParseEventNames.includes(event.name)) {
            // Already accounted for in Source event
            return;
        }
        // Add to symbols total
        const dur = event.dur || 0;
        const symbol = event.args.detail;
        reportData.addSymbolParseData(symbol, 1, dur);
    } else if (event.name.startsWith('Instantiate') && event.args && event.args.detail) {
        fnlog(`Adding instantiate event ${event.name} (${event.ph}) with duration ${event.dur}`);
        // Add to total
        const ts = event.ts;
        const dur = event.dur || 0;
        const accountedFor = instantiationRegions.includes(ts);
        if (!accountedFor) {
            reportData.total_instantiations.update(1, dur);
            instantiationRegions.addRange(ts, ts + dur);
        }
        // Add to symbol total
        const symbol = event.args.detail;
        reportData.addSymbolInstantiateData(symbol, 1, dur);
    } else if (event.name === 'PerformPendingInstantiations') {
        fnlog(`Adding perform pending instantiations event ${event.name} (${event.ph}) with duration ${event.dur}`);
        // Add to total
        const ts = event.ts;
        const dur = event.dur || 0;
        reportData.total_instantiations.update(1, dur);
        instantiationRegions.addRange(ts, ts + dur);
    } else if (event.name === 'Frontend') {
        fnlog(`Adding frontend event ${event.name} (${event.ph}) with duration ${event.dur}`);
        reportData.total_frontend.update(1, event.dur || 0);
    } else if (event.name === 'Backend') {
        fnlog(`Adding backend event ${event.name} (${event.ph}) with duration ${event.dur}`);
        reportData.total_backend.update(1, event.dur || 0);
    } else if (event.name === 'Optimizer') {
        fnlog(`Adding optimizer event ${event.name} (${event.ph}) with duration ${event.dur}`);
        reportData.total_optimize.update(1, event.dur || 0);
    } else if (event.name === 'CodeGenPasses') {
        fnlog(`Adding codegen passes event ${event.name} (${event.ph}) with duration ${event.dur}`);
        reportData.total_codegen.update(1, event.dur || 0);
    } else if (event.name === 'ExecuteCompiler') {
        fnlog(`Adding execute compiler event ${event.name} (${event.ph}) with duration ${event.dur}`);
        // Add to total
        const dur = event.dur || 0;
        reportData.total_compile.update(1, dur);
        // Add to files total
        reportData.addFileCompileData(displayFilename, 1, dur);
    } else {
        fnlog(`Unknown event type ${event.name} (Ignored)`);
    }
}

/**
 * Result of combining multiple trace files.
 */
interface CombineTracesResult {
    combinedTrace: Trace;
    reportData: ReportData;
}

/**
 * Combines multiple Clang time-trace files into a single unified trace.
 *
 * Processes trace files from the build directory, adjusts timestamps for sequential display,
 * and collects aggregate statistics for the compile time report.
 *
 * @param sourceDir - Source directory path for resolving relative file references
 * @param buildDir - Build directory containing the time-trace JSON files
 * @returns Combined trace data and aggregate report statistics
 */
async function combineTraces(sourceDir: string, buildDir: string): Promise<CombineTracesResult> {
    const fnlog = trace_commands.scoped('combineTraces');

    const traceFiles = await findTraceFiles(buildDir);
    fnlog(`Found ${traceFiles.size} trace files`);

    const traces = await openTraceFiles(traceFiles);
    fnlog(`Opened ${Object.keys(traces).length} trace files`);

    const compileCommands = await loadCompileCommands(buildDir);
    fnlog(`Loaded ${compileCommands.length} compile commands`);

    const includePaths = await loadIncludePaths(compileCommands);
    fnlog(`Loaded ${includePaths.size} include paths`);

    const aggregateReport = new ReportData();

    // Combine traces
    let startTime = 0;
    const combinedEvents: TraceEvent[] = [];
    let fileTotalTime = 0;
    for (const [filename, trace] of Object.entries(traces)) {
        // A nicer filename for display in the combined trace
        const displayFilename = getDisplayFilename(filename, buildDir, compileCommands, sourceDir);

        /** The parsing regions we have already accounted for */
        const parsingRegions = new TimestampRanges();

        /** The instantiation regions we have already accounted for */
        const instantiationRegions = new TimestampRanges();

        // Sort trace events in descending order of duration
        trace.traceEvents.sort((a, b) => (b.dur || 0) - (a.dur || 0));
        for (const traceEvent of trace.traceEvents) {
            const eventIsTooShort = traceEvent.ph === 'M' || traceEvent.name.startsWith('Total');
            if (eventIsTooShort) {
                continue;
            }

            fnlog(`Processing event ${traceEvent.name} (${traceEvent.ph}) with duration ${traceEvent.dur} in ${displayFilename}`);
            fnlog(`traceEvent: ${JSON.stringify(traceEvent)}`);
            const eventObj = { ...traceEvent };
            fnlog(`Event Object: ${JSON.stringify(eventObj)}`);
            adjustEventDetailFilename(eventObj, includePaths, sourceDir, buildDir);
            updateReportData(eventObj, aggregateReport, parsingRegions, instantiationRegions, displayFilename);

            // Keep track of the main ExecuteCompiler event, which exists for each file
            if (eventObj.name === 'ExecuteCompiler') {
                fileTotalTime = eventObj.dur || 0;
                fnlog(`${displayFilename} took ${fileTotalTime}`);
                // Also set the file name in ExecuteCompiler
                if (!eventObj.args) {
                    eventObj.args = {};
                }
                eventObj.args.detail = displayFilename;
            }

            // Replace source event names with filename
            if (eventObj.name === 'Source') {
                if (eventObj.args && eventObj.args.detail) {
                    eventObj.name = eventObj.args.detail;
                } else {
                    eventObj.name = displayFilename;
                }
                eventObj.cat = 'Source';
            }

            // Offset combined data by start time to make events
            // sequential in the combined timeline
            eventObj.ts += startTime;

            // Put all events in the same pid
            // Different pids tend to be rendered in different tabs in some
            // visualizers, which is not what we want
            eventObj.pid = 0;
            eventObj.tid = 0;

            // Add event to combined data
            combinedEvents.push(eventObj);
        }

        // Increase the start time for the next file
        // Add 1 to avoid issues with simultaneous events
        startTime += fileTotalTime + 1;
    }

    combinedEvents.sort((a, b) => a.ts - b.ts);
    const combinedTrace: Trace = {
        traceEvents: combinedEvents
    };
    return { combinedTrace, reportData: aggregateReport };
}

/**
 * Generates an interactive SVG flame graph from the combined trace data.
 *
 * Processes the trace events into a collapsed stack format and renders an SVG
 * visualization compatible with browser viewing.
 *
 * @param combinedTrace - Combined trace data from multiple compilation units
 * @returns Stack identifiers for the flame graph and the SVG content string
 */
async function generateSVGFlameGraph(combinedTrace: Trace): Promise<GenerateSVGFlameGraphResult> {
    const fnlog = trace_commands.scoped('generateSVGFlameGraph');

    fnlog('Generating Flame Graph');
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Combined trace has ${combinedTrace.traceEvents.length} trace events`);

    core.info('Stacking Traces');
    const stackIdentifiers = stackCollapseChromeTracing(combinedTrace);
    core.info('Generating SVG');
    const SVGContent = generateFlameGraph(stackIdentifiers);
    return { stackIdentifiers, SVGContent };
}

/**
 * Uploads time-trace artifacts to GitHub Actions.
 *
 * @param inputs - Upload configuration including paths
 * @param extraFiles - Additional files to include
 */
async function uploadArtifacts(inputs: UploadArtifactsInputs, extraFiles: string[]): Promise<void> {
    const artifact = new DefaultArtifactClient();
    const { id, size } = await artifact.uploadArtifact(
        'time-traces',
        [inputs.output_path, inputs.report_path, ...extraFiles],
        inputs.build_dir,
        { retentionDays: inputs.package_retention_days }
    );
    trace_commands.log(`Created artifact with id: ${id} (bytes: ${size}`);
}

/**
 * Main entry point for the flamegraph action.
 *
 * Combines time-trace files, generates reports and SVG visualizations,
 * and optionally uploads artifacts to GitHub Actions.
 *
 * @param inputs - Configuration inputs including paths and output options
 * @returns Paths to the generated trace file and SVG visualization
 */
async function main(inputs: MainInputs): Promise<MainOutputs> {
    const fnlog = trace_commands.scoped('main');

    core.startGroup('📊 Combine Time Traces');
    const { combinedTrace, reportData } = await combineTraces(inputs.source_dir, inputs.build_dir);
    fnlog(`Combined trace with ${combinedTrace.traceEvents.length} events`);
    const combinedTracePath = inputs.output_path;
    fs.writeFileSync(combinedTracePath, JSON.stringify(combinedTrace, null, 2));
    core.info(`Saved combined trace to ${combinedTracePath}`);
    core.endGroup();

    core.startGroup('📄 Generate Time Trace Report');
    const reportContent = generateReport(reportData);
    fs.writeFileSync(inputs.report_path, reportContent);
    core.info(`Saved report to ${inputs.report_path}`);
    core.endGroup();

    if (inputs.update_summary) {
        core.startGroup('📄 Time Trace Report Summary');
        core.summary.addRaw(reportContent);
        if (inputs.upload_artifact) {
            core.summary.addRaw('\n\n[For more information and graphics, see the time-trace artifacts](#artifacts)\n\n');
        }
        core.endGroup();
    }

    core.startGroup('🖼️ Generate SVG Time Trace');
    const imagePath = inputs.output_path + '.svg';
    const { SVGContent } = await generateSVGFlameGraph(combinedTrace);
    fs.writeFileSync(imagePath, SVGContent);
    core.endGroup();

    if (inputs.upload_artifact) {
        core.startGroup('📄 Artifact Readme File');
        const readmePath = path.join(path.dirname(inputs.report_path), 'time-trace-readme.md');
        await createReadmeFile(readmePath);
        core.info(`Saved readme to ${readmePath}`);
        core.endGroup();

        core.startGroup('⬆️ Upload Time Trace Artifacts');
        await uploadArtifacts(inputs, [readmePath, imagePath, combinedTracePath]);
        core.endGroup();
    }

    return { traces_path: combinedTracePath, svg_path: imagePath };
}

/**
 * Converts raw schema inputs to the internal MainInputs format.
 *
 * @param raw - Raw inputs from schema parsing
 * @returns Converted inputs for the main function
 */
function convertRawInputs(raw: RawInputs): MainInputs {
    const source_dir = path.resolve(raw.source_dir);
    const build_dir = path.resolve(raw.build_dir);
    return {
        source_dir,
        build_dir,
        output_path: path.resolve(build_dir, raw.output_path),
        report_path: path.resolve(build_dir, raw.report_path),
        update_summary: raw.update_summary,
        upload_artifact: raw.upload_artifact
    };
}

/**
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'Flamegraph',
    main: async (rawInputs: RawInputs) => {
        const inputs = convertRawInputs(rawInputs);
        const outputs = await main(inputs);
        return {
            traces_path: outputs.traces_path,
            svg_path: outputs.svg_path
        };
    },
    callerModule: module
});

export {
    main,
    createReadmeFile,
    combineTraces,
    generateReport,
    generateSVGFlameGraph,
    ArrayMap
};
