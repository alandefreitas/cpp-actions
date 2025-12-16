/**
 * Command execution utilities with parallel execution support.
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
    /** Whether to inherit stdio (show output in real-time) */
    inheritStdio?: boolean;
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
            stdio: options.inheritStdio ? 'inherit' : 'pipe',
            shell: true
        };

        const child = spawn(command, args, spawnOptions);

        let stdout = '';
        let stderr = '';

        if (!options.inheritStdio) {
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
        }

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

/**
 * Result of a task execution.
 */
export interface TaskResult<T = void> {
    /** Name/identifier of the task */
    name: string;
    /** Whether the task succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Task-specific result data */
    data?: T;
}

/**
 * Runs multiple tasks in parallel and collects results.
 * @param tasks - Array of task functions to execute
 * @returns Promise resolving to array of task results
 */
export async function runParallel<T>(
    tasks: Array<{ name: string; fn: () => Promise<T> }>
): Promise<TaskResult<T>[]> {
    const results = await Promise.allSettled(
        tasks.map(async (task) => {
            try {
                const data = await task.fn();
                return { name: task.name, success: true, data } as TaskResult<T>;
            } catch (err) {
                return {
                    name: task.name,
                    success: false,
                    error: err instanceof Error ? err.message : String(err)
                } as TaskResult<T>;
            }
        })
    );

    return results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        }
        return {
            name: tasks[index].name,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        };
    });
}

/**
 * Prints a formatted summary of task results.
 * @param title - Summary section title
 * @param results - Array of task results
 */
export function printSummary(title: string, results: TaskResult[]): void {
    console.log(`\n==== ${title} ====`);
    for (const result of results) {
        const icon = result.success ? '\u2705' : '\u274C';
        const status = result.success ? 'succeeded' : 'failed';
        console.log(`${icon} ${result.name}: ${status}`);
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
    }
}
