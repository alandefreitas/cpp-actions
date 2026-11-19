import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCommand } from './runner';

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
        const cmd = process.platform === 'win32' ? 'ping' : 'sleep';
        const args = process.platform === 'win32' ? ['-n', '10', '127.0.0.1'] : ['10'];
        const result = await runCommand(cmd, args, { timeout: 1000 });
        expect(result.success).toBe(false);
    }, 15000);

    it('should use cwd option', async () => {
        const tmpDir = os.tmpdir();
        const cmd = process.platform === 'win32' ? 'cd' : 'pwd';
        const result = await runCommand(cmd, [], { cwd: tmpDir });
        expect(result.success).toBe(true);
        expect(result.stdout.trim()).toBeTruthy();
    });
});

describe('runCommand spawn failures', () => {
    it('reports failure with the spawn error when the working directory does not exist', async () => {
        const missing = path.join(os.tmpdir(), `runner-missing-${process.pid}-${Date.now()}`);
        const result = await runCommand('node', ['--version'], { cwd: missing, timeout: 10000 });
        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/ENOENT/);
    });

    it('captures standard error output', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-stderr-'));
        try {
            const script = path.join(dir, 'warn.js');
            fs.writeFileSync(script, "process.stderr.write('oops');");
            const result = await runCommand('node', [`"${script}"`]);
            expect(result.success).toBe(true);
            expect(result.stderr).toBe('oops');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
