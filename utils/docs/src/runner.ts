/**
 * Command execution utilities.
 */

import { spawn, SpawnOptions } from 'child_process';

/**
 * Result of a command execution.
 */
export interface CommandResult {
    /** Exit code of the command */
    exitCode: number;
    /** Standard output */
    stdout: string;
    /** Standard error */
    stderr: string;
    /** Whether the command succeeded (exit code 0) */
    success: boolean;
}

/**
 * Options for running a command.
 */
export interface RunOptions {
    /** Working directory for the command */
    cwd?: string;
    /** Environment variables */
    env?: NodeJS.ProcessEnv;
    /** Timeout in milliseconds */
    timeout?: number;
}

/**
 * Runs a command and returns the result.
 * @param command - The command to run
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Promise resolving to the command result
 */
export function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
    return new Promise((resolve) => {
        const spawnOptions: SpawnOptions = {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: 'pipe',
            shell: true
        };

        const child = spawn(command, args, spawnOptions);

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        let timeoutId: NodeJS.Timeout | undefined;
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                child.kill('SIGTERM');
            }, options.timeout);
        }

        child.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);
            const exitCode = code ?? 1;
            resolve({
                exitCode,
                stdout,
                stderr,
                success: exitCode === 0
            });
        });

        child.on('error', (err) => {
            if (timeoutId) clearTimeout(timeoutId);
            resolve({
                exitCode: 1,
                stdout,
                stderr: err.message,
                success: false
            });
        });
    });
}
