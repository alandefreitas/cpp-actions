import { runCommand, runParallel, printSummary, TaskResult } from './runner';

describe('runner utilities', () => {
    describe('runCommand', () => {
        it('should run a simple command successfully', async () => {
            const result = await runCommand('echo', ['hello']);
            expect(result.success).toBe(true);
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBe('hello');
        });

        it('should capture exit code on failure', async () => {
            const result = await runCommand('node', ['-e', 'process.exit(1)']);
            expect(result.success).toBe(false);
            expect(result.exitCode).toBeGreaterThan(0);
        });

        it('should respect timeout', async () => {
            const result = await runCommand('sleep', ['10'], { timeout: 100 });
            expect(result.success).toBe(false);
        }, 5000);

        it('should use cwd option', async () => {
            const result = await runCommand('pwd', [], { cwd: '/tmp' });
            expect(result.success).toBe(true);
            expect(result.stdout.trim()).toContain('tmp');
        });
    });

    describe('runParallel', () => {
        it('should run tasks in parallel', async () => {
            const tasks = [
                { name: 'task1', fn: async () => 'result1' },
                { name: 'task2', fn: async () => 'result2' }
            ];

            const results = await runParallel(tasks);

            expect(results).toHaveLength(2);
            expect(results[0].success).toBe(true);
            expect(results[0].data).toBe('result1');
            expect(results[1].success).toBe(true);
            expect(results[1].data).toBe('result2');
        });

        it('should handle task failures', async () => {
            const tasks = [
                { name: 'success', fn: async () => 'ok' },
                { name: 'failure', fn: async () => { throw new Error('failed'); } }
            ];

            const results = await runParallel(tasks);

            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(false);
            expect(results[1].error).toBe('failed');
        });
    });

    describe('printSummary', () => {
        it('should print summary without error', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            const results: TaskResult[] = [
                { name: 'task1', success: true },
                { name: 'task2', success: false, error: 'Something went wrong' }
            ];

            printSummary('Test Summary', results);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });
});
