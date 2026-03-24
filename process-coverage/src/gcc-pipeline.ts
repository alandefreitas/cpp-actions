/**
 * GCC coverage capture pipeline.
 *
 * Uses lcov to capture coverage data from build directories containing
 * gcda/gcno files and produces a merged LCOV .info file.
 *
 * @module gcc-pipeline
 */

import * as path from 'node:path';
import * as exec from '@actions/exec';
import * as traceCommands from 'trace-commands';

const fnlog = traceCommands.scoped('gcc-pipeline');

/** Options for capturing GCC coverage data. */
export interface GccCaptureOptions {
    /** Absolute path to the lcov binary. */
    lcovPath: string;
    /** Absolute path to the gcov binary. */
    gcovPath: string;
    /** List of build directories containing .gcda/.gcno files. */
    buildDirs: string[];
    /** Directory to write output .info files to. */
    outputDir: string;
}

/**
 * Captures GCC coverage data from build directories using lcov.
 *
 * Runs `lcov --capture` for each build directory, then merges the results
 * if multiple directories are provided. The final merged .info file is
 * written to the output directory.
 *
 * @param options - Configuration for the capture operation
 * @returns Absolute path to the output .info file
 * @throws If lcov capture or merge fails
 */
export async function captureGccCoverage(options: GccCaptureOptions): Promise<string> {
    const { lcovPath, gcovPath, buildDirs, outputDir } = options;

    if (buildDirs.length === 0) {
        throw new Error('No build directories specified for GCC coverage capture.');
    }

    const infoFiles: string[] = [];

    for (let i = 0; i < buildDirs.length; i++) {
        const dir = buildDirs[i];
        const outputFile = path.join(outputDir, `coverage-${i}.info`);

        fnlog(`Capturing coverage from ${dir}`);
        await exec.getExecOutput(lcovPath, [
            '--capture',
            '--gcov-tool', gcovPath,
            '--directory', dir,
            '--output-file', outputFile,
            '--rc', 'branch_coverage=0',
            '--rc', 'geninfo_unexecuted_blocks=1'
        ], {silent: true});

        infoFiles.push(outputFile);
    }

    if (infoFiles.length === 1) {
        return infoFiles[0];
    }

    // Merge multiple .info files
    fnlog('Merging coverage from multiple build directories');
    const mergedFile = path.join(outputDir, 'merged.info');

    const args: string[] = [];
    for (const file of infoFiles) {
        args.push('--add-tracefile', file);
    }
    args.push('-o', mergedFile);

    await exec.getExecOutput(lcovPath, args, {silent: true});

    return mergedFile;
}
