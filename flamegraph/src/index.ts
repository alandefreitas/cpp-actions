import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact';
import * as fs from 'fs';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';
import * as os from 'os';

async function createReadmeFile(readmePath: string): Promise<void> {
    let content = `# Time-Trace reports\n\n`;
    content += `## time-trace-report.md\n\n`;
    content += `This file includes the report also included in your action summary.\n\n`;
    content += `## combined-traces.json.svg\n\n`;
    content += 'This is an interactive graphical representation of the time-traces generated with https://github.com/brendangregg/FlameGraph).\n\n';
    content += 'You can open this file directly in the browser to navigate the results.\n\n';
    content += '## combined-traces.json\n\n';
    content += 'This file includes the combined time-trace files in a single file you can open with https://www.speedscope.app/ or chrome://tracing/.\n\n';
    fs.mkdirSync(path.dirname(readmePath), { recursive: true });
    fs.writeFileSync(readmePath, content);
}

async function findTraceFiles(dir: string): Promise<Set<string>> {
    const traceFiles = new Set<string>();
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const isDir = fs.statSync(filePath).isDirectory();
        if (isDir) {
            const subTraceFiles = await findTraceFiles(filePath);
            for (const subTraceFile of subTraceFiles) {
                traceFiles.add(subTraceFile);
            }
        } else {
            const isTraceFile = file.endsWith('.cpp.json');
            if (!isTraceFile) {
                continue;
            }
            const relativeObjectFile = file.slice(0, -9) + '.cpp.o';
            const objectFile = path.join(dir, relativeObjectFile);
            const objectFileExists = fs.existsSync(objectFile);
            if (isTraceFile && objectFileExists) {
                traceFiles.add(filePath);
            }
        }
    }
    return traceFiles;
}

interface TraceEvent {
    name: string;
    ph: string;
    ts: number;
    dur?: number;
    pid?: number;
    tid?: number;
    args?: {
        detail?: string;
    };
    cat?: string;
}

interface Trace {
    traceEvents: TraceEvent[];
}

async function openTraceFiles(traceFiles: Set<string>): Promise<Record<string, Trace>> {
    const traces: Record<string, Trace> = {};
    for (const traceFile of traceFiles) {
        const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
        traces[traceFile] = trace;
    }
    return traces;
}

async function findCompileCommands(dir: string): Promise<string | undefined> {
    let currentDir = path.resolve(dir);
    while (currentDir !== path.sep) {
        const compileCommandsPath = path.join(currentDir, 'compile_commands.json');
        if (fs.existsSync(compileCommandsPath)) {
            return compileCommandsPath;
        }
        currentDir = path.dirname(currentDir);
    }
    return undefined;
}

interface CompileCommand {
    command: string;
    file: string;
}

async function loadCompileCommands(dir: string): Promise<CompileCommand[]> {
    const compileCommandsPath = await findCompileCommands(dir);
    if (compileCommandsPath === undefined) {
        return [];
    } else {
        return JSON.parse(fs.readFileSync(compileCommandsPath, 'utf8'));
    }
}

async function extractIncludePaths(compileCommand: string): Promise<Set<string>> {
    const includePaths = new Set<string>();
    const isystemRegex = /-isystem\s+(\S+)/g;
    let matches;
    while ((matches = isystemRegex.exec(compileCommand)) !== null) {
        includePaths.add(matches[1]);
    }
    const iOptionRegex = /-I\s*(\S+)/g;
    while ((matches = iOptionRegex.exec(compileCommand)) !== null) {
        includePaths.add(matches[1]);
    }
    return includePaths;
}

async function loadIncludePaths(compileCommands: CompileCommand[]): Promise<Set<string>> {
    const includePaths = new Set<string>();
    for (const compileCommand of compileCommands) {
        const commandIncludes = await extractIncludePaths(compileCommand.command);
        for (const commandInclude of commandIncludes) {
            includePaths.add(commandInclude);
        }
    }
    const PATH = process.env.PATH;
    if (PATH) {
        const PATHIncludes = PATH.split(os.platform() === 'win32' ? ';' : ':');
        for (const PATHInclude of PATHIncludes) {
            includePaths.add(PATHInclude);
        }
    }
    includePaths.add('/usr/include');
    includePaths.add('/usr/local/include');
    includePaths.add('/usr/include/c++');
    includePaths.add('/usr/lib');
    return includePaths;
}

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

function isSubpath(childPath: string, parentPath: string): boolean {
    const childPathAbs = path.resolve(childPath);
    const parentPathAbs = path.resolve(parentPath);
    return childPathAbs.startsWith(parentPathAbs + path.sep);
}

/**
 * Adjust the args.detail field of the event to be a path relative
 * to the sourceDir or buildDir.
 */
function adjustEventDetailFilename(event: TraceEvent, includePaths: Set<string>, sourceDir: string, buildDir: string): void {
    function fnlog(msg: string) {
        trace_commands.log(`adjustEventDetailFilename: ${msg}`);
    }

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

class TimestampRange {
    start: number;
    end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }
}

class TimestampRanges {
    private ranges: TimestampRange[];

    constructor() {
        this.ranges = [];
    }

    addRange(start: number, end: number): void {
        this.ranges.push(new TimestampRange(start, end));
    }

