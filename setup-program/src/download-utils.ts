/**
 * Download and extraction utilities for setup-program action.
 *
 * @module download-utils
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as tc from '@actions/tool-cache';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as trace_commands from 'trace-commands';

import { ExecOutput } from './types';

/**
 * Extracts a tar archive to a destination directory.
 *
 * On Windows, uses 7z for extraction. On other platforms, uses the native
 * tar command via tc.extractTar.
 *
 * @param tarPath - Path to the tar archive file
 * @param destPath - Destination directory for extraction
 * @param flags - Optional tar flags (e.g., "-xz" for gzip)
 * @returns Path to the extracted contents
 * @throws Error if extraction fails
 */
export async function extractTar(tarPath: string, destPath: string | undefined, flags: string | undefined = undefined): Promise<string> {
    const fnlog = trace_commands.scoped('extractTar');

    const IS_WINDOWS = process.platform === 'win32';
    if (!IS_WINDOWS) {
        return await tc.extractTar(tarPath, destPath, flags);
    } else {
        // Define the destPath
        flags = flags || '';
        const tarFilename = path.basename(tarPath);
        const tarBasename = path.basename(tarFilename, path.extname(tarFilename));
        if (destPath === undefined) {
            destPath = path.join(os.tmpdir(), tarBasename);
            await io.mkdirP(destPath);
        }
        // Define the intermediary paths
        const isTwoStep = !tarPath.endsWith('.tar');
        const firstDestPath = path.join(os.tmpdir(), tarBasename + '_1st');
        await io.mkdirP(firstDestPath);
        const secondDestPath = path.join(os.tmpdir(), tarBasename + '_2nd');
        if (isTwoStep) {
            await io.mkdirP(secondDestPath);
        }
        const finalDestPath = destPath;
        await io.mkdirP(finalDestPath);

        fnlog(`First destination path: ${firstDestPath}`);
        fnlog(`Second destination path: ${secondDestPath}`);
        fnlog(`Final destination path: ${finalDestPath}`);

        // First step
        const path7z = await io.which('7z', true);
        const args = ['x', tarPath, `-o${firstDestPath}`].concat(flags.includes('v') ? ['-bb1'] : []);
        const { exitCode, stderr }: ExecOutput = await exec.getExecOutput(path7z, args);
        if (exitCode !== 0) {
            throw new Error(`Failed to extract ${tarPath} to ${firstDestPath} with 7z: ${stderr}`);
        }

        async function copyFilesAndRemoveDir(sourcePath: string, destPath: string): Promise<string> {
            fnlog(`Moving ${sourcePath} to ${destPath}`);
            const files = fs.readdirSync(sourcePath);
            for (const file of files) {
                const sourceFilePath = path.join(sourcePath, file);
                const destFilePath = path.join(destPath, file);
                fnlog(`Copying ${sourceFilePath} to ${destFilePath}`);
                await io.cp(sourceFilePath, destFilePath, { recursive: true });
            }
            fnlog(`Removing ${sourcePath}`);
            await io.rmRF(sourcePath);
            return destPath;
        }

        if (!isTwoStep) {
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath);
        }

        // Find tar file for the second step
        // The tar archive is compressed so 7z produces a .tar file and leaves
        // it in the destination directory. So now we extract the tar
        // file with 7z.
        const files = fs.readdirSync(firstDestPath);
        if (files.length > 1) {
            // It extracted more than one file, so we assume it's the deflated
            // tar file
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath);
        }
        const tarFiles = files.filter(file => file.endsWith('.tar'));
        if (tarFiles.length === 0) {
            // No tar file, so we assume it's the deflated tar file
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath);
        }

        // Second step
        const tarFile = path.join(firstDestPath, tarFiles[0]);
        fnlog(`Extracting ${tarFile} to ${secondDestPath} with 7z`);
        const args2 = ['x', tarFile, `-o${secondDestPath}`].concat(flags.includes('v') ? ['-bb1'] : []);
        const { exitCode: exitCode2, stderr: stderr2 }: ExecOutput = await exec.getExecOutput(path7z, args2);
        if (exitCode2 !== 0) {
            throw new Error(`Failed to extract ${tarFile} to ${secondDestPath} with 7z: ${stderr2}`);
        }
        if (secondDestPath !== finalDestPath) {
            await copyFilesAndRemoveDir(secondDestPath, finalDestPath);
        }
        if (firstDestPath !== finalDestPath) {
            fnlog(`Removing ${firstDestPath}`);
            await io.rmRF(firstDestPath);
        }
        return finalDestPath;
    }
}

