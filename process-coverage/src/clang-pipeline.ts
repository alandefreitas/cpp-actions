/**
 * Clang coverage processing pipeline.
 *
 * Discovers and merges .profraw files, then exports coverage data
 * to LCOV format using llvm-profdata and llvm-cov.
 *
 * @module clang-pipeline
 */

import * as path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as traceCommands from 'trace-commands';

const fnlog = traceCommands.scoped('clang-pipeline');

/** Options for exporting Clang coverage data to LCOV format. */
export interface ExportClangCoverageOptions {
    /** Absolute path to the llvm-cov binary. */
    llvmCovPath: string;
    /** Absolute path to the merged .profdata file. */
    profdataPath: string;
    /** List of instrumented binary paths (supports glob patterns like `'build/bin/test_*'`). */
    binaries: string[];
    /** Directory to write the output .info file to. */
    outputDir: string;
}

/** Options for merging .profraw files into a .profdata file. */
export interface MergeProfrawOptions {
    /** Absolute path to the llvm-profdata binary. */
    llvmProfdataPath: string;
    /** List of build directories to search for .profraw files. */
    buildDirs: string[];
    /** Glob pattern to match .profraw files (e.g. `'default-*.profraw'`). */
    profrawPattern: string;
    /** Directory to write the output .profdata file to. */
    outputDir: string;
}

/**
 * Discovers and merges .profraw files from build directories into a single .profdata file.
 *
 * Globs for profraw files matching the given pattern in each build directory,
 * then runs `llvm-profdata merge -sparse` to combine them into a single
 * indexed profile data file.
 *
 * @param options - Configuration for the merge operation
 * @returns Absolute path to the merged .profdata file
 * @throws If no .profraw files are found or if llvm-profdata merge fails
 */
export async function mergeProfrawFiles(options: MergeProfrawOptions): Promise<string> {
    const { llvmProfdataPath, buildDirs, profrawPattern, outputDir } = options;

    // Discover .profraw files across all build directories
    const patterns = buildDirs.map(dir => path.join(dir, '**', profrawPattern));
    const globber = await glob.create(patterns.join('\n'));
    const profrawFiles = await globber.glob();

    if (profrawFiles.length === 0) {
        throw new Error(
            `No .profraw files found matching pattern '${profrawPattern}' ` +
            `in build directories: ${buildDirs.join(', ')}. ` +
            `Ensure your tests were compiled with -fprofile-instr-generate -fcoverage-mapping ` +
            `and that LLVM_PROFILE_FILE is set correctly (e.g. LLVM_PROFILE_FILE=default-%p-%m.profraw).`
        );
    }

    fnlog(`Found ${profrawFiles.length} profraw file(s)`);
    for (const file of profrawFiles) {
        core.debug(`  ${file}`);
    }

    // Merge into a single .profdata file
    const outputFile = path.join(outputDir, 'merged.profdata');

    await exec.getExecOutput(llvmProfdataPath, [
        'merge',
        '-sparse',
        ...profrawFiles,
        '-o', outputFile
    ], {silent: true});

    fnlog(`Merged profdata written to ${outputFile}`);
    return outputFile;
}

/**
 * Exports Clang coverage data from a .profdata file to LCOV format.
 *
 * Runs `llvm-cov export -format=lcov` for each instrumented binary,
 * then concatenates the LCOV outputs into a single .info file.
 * Binary paths support glob patterns for matching multiple executables.
 *
 * @param options - Configuration for the export operation
 * @returns Absolute path to the output .info file
 * @throws If no binaries are specified or if llvm-cov export fails
 */
export async function exportClangCoverage(options: ExportClangCoverageOptions): Promise<string> {
    const { llvmCovPath, profdataPath, binaries, outputDir } = options;

    if (binaries.length === 0) {
        throw new Error(
            'No binaries resolved for Clang coverage export. ' +
            'Provide the "binaries" input with path(s) to your instrumented ' +
            'test executable(s), or ensure executable files exist in the build directories.'
        );
    }

    // Expand glob patterns in binary paths
    const globber = await glob.create(binaries.join('\n'));
    const resolvedBinaries = await globber.glob();

    if (resolvedBinaries.length === 0) {
        throw new Error(
            `No binaries found matching patterns: ${binaries.join(', ')}. ` +
            'Check that the binary paths or glob patterns are correct.'
        );
    }

    fnlog(`Exporting coverage for ${resolvedBinaries.length} binary(ies)`);

    const lcovSections: string[] = [];

    for (const binary of resolvedBinaries) {
        fnlog(`Processing binary: ${binary}`);
        try {
            const result = await exec.getExecOutput(llvmCovPath, [
                'export',
                '-format=lcov',
                `-instr-profile=${profdataPath}`,
                binary
            ], { silent: true, ignoreReturnCode: true });
            if (result.exitCode === 0 && result.stdout.trim().length > 0) {
                lcovSections.push(result.stdout);
            } else {
                fnlog(`Skipping ${binary} — no coverage data`);
            }
        } catch {
            fnlog(`Skipping ${binary} — llvm-cov export failed`);
        }
    }

    if (lcovSections.length === 0) {
        throw new Error(
            `No coverage data exported from any binary. ` +
            `Checked ${resolvedBinaries.length} binary(ies). ` +
            'Ensure binaries were built with -fprofile-instr-generate -fcoverage-mapping ' +
            'and that the profdata file matches.'
        );
    }

    // Concatenate LCOV outputs (LCOV is a text format with end_of_record delimiters)
    const outputFile = path.join(outputDir, 'clang-coverage.info');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outputFile, lcovSections.join(''), 'utf-8');

    core.info(`LCOV coverage written to ${outputFile} (from ${lcovSections.length} binary(ies))`);
    return outputFile;
}