    getRanges(): TimestampRange[] {
        return this.ranges;
    }

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
 * Update the report data with the event data.
 */
function updateReportData(event: TraceEvent, reportData: ReportData, parsingRegions: TimestampRanges, instantiationRegions: TimestampRanges, displayFilename: string): void {
    function fnlog(msg: string) {
        trace_commands.log(`adjustEventDetailFilename: ${msg}`);
    }

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
 * Class to store count and duration values.
 */
class CountDuration {
    count: number;
    duration: number;

    constructor(count = 0, duration = 0) {
        this.count = count;
        this.duration = duration;
    }

    update(countIncrement: number, durationIncrement: number): void {
        this.count += countIncrement;
        this.duration += durationIncrement;
    }

    averageDuration(): number {
        return this.duration / this.count;
    }
}

/**
 * Main class to store report data.
 */
class ReportData {
    total_compile: CountDuration;
    total_frontend: CountDuration;
    total_parsing: CountDuration;
    total_instantiations: CountDuration;
    total_backend: CountDuration;
    total_codegen: CountDuration;
    total_optimize: CountDuration;
    file_compile: Record<string, CountDuration>;
    file_parse: Record<string, CountDuration>;
    symbol_parse: Record<string, CountDuration>;
    symbol_instantiate: Record<string, CountDuration>;
    symbol_set_instantiate: Record<string, CountDuration>;

    constructor() {
        this.total_compile = new CountDuration();
        this.total_frontend = new CountDuration();
        this.total_parsing = new CountDuration();
        this.total_instantiations = new CountDuration();
        this.total_backend = new CountDuration();
        this.total_codegen = new CountDuration();
        this.total_optimize = new CountDuration();
        this.file_compile = {};
        this.file_parse = {};
        this.symbol_parse = {};
        this.symbol_instantiate = {};
        this.symbol_set_instantiate = {};
    }

    addFileData(fileName: string, count: number, duration: number, type: 'compile' | 'parse' = 'compile'): void {
        const key = `file_${type}` as 'file_compile' | 'file_parse';
        if (!this[key][fileName]) {
            this[key][fileName] = new CountDuration(count, duration);
        } else {
            this[key][fileName].update(count, duration);
        }
    }

    addFileCompileData(fileName: string, count: number, duration: number): void {
        this.addFileData(fileName, count, duration, 'compile');
    }

    addFileParseData(fileName: string, count: number, duration: number): void {
        this.addFileData(fileName, count, duration, 'parse');
    }

    addSymbolData(symbolName: string, count: number, duration: number, type: 'parse' | 'instantiate' | 'set_instantiate' = 'parse'): void {
        const key = `symbol_${type}` as 'symbol_parse' | 'symbol_instantiate' | 'symbol_set_instantiate';
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

    addSymbolParseData(symbolName: string, count: number, duration: number): void {
        this.addSymbolData(symbolName, count, duration, 'parse');
    }

    addSymbolInstantiateData(symbolName: string, count: number, duration: number): void {
        this.addSymbolData(symbolName, count, duration, 'instantiate');
    }
}

interface CombineTracesResult {
    combinedTrace: Trace;
    reportData: ReportData;
}

/** Combine trace files into a single trace file and collect data for the report. */
async function combineTraces(sourceDir: string, buildDir: string): Promise<CombineTracesResult> {
    function fnlog(msg: string) {
        trace_commands.log(`combineTraces: ${msg}`);
    }

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

class Event {
    label: string;
    timestamp: number;
    duration: number;
    total_duration: number;

    constructor(label: string, timestamp: number, dur: number) {
        this.label = label;
        this.timestamp = timestamp;
        this.duration = dur;
        this.total_duration = dur;
    }

    getStopTimestamp(): number {
        return this.timestamp + this.duration;
    }
}

/**
 * Combine two numbers into a unique number.
 *
 * This is used to create a unique number for each thread/process pair.
 */
function cantorPairing(a: number, b: number): number {
    const s = a + b;
    return s * (s + 1) / 2 + b;
}

/**
 * Get the trace events from the combined trace object.
 */
function getTraceEvents(combinedTrace: Trace, eventsDict: Record<string, Event[]>): void {
    function fnlog(msg: string) {
        trace_commands.log(`getTraceEvents: ${msg}`);
    }
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Get ${combinedTrace.traceEvents.length} trace events as {Event}`);

    for (const entry of combinedTrace.traceEvents) {
        if (entry.ph === 'X') {
            const cantorVal = String(cantorPairing(entry.tid || 0, entry.pid || 0));
            if (!entry.dur) continue;
            if (!eventsDict[cantorVal]) eventsDict[cantorVal] = [];
            eventsDict[cantorVal].push(new Event(entry.name, parseFloat(String(entry.ts)), parseFloat(String(entry.dur))));
        }
    }
}

/**
 * Load events from the combined trace.
 */
function loadEvents(combinedTrace: Trace): Record<string, Event[]> {
    function fnlog(msg: string) {
        trace_commands.log(`loadEvents: ${msg}`);
    }

    fnlog(`Load events from combined trace`);
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Combined trace has ${combinedTrace.traceEvents.length} trace events`);

    const events: Record<string, Event[]> = {};
    getTraceEvents(combinedTrace, events);
    for (const cantorVal in events) {
        events[cantorVal].sort((a, b) => a.timestamp - b.timestamp);
    }
    return events;
}

class ArrayMap {
    private map: Map<string[], number>;

    constructor() {
        this.map = new Map();
    }

    // Helper function to compare arrays by value
    private arraysEqual(arr1: string[], arr2: string[]): boolean {
        if (arr1.length !== arr2.length) return false;
        return arr1.every((value, index) => value === arr2[index]);
    }

    // Custom setter method
    set(keyArray: string[], value: number): void {
        for (const [key] of this.map) {
            if (this.arraysEqual(key, keyArray)) {
                this.map.set(key, value);
                return;
            }
        }
        this.map.set(keyArray, value);
    }

    // Custom getter method
    get(keyArray: string[]): number | undefined {
        for (const [key] of this.map) {
            if (this.arraysEqual(key, keyArray)) {
                return this.map.get(key);
            }
        }
        return undefined;
    }

    has(keyArray: string[]): boolean {
        for (const key of this.map.keys()) {
            if (this.arraysEqual(key, keyArray)) {
                return true;
            }
        }
        return false;
    }

    // Make the map iterable by implementing the [Symbol.iterator]() method
    [Symbol.iterator](): IterableIterator<[string[], number]> {
        return this.map[Symbol.iterator]();
    }

    // Allow usage of .entries() to iterate over key-value pairs
    entries(): IterableIterator<[string[], number]> {
        return this.map.entries();
    }

    // Allow usage of .keys() to iterate over keys
    keys(): IterableIterator<string[]> {
        return this.map.keys();
    }

    // Allow usage of .values() to iterate over values
    values(): IterableIterator<number> {
        return this.map.values();
    }

    // Optional: Clear the map
    clear(): void {
        this.map.clear();
    }

    // Optional: Get the size of the map
    get size(): number {
        return this.map.size;
    }
}

/**
 * Save the stack to the stack identifiers.
 */
function saveStack(stack: Event[], stackIdentifiers: ArrayMap): void {
    let event: Event | null = null;
    const identifiers: string[] = [];

    for (event of stack) {
        identifiers.push(event.label);
    }

    const existingDuration = stackIdentifiers.has(identifiers) ? stackIdentifiers.get(identifiers)! : 0;
    stackIdentifiers.set(identifiers, existingDuration + event!.total_duration);
}

/**
 * Load stack identifiers from the events.
 */
function loadStackIdentifiers(events: Event[], stackIdentifiers: ArrayMap): void {
    const eventStack: Event[] = [];

    for (const e of events) {
        if (!eventStack.length) {
            eventStack.push(e);
        } else {
            while (eventStack.length && eventStack[eventStack.length - 1].getStopTimestamp() <= e.timestamp) {
                saveStack(eventStack, stackIdentifiers);
                eventStack.pop();
            }

            if (eventStack.length) {
                eventStack[eventStack.length - 1].total_duration -= e.duration;
            }

            eventStack.push(e);
        }
    }

    while (eventStack.length) {
        saveStack(eventStack, stackIdentifiers);
        eventStack.pop();
    }
}

/**
 * Generate a report from the report data.
 */
function stackCollapseChromeTracing(combinedTrace: Trace): ArrayMap {
    // Adapted from https://github.com/brendangregg/FlameGraph/blob/master/stackcollapse-chrome-tracing.py
    function fnlog(msg: string) {
        trace_commands.log(`stackCollapseChromeTracing: ${msg}`);
    }

    fnlog(`Generate stack collapse from combined trace`);
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Combined trace has ${combinedTrace.traceEvents.length} trace events`);

    const stackIdentifiers = new ArrayMap();
    const allEvents = loadEvents(combinedTrace);
    for (const tidPidCantor in allEvents) {
        loadStackIdentifiers(allEvents[tidPidCantor], stackIdentifiers);
    }
    return stackIdentifiers;
}

class SVG {
    private svg: string;

    constructor() {
        this.svg = '';
    }

    header(w: number, h: number, encoding?: string, notestext = ''): void {
        let encAttr = '';
        if (typeof encoding !== 'undefined') {
            encAttr = ` encoding="${encoding}"`;
        }
        this.svg += `<?xml version="1.0"${encAttr} standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" width="${w}" height="${h}" onload="init(evt)" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<!-- Flame graph stack visualization. See https://github.com/brendangregg/FlameGraph for latest version, and http://www.brendangregg.com/flamegraphs.html for examples. -->
<!-- NOTES: ${notestext} -->`;
    }

    include(content: string): void {
        this.svg += content;
    }

    colorAllocate(r: number, g: number, b: number): string {
        return `rgb(${r},${g},${b})`;
    }

    groupStart(attr: Record<string, string>): void {
        const gAttr = Object.keys(attr).filter(key => ['id', 'class'].includes(key))
            .map(key => `${key}="${attr[key]}"`);

        if (attr.g_extra) {
            gAttr.push(attr.g_extra);
        }

        if (attr.href) {
            const aAttr: string[] = [];
            aAttr.push(`xlink:href="${attr.href}"`);
            aAttr.push(`target="${attr.target || '_top'}"`);
            if (attr.a_extra) {
                aAttr.push(attr.a_extra);
            }
            this.svg += `<a ${aAttr.concat(gAttr).join(' ')}>\n`;
        } else {
            this.svg += `<g ${gAttr.join(' ')}>\n`;
        }

        if (attr.title) {
            this.svg += `<title>${attr.title}</title>\n`;
        }
    }

    groupEnd(attr: Record<string, string>): void {
        this.svg += attr && attr.href ? `</a>\n` : `</g>\n`;
    }

    filledRectangle(x1: number, y1: number, x2: number, y2: number, fill: string, extra = ''): void {
        const x1Str = x1.toFixed(1);
        const w = (x2 - x1).toFixed(1);
        const h = (y2 - y1).toFixed(1);
        this.svg += `<rect x='${x1Str}' y='${y1}' width='${w}' height='${h}' fill='${fill}' ${extra} />\n`;
    }

    stringTTF(id: string | undefined, x: number, y: number, str: string, extra?: string): void {
        const xStr = x.toFixed(2);
        const idStr = id ? `id="${id}"` : '';
        const extraStr = extra || '';
        this.svg += `<text ${idStr} x='${xStr}' y='${y}' ${extraStr}>${str}</text>\n`;
    }

    getSVG(): string {
        return `${this.svg}</svg>\n`;
    }
}

function namehash(name: string): number {
    // Generate a vector hash for the name string, weighting early over
    // later characters. We want to pick the same colors for function
    // names across different flame graphs.
    let vector = 0;
    let weight = 1;
    let max = 1;
    let mod = 10;

    // If module name present, truncate to 1st char
    name = name.replace(/.(.*?)`/, '');

    for (let i = 0; i < name.length; i++) {
        const c = name[i];
        const val = c.charCodeAt(0) % mod;
        vector += (val / (mod++ - 1)) * weight;
        max += weight;
        weight *= 0.70;
        if (mod > 12) break;
    }

    return (1 - vector / max);
}

function sum_namehash(name: string): number {
    // Generate a basic hash for the name string
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char; // Simple hash function
        hash |= 0; // Convert to 32-bit integer
    }
    return hash >>> 0; // Return an unsigned 32-bit integer
}

function random_namehash(name: string): number {
    // Generate a random hash for the name string.
    // This ensures that functions with the same name have the same color,
    // both within a flamegraph and across multiple flamegraphs.

    // Seed random number generator using the hash
    let seed = sum_namehash(name);

    function seededRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }

    return seededRandom();
}

function getColor(type: string, hash: boolean, name: string, rand: boolean): string {
    let v1: number, v2: number, v3: number;

    if (hash) {
        v1 = namehash(name);
        v2 = v3 = namehash([...name].reverse().join(''));
    } else if (rand) {
        v1 = Math.random();
        v2 = Math.random();
        v3 = Math.random();
    } else {
        v1 = random_namehash(name);
        v2 = random_namehash(name);
        v3 = random_namehash(name);
    }

    // theme palettes
    if (type === 'hot') {
        const r = 205 + Math.floor(50 * v3);
        const g = Math.floor(230 * v1);
        const b = Math.floor(55 * v2);
        return `rgb(${r},${g},${b})`;
    }
    if (type === 'mem') {
        const r = 0;
        const g = 190 + Math.floor(50 * v2);
        const b = Math.floor(210 * v1);
        return `rgb(${r},${g},${b})`;
    }
    if (type === 'io') {
        const r = 80 + Math.floor(60 * v1);
        const g = r;
        const b = 190 + Math.floor(55 * v2);
        return `rgb(${r},${g},${b})`;
    }

    // multi palettes
    if (type === 'java') {
        if (name.match(/_\[j]$/)) {
            type = 'green';
        } else if (name.match(/_\[i]$/)) {
            type = 'aqua';
        } else if (name.match(/^L?(java|javax|jdk|net|org|com|io|sun)\//)) {
            type = 'green';
        } else if (name.includes(':::')) {
            type = 'green';
        } else if (name.includes('::')) {
            type = 'yellow';
        } else if (name.match(/_\[k]$/)) {
            type = 'orange';
        } else {
            type = 'red';
        }
    }
    if (type === 'perl') {
        if (name.includes('::')) {
            type = 'yellow';
        } else if (name.match(/Perl/) || name.match(/\.pl/)) {
            type = 'green';
        } else if (name.match(/_\[k]$/)) {
            type = 'orange';
        } else {
            type = 'red';
        }
    }
    if (type === 'js') {
        if (name.match(/_\[j]$/)) {
            if (name.includes('/')) {
                type = 'green';
            } else {
                type = 'aqua';
            }
        } else if (name.includes('::')) {
            type = 'yellow';
        } else if (name.match(/\/.*\.js/)) {
            type = 'green';
        } else if (name.match(/:/)) {
            type = 'aqua';
        } else if (name.match(/^ $/)) {
            type = 'green';
        } else if (name.match(/_\[k]/)) {
            type = 'orange';
        } else {
            type = 'red';
        }
    }
    if (type === 'wakeup') {
        type = 'aqua';
    }
    if (type === 'chain') {
        if (name.match(/_\[w\]/)) {
            type = 'aqua';
        } else {
            type = 'blue';
        }
    }

    // color palettes
    if (type === 'red') {
        const r = 200 + Math.floor(55 * v1);
        const x = 50 + Math.floor(80 * v1);
        return `rgb(${r},${x},${x})`;
    }
    if (type === 'green') {
        const g = 200 + Math.floor(55 * v1);
        const x = 50 + Math.floor(60 * v1);
        return `rgb(${x},${g},${x})`;
    }
    if (type === 'blue') {
        const b = 205 + Math.floor(50 * v1);
        const x = 80 + Math.floor(60 * v1);
        return `rgb(${x},${x},${b})`;
    }
    if (type === 'yellow') {
        const x = 175 + Math.floor(55 * v1);
        const b = 50 + Math.floor(20 * v1);
        return `rgb(${x},${x},${b})`;
    }
    if (type === 'purple') {
        const x = 190 + Math.floor(65 * v1);
        const g = 80 + Math.floor(60 * v1);
        return `rgb(${x},${g},${x})`;
    }
    if (type === 'aqua') {
        const r = 50 + Math.floor(60 * v1);
        const g = 165 + Math.floor(55 * v1);
        const b = 165 + Math.floor(55 * v1);
        return `rgb(${r},${g},${b})`;
    }
    if (type === 'orange') {
        const r = 190 + Math.floor(65 * v1);
        const g = 90 + Math.floor(65 * v1);
        return `rgb(${r},${g},0)`;
    }

    return 'rgb(0,0,0)';
}

function color_scale(value: number, max: number, negate = false): string {
    let r = 255, g = 255, b = 255;
    if (negate) {
        value = -value;
    }
    if (value > 0) {
        g = b = Math.floor(210 * (max - value) / max);
    } else if (value < 0) {
        r = g = Math.floor(210 * (max + value) / max);
    }
    return `rgb(${r},${g},${b})`;
}

function color_map(colors: string, func: string, paletteMap: Record<string, string>, hash: boolean, rand: boolean): string {
    if (paletteMap[func]) {
        return paletteMap[func];
    } else {
        paletteMap[func] = getColor(colors, hash, func, rand);
        return paletteMap[func];
    }
}

/**
 * Merges two stacks and stores the merged frames and value data in Node.
 */
function flow(last: string[], thisStack: string[], v: number, d: number | undefined, Node: Record<string, { stime?: number; delta?: number }>, Tmp: Record<string, { stime?: number; delta?: number }>): string[] {
    const lenA = last.length - 1;
    const lenB = thisStack.length - 1;

    let i = 0;
    let lenSame;

    for (; i <= lenA; i++) {
        if (i > lenB || last[i] !== thisStack[i]) {
            break;
        }
    }
    lenSame = i;

    for (i = lenA; i >= lenSame; i--) {
        const key = `${last[i]};${i}`;
        // Construct a unique ID from "func;depth;etime"
        // func-depth isn't unique, it may be repeated later.
        if (!Node[`${key};${v}`]) {
            Node[`${key};${v}`] = {};
        }
        Node[`${key};${v}`].stime = Tmp[key]?.stime;
        if (Tmp[key]?.delta !== undefined) {
            Node[`${key};${v}`].delta = Tmp[key].delta;
        }
        delete Tmp[key];
    }

    for (i = lenSame; i <= lenB; i++) {
        const key = `${thisStack[i]};${i}`;
        if (!Tmp[key]) {
            Tmp[key] = {};
        }
        Tmp[key].stime = v;
        if (d !== undefined) {
            Tmp[key].delta = (Tmp[key].delta || 0) + (i === lenB ? d : 0);
        }
    }

    return thisStack;
}

/**
 * Generate a flame graph from the stack identifiers.
 */
function generateFlameGraph(stackIdentifiers: ArrayMap): string {
    function fnlog(msg: string) {
        trace_commands.log(`generateFlameGraph: ${msg}`);
    }

    const interactive = true;

    // font type (default "Verdana")
    const fonttype = 'Verdana';

    // max width, pixels / width of image (default 1200)
    const imagewidth = 1200;

    // max height is dynamic / height of each frame (default 16)
    const frameheight = 16;

    // base text size / font size (default 12)
    const fontsize = 12;

    // avg width relative to fontsize
    const fontwidth = 0.59;

    // min function width, pixels or percentage of time
    // omit smaller functions. In pixels or use "%" for
    // percentage of time (default 0.1 pixels)
    const minwidth = 0.1;

    // name type label (default "Function:")
    // what are the names in the data?
    const nametype = 'Time:';

    // count type label (default "samples")
    // what are the counts in the data?
    const countname = 'µs';

    // set color palette. choices are = hot (default), mem
    // io, wakeup, chain, java, js, perl, red, green, blue
    // aqua, yellow, purple, orange
    // color theme
    let colors: string = 'hot';

    // set background colors. gradient choices are yellow,
    // blue, green, grey; flat colors use "#rrggbb"
    // By default, the background color matches the colors
    let bgcolors = '';

    // factor to scale counts by
    const factor = 1;

    // colors are keyed by function name hash
    // color by function name
    const hash = false;

    // colors are randomly generated
    // color randomly
    const rand = false;

    // use consistent palette
    // if we use consistent palettes (default off)
    const palette = false;

    // change title text
    // centered heading
    const titletext = 'Flame Graph';

    // second level title (optional)
    const subtitletext = '';

    // color for search highlighting
    const searchcolor = 'rgb(230,0,230)';

    // add notes comment in SVG (for debugging)
    // embedded notes in SVG
    const notestext = '';
    if (/[<>]/.test(notestext)) {
        throw new Error('Notes string can\'t contain < or >');
    }

    // pad top, include title
    const ypad1 = fontsize * 3;

    // pad bottom, include labels
    const ypad2 = fontsize * 2 + 10;

    // pad top, include subtitle (optional)
    const ypad3 = fontsize * 2;

    // pad left and right
    const xpad = 10;

    // vertical padding for frames
    const framepad = 1;
    let depthmax = 0;

    // Background colors:
    // - yellow gradient: default (hot, java, js, perl)
    // - green gradient: mem
    // - blue gradient: io, wakeup, chain
    // - gray gradient: flat colors (red, green, blue, ...)
    if (bgcolors === '') {
        // Choose a default
        if (colors === 'mem') {
            bgcolors = 'green';
        } else if (/^(io|wakeup|chain)$/.test(colors)) {
            bgcolors = 'blue';
        } else if (/^(red|green|blue|aqua|yellow|purple|orange)$/.test(colors)) {
            bgcolors = 'grey';
        } else {
            bgcolors = 'yellow';
        }
    }

    let bgcolor1: string, bgcolor2: string;
    if (bgcolors === 'yellow') {
        // background color gradient start
        bgcolor1 = '#eeeeee';
        // background color gradient stop
        bgcolor2 = '#eeeeb0';
    } else if (bgcolors === 'blue') {
        bgcolor1 = '#eeeeee';
        bgcolor2 = '#e0e0ff';
    } else if (bgcolors === 'green') {
        bgcolor1 = '#eef2ee';
        bgcolor2 = '#e0ffe0';
    } else if (bgcolors === 'grey') {
        bgcolor1 = '#f8f8f8';
        bgcolor2 = '#e8e8e8';
    } else if (/^#[0-9a-fA-F]{6}$/.test(bgcolors)) {
        bgcolor1 = bgcolor2 = bgcolors;
    } else {
        // Default to grey if unrecognized
        bgcolor1 = '#f8f8f8';
        bgcolor2 = '#e8e8e8';
    }

    // parse input
    interface DataEntry {
        stack: string;
        duration: number;
    }
    const Data: DataEntry[] = [];
    let SortedData: DataEntry[];
    let last: string[] = [];
    let time = 0;
    const delta = undefined;
    const maxdelta = 1;
    // Hash of merged frame data
    const Node: Record<string, { stime?: number; delta?: number }> = {};
    const Tmp: Record<string, { stime?: number; delta?: number }> = {};

    // Convert stackIdentifiers directly into Data array
    for (const [stack, duration] of stackIdentifiers) {
        const stackString = stack.join(';');
        Data.push({ stack: stackString, duration: duration });
    }

    // Process Data array
    SortedData = Data.slice().sort((a, b) => a.stack.localeCompare(b.stack));

    // process and merge frames
    let ignored = 0;
    for (let i = 0; i < SortedData.length; i++) {
        const entry = SortedData[i];
        let stack = entry.stack;
        const samples = entry.duration;

        if (samples === undefined || stack === undefined || samples <= 0) {
            ignored++;
            continue;
        }

        // For chain graphs, annotate waker frames with "_[w]", for later
        // coloring. This is a hack, but has a precedent ("_[k]" from perf).
        if (colors === 'chain') {
            const parts = stack.split(';--;');
            const newparts: string[] = [];
            stack = parts.shift()!;
            stack += ';--;';
            for (let j = 0; j < parts.length; j++) {
                let part = parts[j];
                part = part.replace(/;/g, '_[w];');
                part += '_[w]';
                newparts.push(part);
            }
            stack += newparts.join(';--;');
        }

        // Merge frames and populate Node
        last = flow(last, ['', ...stack.split(';')], time, delta, Node, Tmp);

        time += samples;
    }

    // Final flow call to merge remaining frames
    flow(last, [], time, delta, Node, Tmp);

    if (time < 100) {
        fnlog(`Stack count is low (${time}). Did something go wrong?`);
    }

    if (ignored > 0) {
        fnlog(`Ignored ${ignored} lines with invalid format`);
    }

    if (time === 0) {
        fnlog('ERROR: No stack counts found');
        const im = new SVG();
        const imageheight = fontsize * 5;
        im.header(imagewidth, imageheight);
        im.stringTTF(undefined, imagewidth / 2, fontsize * 2, 'ERROR: No valid input provided.');
        return im.getSVG();
    }

    const timemax = time;

    const widthpertime = (imagewidth - 2 * xpad) / timemax;

    // Treat as a percentage of time if the string ends in a "%".
    const minwidth_time = minwidth / widthpertime;

    // Sort "Node" by keys
    const sortedNode = Object.keys(Node).sort().reduce((acc, key) => {
        acc[key] = Node[key];
        return acc;
    }, {} as Record<string, { stime?: number; delta?: number }>);

    // Prune blocks that are too narrow and determine max depth
    for (const [id, node] of Object.entries(sortedNode)) {
        const idParts = id.split(';');
        const depth = idParts[1];
        const etime = idParts[2];
        const etimeNum = parseFloat(etime);
        const stime = node.stime;
        if (stime === undefined) {
            throw new Error(`missing start for ${id}`);
        }

        if ((etimeNum - stime) < minwidth_time) {
            delete sortedNode[id];
            continue;
        }
        depthmax = Math.max(parseInt(depth), depthmax);
    }

    let imageheight = ((depthmax + 1) * frameheight) + ypad1 + ypad2;
    if (subtitletext !== '') {
        imageheight += ypad3;
    }

    // Define variables
    const titlesize = fontsize + 5;

    // Create a new SVG instance
    const im = new SVG();

    // Allocate colors using the SVG instance
    // RGB(0, 0, 0)
    const black = im.colorAllocate(0, 0, 0);
    // RGB(160, 160, 160)
    const vdgrey = im.colorAllocate(160, 160, 160);
    // RGB(200, 200, 200)
    const dgrey = im.colorAllocate(200, 200, 200);

    // Set the dimensions of the SVG image
    im.header(imagewidth, imageheight);

    const inc = `
<defs>
	<linearGradient id="background" y1="0" y2="1" x1="0" x2="0" >
		<stop stop-color="${bgcolor1}" offset="5%" />
		<stop stop-color="${bgcolor2}" offset="95%" />
	</linearGradient>
</defs>
<style type="text/css">
	text { font-family:${fonttype}; font-size:${fontsize}px; fill:${black}; }
	#search, #ignorecase { opacity:0.1; cursor:pointer; }
	#search:hover, #search.show, #ignorecase:hover, #ignorecase.show { opacity:1; }
	#subtitle { text-anchor:middle; font-color:${vdgrey}; }
	#title { text-anchor:middle; font-size:${titlesize}px}
	#unzoom { cursor:pointer; }
	#frames > *:hover { stroke:black; stroke-width:0.5; cursor:pointer; }
	.hide { display:none; }
	.parent { opacity:0.5; }
</style>
<script type="text/ecmascript">
<![CDATA[
	"use strict";
	var details, searchbtn, unzoombtn, matchedtxt, svg, searching, currentSearchTerm, ignorecase, ignorecaseBtn;
	function init(evt) {
		details = document.getElementById("details").firstChild;
		searchbtn = document.getElementById("search");
		ignorecaseBtn = document.getElementById("ignorecase");
		unzoombtn = document.getElementById("unzoom");
		matchedtxt = document.getElementById("matched");
		svg = document.getElementsByTagName("svg")[0];
		searching = 0;
		currentSearchTerm = null;

		// use GET parameters to restore a flamegraphs state.
		var params = get_params();
		if (params.x && params.y)
			zoom(find_group(document.querySelector('[x="' + params.x + '"][y="' + params.y + '"]')));
                if (params.s) search(params.s);
	}

	// event listeners
	window.addEventListener("click", function(e) {
		var target = find_group(e.target);
		if (target) {
			if (target.nodeName == "a") {
				if (e.ctrlKey === false) return;
				e.preventDefault();
			}
			if (target.classList.contains("parent")) unzoom(true);
			zoom(target);
			if (!document.querySelector('.parent')) {
				// we have basically done a clearzoom so clear the url
				var params = get_params();
				if (params.x) delete params.x;
				if (params.y) delete params.y;
				history.replaceState(null, null, parse_params(params));
				unzoombtn.classList.add("hide");
				return;
			}

			// set parameters for zoom state
			var el = target.querySelector("rect");
			if (el && el.attributes && el.attributes.y && el.attributes._orig_x) {
				var params = get_params()
				params.x = el.attributes._orig_x.value;
				params.y = el.attributes.y.value;
				history.replaceState(null, null, parse_params(params));
			}
		}
		else if (e.target.id == "unzoom") clearzoom();
		else if (e.target.id == "search") search_prompt();
		else if (e.target.id == "ignorecase") toggle_ignorecase();
	}, false)

	// mouse-over for info
	// show
	window.addEventListener("mouseover", function(e) {
		var target = find_group(e.target);
		if (target) details.nodeValue = "${nametype} " + g_to_text(target);
	}, false)

	// clear
	window.addEventListener("mouseout", function(e) {
		var target = find_group(e.target);
		if (target) details.nodeValue = ' ';
	}, false)

	// ctrl-F for search
	// ctrl-I to toggle case-sensitive search
	window.addEventListener("keydown",function (e) {
		if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 70)) {
			e.preventDefault();
			search_prompt();
		}
		else if (e.ctrlKey && e.keyCode === 73) {
			e.preventDefault();
			toggle_ignorecase();
		}
	}, false)

	// functions
	function get_params() {
		var params = {};
		var paramsarr = window.location.search.substr(1).split('&');
		for (var i = 0; i < paramsarr.length; ++i) {
			var tmp = paramsarr[i].split("=");
			if (!tmp[0] || !tmp[1]) continue;
			params[tmp[0]]  = decodeURIComponent(tmp[1]);
		}
		return params;
	}
	function parse_params(params) {
		var uri = "?";
		for (var key in params) {
			uri += key + '=' + encodeURIComponent(params[key]) + '&';
		}
		if (uri.slice(-1) == "&")
			uri = uri.substring(0, uri.length - 1);
		if (uri == '?')
			uri = window.location.href.split('?')[0];
		return uri;
	}
	function find_child(node, selector) {
		var children = node.querySelectorAll(selector);
		if (children.length) return children[0];
	}
	function find_group(node) {
		var parent = node.parentElement;
		if (!parent) return;
		if (parent.id == "frames") return node;
		return find_group(parent);
	}
	function orig_save(e, attr, val) {
		if (e.attributes["_orig_" + attr] != undefined) return;
		if (e.attributes[attr] == undefined) return;
		if (val == undefined) val = e.attributes[attr].value;
		e.setAttribute("_orig_" + attr, val);
	}
	function orig_load(e, attr) {
		if (e.attributes["_orig_"+attr] == undefined) return;
		e.attributes[attr].value = e.attributes["_orig_" + attr].value;
		e.removeAttribute("_orig_"+attr);
	}
	function g_to_text(e) {
		var text = find_child(e, "title").firstChild.nodeValue;
		return (text)
	}
	function g_to_func(e) {
		var func = g_to_text(e);
		// if there's any manipulation we want to do to the function
		// name before it's searched, do it here before returning.
		return (func);
	}
	function update_text(e) {
		var r = find_child(e, "rect");
		var t = find_child(e, "text");
		var w = parseFloat(r.attributes.width.value) -3;
		var txt = find_child(e, "title").textContent.replace(/\\([^(]*\\)\$/,"");
		t.attributes.x.value = parseFloat(r.attributes.x.value) + 3;

		// Smaller than this size won't fit anything
		if (w < 2 * ${fontsize} * ${fontwidth}) {
			t.textContent = "";
			return;
		}

		t.textContent = txt;
		var sl = t.getSubStringLength(0, txt.length);
		// check if only whitespace or if we can fit the entire string into width w
		if (/^ *\$/.test(txt) || sl < w)
			return;

		// this isn't perfect, but gives a good starting point
		// and avoids calling getSubStringLength too often
		var start = Math.floor((w/sl) * txt.length);
		for (var x = start; x > 0; x = x-2) {
			if (t.getSubStringLength(0, x + 2) <= w) {
				t.textContent = txt.substring(0, x) + "..";
				return;
			}
		}
		t.textContent = "";
	}

	// zoom
	function zoom_reset(e) {
		if (e.attributes != undefined) {
			orig_load(e, "x");
			orig_load(e, "width");
		}
		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_reset(c[i]);
		}
	}
	function zoom_child(e, x, ratio) {
		if (e.attributes != undefined) {
			if (e.attributes.x != undefined) {
				orig_save(e, "x");
				e.attributes.x.value = (parseFloat(e.attributes.x.value) - x - ${xpad}) * ratio + ${xpad};
				if (e.tagName == "text")
					e.attributes.x.value = find_child(e.parentNode, "rect[x]").attributes.x.value + 3;
			}
			if (e.attributes.width != undefined) {
				orig_save(e, "width");
				e.attributes.width.value = parseFloat(e.attributes.width.value) * ratio;
			}
		}

		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_child(c[i], x - ${xpad}, ratio);
		}
	}
	function zoom_parent(e) {
		if (e.attributes) {
			if (e.attributes.x != undefined) {
				orig_save(e, "x");
				e.attributes.x.value = ${xpad};
			}
			if (e.attributes.width != undefined) {
				orig_save(e, "width");
				e.attributes.width.value = parseInt(svg.width.baseVal.value) - (${xpad} * 2);
			}
		}
		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_parent(c[i]);
		}
	}
	function zoom(node) {
		var attr = find_child(node, "rect").attributes;
		var width = parseFloat(attr.width.value);
		var xmin = parseFloat(attr.x.value);
		var xmax = parseFloat(xmin + width);
		var ymin = parseFloat(attr.y.value);
		var ratio = (svg.width.baseVal.value - 2 * ${xpad}) / width;

		// XXX: Workaround for JavaScript float issues (fix me)
		var fudge = 0.0001;

		unzoombtn.classList.remove("hide");

		var el = document.getElementById("frames").children;
		for (var i = 0; i < el.length; i++) {
			var e = el[i];
			var a = find_child(e, "rect").attributes;
			var ex = parseFloat(a.x.value);
			var ew = parseFloat(a.width.value);
			var upstack;
			// Is it an ancestor
            upstack = parseFloat(a.y.value) > ymin;
			if (upstack) {
				// Direct ancestor
				if (ex <= xmin && (ex+ew+fudge) >= xmax) {
					e.classList.add("parent");
					zoom_parent(e);
					update_text(e);
				}
				// not in current path
				else
					e.classList.add("hide");
			}
			// Children maybe
			else {
				// no common path
				if (ex < xmin || ex + fudge >= xmax) {
					e.classList.add("hide");
				}
				else {
					zoom_child(e, xmin, ratio);
					update_text(e);
				}
			}
		}
		search();
	}
	function unzoom(dont_update_text) {
		unzoombtn.classList.add("hide");
		var el = document.getElementById("frames").children;
		for(var i = 0; i < el.length; i++) {
			el[i].classList.remove("parent");
			el[i].classList.remove("hide");
			zoom_reset(el[i]);
			if(!dont_update_text) update_text(el[i]);
		}
		search();
	}
	function clearzoom() {
		unzoom();

		// remove zoom state
		var params = get_params();
		if (params.x) delete params.x;
		if (params.y) delete params.y;
		history.replaceState(null, null, parse_params(params));
	}

	// search
	function toggle_ignorecase() {
		ignorecase = !ignorecase;
		if (ignorecase) {
			ignorecaseBtn.classList.add("show");
		} else {
			ignorecaseBtn.classList.remove("show");
		}
		reset_search();
		search();
	}
	function reset_search() {
		var el = document.querySelectorAll("#frames rect");
		for (var i = 0; i < el.length; i++) {
			orig_load(el[i], "fill")
		}
		var params = get_params();
		delete params.s;
		history.replaceState(null, null, parse_params(params));
	}
	function search_prompt() {
		if (!searching) {
			var term = prompt("Enter a search term (regexp " +
			    "allowed, eg: ^ext4_)"
			    + (ignorecase ? ", ignoring case" : "")
			    + "\\nPress Ctrl-i to toggle case sensitivity", "");
			if (term != null) search(term);
		} else {
			reset_search();
			searching = 0;
			currentSearchTerm = null;
			searchbtn.classList.remove("show");
			searchbtn.firstChild.nodeValue = "Search"
			matchedtxt.classList.add("hide");
			matchedtxt.firstChild.nodeValue = ""
		}
	}
	function search(term) {
		if (term) currentSearchTerm = term;

		var re = new RegExp(currentSearchTerm, ignorecase ? 'i' : '');
		var el = document.getElementById("frames").children;
		var matches = new Object();
		var maxwidth = 0;
		for (var i = 0; i < el.length; i++) {
			var e = el[i];
			var func = g_to_func(e);
			var rect = find_child(e, "rect");
			if (func == null || rect == null)
				continue;

			// Save max width. Only works as we have a root frame
			var w = parseFloat(rect.attributes.width.value);
			if (w > maxwidth)
				maxwidth = w;

			if (func.match(re)) {
				// highlight
				var x = parseFloat(rect.attributes.x.value);
				orig_save(rect, "fill");
				rect.attributes.fill.value = "${searchcolor}";

				// remember matches
				if (matches[x] == undefined) {
					matches[x] = w;
				} else {
					if (w > matches[x]) {
						// overwrite with parent
						matches[x] = w;
					}
				}
				searching = 1;
			}
		}
		if (!searching)
			return;
		var params = get_params();
		params.s = currentSearchTerm;
		history.replaceState(null, null, parse_params(params));

		searchbtn.classList.add("show");
		searchbtn.firstChild.nodeValue = "Reset Search";

		// calculate percent matched, excluding vertical overlap
		var count = 0;
		var lastx = -1;
		var lastw = 0;
		var keys = Array();
		for (k in matches) {
			if (matches.hasOwnProperty(k))
				keys.push(k);
		}
		// sort the matched frames by their x location
		// ascending, then width descending
		keys.sort(function(a, b){
			return a - b;
		});
		// Step through frames saving only the biggest bottom-up frames
		// thanks to the sort order. This relies on the tree property
		// where children are always smaller than their parents.
		var fudge = 0.0001;	// JavaScript floating point
		for (var k in keys) {
			var x = parseFloat(keys[k]);
			var w = matches[keys[k]];
			if (x >= lastx + lastw - fudge) {
				count += w;
				lastx = x;
				lastw = w;
			}
		}
		// display matched percent
		matchedtxt.classList.remove("hide");
		var pct = 100 * count / maxwidth;
		if (pct != 100) pct = pct.toFixed(1)
		matchedtxt.firstChild.nodeValue = "Matched: " + pct + "%";
	}
]]>
</script>
`;

    if (interactive) {
        im.include(inc);
    }

    // Fill the background with a gradient
    im.filledRectangle(0, 0, imagewidth, imageheight, 'url(#background)');

    // Draw title text
    im.stringTTF('title', Math.floor(imagewidth / 2), fontsize * 2, titletext, '');

    // Draw subtitle text if it exists
    if (subtitletext !== '') {
        im.stringTTF('subtitle', Math.floor(imagewidth / 2), fontsize * 4, subtitletext, '');
    }

    if (interactive) {
        // Draw details text
        im.stringTTF('details', xpad, imageheight - (ypad2 / 2), ' ', '');

        // Draw unzoom button with class "hide"
        im.stringTTF('unzoom', xpad, fontsize * 2, 'Reset Zoom', 'class="hide"');

        // Draw search text
        im.stringTTF('search', imagewidth - xpad - 100, fontsize * 2, 'Search', '');

        // Draw ignore case text
        im.stringTTF('ignorecase', imagewidth - xpad - 16, fontsize * 2, 'ic', '');

        // Draw matched text
        im.stringTTF('matched', imagewidth - xpad - 100, imageheight - (ypad2 / 2), ' ', '');
    }

    // Draw frames
    im.groupStart({ id: 'frames' });

    // Iterate over Node objects
    for (const [id, node] of Object.entries(sortedNode)) {
        const [func, depth, etime] = id.split(';');
        const depthNum = parseInt(depth);
        const etimeNum = parseFloat(etime);
        const stime = node.stime!;
        const deltaVal = node.delta;

        const adjustedEtime = (func === '' && depthNum === 0) ? timemax : etimeNum;
        const x1 = xpad + stime * widthpertime;
        const x2 = xpad + adjustedEtime * widthpertime;

        const y1 = imageheight - ypad2 - (depthNum + 1) * frameheight + framepad;
        const y2 = imageheight - ypad2 - depthNum * frameheight;

        // Format samples with commas
        const samples = Math.round((adjustedEtime - stime) * factor);

        const formatWithCommas = (number: number) => {
            return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        };

        const samplesTxt = formatWithCommas(samples);

        let info: string;
        if (func === '' && parseInt(depth) === 0) {
            info = `all (${samplesTxt} ${countname}, 100%)`;
        } else {
            const pct = ((100 * samples) / (timemax * factor)).toFixed(2);
            let escapedFunc = func
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/_\[[kwij]\]$/, '');
            if (deltaVal === undefined) {
                info = `${escapedFunc} (${samplesTxt} ${countname}, ${pct}%)`;
            } else {
                const d = deltaVal;
                const deltPct = ((100 * d) / (timemax * factor)).toFixed(2);
                const signDeltPct = d > 0 ? `+${deltPct}` : deltPct;
                info = `${escapedFunc} (${samplesTxt} ${countname}, ${pct}%; ${signDeltPct}%)`;
            }
        }

        // Create name attributes
        const nameAttr: Record<string, string> = {};
        nameAttr.title = info;
        im.groupStart(nameAttr);

        // Determine color
        let color: string;
        if (func === '--') {
            color = vdgrey;
        } else if (func === '-') {
            color = dgrey;
        } else if (deltaVal !== undefined) {
            color = color_scale(deltaVal, maxdelta);
        } else if (palette) {
            const paletteMap: Record<string, string> = {};
            color = color_map(colors, func, paletteMap, hash, rand);
        } else {
            color = getColor(colors, hash, func, rand);
        }
        im.filledRectangle(x1, y1, x2, y2, color, 'rx="2" ry="2"');

        // Draw text
        const chars = Math.floor((x2 - x1) / (fontsize * fontwidth));
        let text = '';
        // room for one char plus two dots
        if (chars >= 3) {
            const truncatedFunc = func.replace(/_\[[kwij]\]$/, '');
            text = truncatedFunc.substring(0, chars);
            if (chars < truncatedFunc.length) {
                text = text.substring(0, text.length - 2) + '..';
            }
            text = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        im.stringTTF(undefined, x1 + 3, 3 + (y1 + y2) / 2, text, '');

        im.groupEnd(nameAttr);
    }
    im.groupEnd({});

    return im.getSVG();
}

interface GenerateSVGFlameGraphResult {
    stackIdentifiers: ArrayMap;
    SVGContent: string;
}

async function generateSVGFlameGraph(combinedTrace: Trace): Promise<GenerateSVGFlameGraphResult> {
    function fnlog(msg: string) {
        trace_commands.log(`generateSVGFlameGraph: ${msg}`);
    }

    fnlog('Generating Flame Graph');
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Combined trace has ${combinedTrace.traceEvents.length} trace events`);

    core.info('Stacking Traces');
    const stackIdentifiers = stackCollapseChromeTracing(combinedTrace);
    core.info('Generating SVG');
    const SVGContent = generateFlameGraph(stackIdentifiers);
    return { stackIdentifiers, SVGContent };
}

function round(value: number, precision: number): number {
    return parseFloat(value.toFixed(precision));
}

function formatTimeStr(microseconds: number): string {
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

function HTMLEscape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Generate a table for a report section
 */
function sectionTable(columnName: string, data: Record<string, CountDuration>): string {
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

function convertTemplateString(inputString: string): string {
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

function isStdSymbol(symbolStr: string): boolean {
    return symbolStr.startsWith('std::') ||
        symbolStr.startsWith('__gnu_cxx::') ||
        symbolStr.startsWith('_M_') ||
        symbolStr.startsWith('_mm_') ||
        symbolStr.startsWith('__');
}

/**
 * Filter out standard library symbols
 */
function filterProjectSymbols(symbolsMap: Record<string, CountDuration>): Record<string, CountDuration> {
    const projectSymbols: Record<string, CountDuration> = {};
    for (const [symbol, v] of Object.entries(symbolsMap)) {
        if (!isStdSymbol(symbol)) {
            projectSymbols[symbol] = v;
        }
    }
    return projectSymbols;
}

/**
 * Generate a report from the report data
 */
function generateReport(reportData: ReportData): string {
    let content = `# Time Trace Report\n\n`;
    content += `## Summary\n\n`;
    content += `| Step | %     | Total Time | Avg. | Count |\n`;
    content += `| --------- | ----- | ---------- | ------------ | ----- |\n`;
    const totalCompile = reportData.total_compile.duration;
    if (reportData.total_compile.count !== 0) {
        const datum = reportData.total_compile;
        content += `| Compile   | 100%   | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.total_frontend.count !== 0) {
        const datum = reportData.total_frontend;
        content += `| 1) Frontend   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${reportData.total_frontend.count} |\n`;
    }
    if (reportData.total_parsing.count !== 0) {
        const datum = reportData.total_parsing;
        content += `| 1A) Parsing   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.total_instantiations.count !== 0) {
        const datum = reportData.total_instantiations;
        content += `| 1B) Instantiations   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.total_backend.count !== 0) {
        const datum = reportData.total_backend;
        content += `| 2) Backend   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.total_codegen.count !== 0) {
        const datum = reportData.total_codegen;
        content += `| 2A) Code Generation   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    if (reportData.total_optimize.count !== 0) {
        const datum = reportData.total_optimize;
        content += `| 2B) Optimization   | ${round(100 * datum.duration / totalCompile, 2)}% | ${formatTimeStr(datum.duration)} | ${formatTimeStr(datum.averageDuration())} | ${datum.count} |\n`;
    }
    content += `\n\n`;

    content += `## Files\n\n`;
    content += '### Compile\n\n';
    content += sectionTable('File', reportData.file_compile);
    content += '### Parse\n\n';
    content += sectionTable('File', reportData.file_parse);

    content += '## Project Symbols\n\n';
    content += '### Parse\n\n';
    content += sectionTable('Symbol', filterProjectSymbols(reportData.symbol_parse));
    content += '### Instantiate\n\n';
    content += sectionTable('Symbol', filterProjectSymbols(reportData.symbol_instantiate));
    content += '### Instantiate Sets\n\n';
    content += sectionTable('Symbol Set', filterProjectSymbols(reportData.symbol_set_instantiate));

    content += '## All Symbols\n\n';
    content += '### Parse\n\n';
    content += sectionTable('Symbol', reportData.symbol_parse);
    content += '### Instantiate\n\n';
    content += sectionTable('Symbol', reportData.symbol_instantiate);
    content += '### Instantiate Sets\n\n';
    content += sectionTable('Symbol Set', reportData.symbol_set_instantiate);
    return content;
}