/**
 * Downloads and extracts an archive from a URL.
 *
 * Supports .zip, .tar, .tar.gz, .tar.xz, .tar.bz2, .7z, and .pkg (macOS) formats.
 * Uses 7z for extraction on Windows.
 *
 * @param url - URL of the archive to download
 * @param destPath - Optional destination directory for extraction
 * @returns Path to the extracted contents, or undefined if extraction failed
 */
export async function downloadAndExtract(url: string, destPath: string | undefined = undefined): Promise<string | undefined> {
    const fnlog = trace_commands.scoped('downloadAndExtract');

    let extPath: string | undefined = undefined;
    try {
        let toolPath = await tc.downloadTool(url);
        fnlog(`Downloaded ${url} to ${toolPath}`);
        // Resolve the destination path if not undefined
        if (destPath !== undefined) {
            // Resolve the destination path if relative
            if (!path.isAbsolute(destPath)) {
                destPath = path.resolve(destPath);
                fnlog(`Destination path is relative. Resolved to ${destPath}`);
            }
            // Create destination directory
            if (!fs.existsSync(destPath)) {
                fnlog(`Creating directory ${destPath}`);
                await io.mkdirP(destPath);
            }
        }
        // Rename the toolPath filename to match the URL filename
        const urlFilename = path.basename(url);
        const isValidFilenameChars = /^[a-z0-9._-]+$/i.test(urlFilename);
        if (isValidFilenameChars) {
            // Rename only if the filename is valid
            // Renaming makes the archive file name consistent with the URL
            // and easier for tools to recognize the archive type
            const newToolPath = path.join(path.dirname(toolPath), urlFilename);
            await io.mv(toolPath, newToolPath);
            fnlog(`Renamed ${toolPath} to ${newToolPath}`);
            toolPath = newToolPath;
        }
        // Patches for Windows
        if (process.platform === 'win32' && destPath !== undefined) {
            // https://github.com/actions/toolkit/pull/180
            destPath = destPath.replace(/\\/g, '/');
            toolPath = toolPath.replace(/\\/g, '/');
        }
        // Extract
        if (url.endsWith('.zip')) {
            extPath = await tc.extractZip(toolPath, destPath);
        } else if (url.endsWith('.tar')) {
            const flags = trace_commands.enabled() ? '-vx' : '-x';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.tar.gz')) {
            const flags = trace_commands.enabled() ? '-vxz' : '-xz';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.tar.xz')) {
            const flags = trace_commands.enabled() ? '-vxJ' : '-xJ';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.tar.bz2')) {
            const flags = trace_commands.enabled() ? '-vxj' : '-xj';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.7z')) {
            extPath = await tc.extract7z(toolPath, destPath);
        } else if (process.platform === 'darwin' && url.endsWith('.pkg')) {
            extPath = await tc.extractXar(toolPath, destPath);
        } else {
            fnlog(`Unsupported archive format: ${path.basename(url)}`);
            return extPath;
        }
        fnlog(`Extracted ${toolPath} to ${extPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(errorMessage);
        extPath = undefined;
    }
    return extPath;
}

/**
 * Strips a single nested directory from an extracted archive path.
 *
 * When archives contain a single top-level directory (common pattern),
 * moves its contents up one level to simplify the path structure.
 *
 * @param dirPath - Directory path to check and potentially flatten
 * @returns True if a directory was stripped, false otherwise
 */
export async function stripSingleDirectoryFromPath(dirPath: string): Promise<boolean> {
    const fnlog = trace_commands.scoped('stripSingleDirectoryFromPath');

    fnlog(`Checking if ${dirPath} contains a single directory`);
    const files = fs.readdirSync(dirPath);
    if (files.length === 1) {
        const subPath = path.join(dirPath, files[0]);
        fnlog(`Single file found in ${dirPath}: ${subPath}`);
        const fileStat = fs.statSync(subPath);
        if (fileStat.isDirectory()) {
            // List all files in subpath
            const subFiles = fs.readdirSync(subPath);
            fnlog(`Strip files from ${subPath}: [${subFiles.join(', ')}]`);

            // Move everything to the parent directory
            for (const file of subFiles) {
                const sourcePath = path.join(subPath, file);
                const destPath = path.join(dirPath, file);
                await io.mv(sourcePath, destPath);
            }
            return true;
        } else {
            fnlog(`Single file is not a directory: ${subPath}`);
        }
    }
    return false;
}