interface UploadArtifactsInputs {
    output_path: string;
    report_path: string;
    build_dir: string;
    package_retention_days?: number;
}

/**
 * Create a readme file for the time-trace artifacts
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

interface MainInputs {
    source_dir: string;
    build_dir: string;
    output_path: string;
    report_path: string;
    update_summary: boolean;
    upload_artifact: boolean;
    package_retention_days?: number;
}

interface MainOutputs {
    traces_path: string;
    svg_path: string;
}

async function main(inputs: MainInputs): Promise<MainOutputs> {
    function fnlog(msg: string) {
        trace_commands.log(`main: ${msg}`);
    }

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

let lastInputsForErrors: Record<string, unknown> | undefined = undefined;

async function run() {
    const inputs = {
        // Paths
        source_dir: gh_inputs.getResolvedPath('source-dir'),
        build_dir: gh_inputs.getResolvedPath('build-dir'),
        output_path: gh_inputs.getNormalizedPath('output-path'),
        report_path: gh_inputs.getNormalizedPath('report-path'),
        // Artifacts
        generate_svg: gh_inputs.getBoolean('generate-svg'),
        generate_report: gh_inputs.getBoolean('generate-report'),
        update_summary: gh_inputs.getBoolean('update-summary'),
        github_token: gh_inputs.getInput(['github-token', 'github_token']),
        upload_artifact: gh_inputs.getBoolean('upload-artifact'),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    lastInputsForErrors = inputs as unknown as Record<string, unknown>;

    inputs.output_path = path.resolve(inputs.build_dir, inputs.output_path);
    inputs.report_path = path.resolve(inputs.build_dir, inputs.report_path);

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs);

    // Parse Final program / Setup version / Outputs
    if (outputs && Object.keys(outputs).length) {
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    } else {
        core.setFailed('Cannot analyze time-traces');
    }
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            let hint = 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. ';
            if (lastInputsForErrors && typeof lastInputsForErrors === 'object' && 'trace_commands' in lastInputsForErrors) {
                const inputs = lastInputsForErrors as Record<string, unknown>;
                if (inputs.trace_commands) {
                    hint = 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.';
                }
            }
            const err = error instanceof Error ? error : new Error(String(error));
            await reportAndSetFailed(err, {
                title: 'Flamegraph failed',
                hint,
                locals: () => ({ inputs: lastInputsForErrors }),
                includeStackInSetFailed: true
            });
        }
    })();
}

export {
    main,
    createReadmeFile,
    combineTraces,
    generateReport,
    generateSVGFlameGraph,
    ArrayMap
};
