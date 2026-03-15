import * as fs from 'fs';

jest.mock('fs');
jest.mock('update-data', () => ({
    runCommand: jest.fn()
}));

import { generateDocs } from './docs';
import { runCommand } from 'update-data';

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockRunCommand = runCommand as jest.Mock;

function makeResult(overrides: Partial<{ exitCode: number; stdout: string; stderr: string; success: boolean }> = {}) {
    return { exitCode: 0, stdout: '', stderr: '', success: true, ...overrides };
}

describe('generateDocs', () => {
    const rootDir = '/fake/root';

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return true when all steps succeed', async () => {
        // All files exist
        mockExistsSync.mockReturnValue(true);
        // ensurePythonDeps: check passes
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // generatePagesFromYaml: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // buildAntoraSite: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());

        const result = await generateDocs(rootDir);
        expect(result).toBe(true);
    });

    it('should skip python deps if requirements.txt does not exist', async () => {
        // requirements.txt missing, but parse_actions.py and playbook exist
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('requirements.txt')) return false;
            return true;
        });
        // generatePagesFromYaml: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // buildAntoraSite: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());

        const result = await generateDocs(rootDir);
        expect(result).toBe(true);
        // runCommand not called for python deps check
        expect(mockRunCommand).toHaveBeenCalledTimes(2);
    });

    it('should install python deps when check fails', async () => {
        mockExistsSync.mockReturnValue(true);
        // ensurePythonDeps: check fails
        mockRunCommand.mockResolvedValueOnce(makeResult({ success: false, exitCode: 1 }));
        // ensurePythonDeps: install succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // generatePagesFromYaml: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // buildAntoraSite: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());

        const result = await generateDocs(rootDir);
        expect(result).toBe(true);
        expect(mockRunCommand).toHaveBeenCalledTimes(4);
        // Second call should be pip install
        expect(mockRunCommand.mock.calls[1][0]).toBe('python3');
        expect(mockRunCommand.mock.calls[1][1]).toContain('-m');
    });

    it('should return false when python dep install fails', async () => {
        mockExistsSync.mockReturnValue(true);
        // check fails
        mockRunCommand.mockResolvedValueOnce(makeResult({ success: false, exitCode: 1 }));
        // install fails
        mockRunCommand.mockResolvedValueOnce(makeResult({ success: false, exitCode: 1, stderr: 'install error' }));

        const result = await generateDocs(rootDir);
        expect(result).toBe(false);
    });

    it('should skip YAML parsing if parse_actions.py does not exist', async () => {
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('parse_actions.py')) return false;
            return true;
        });
        // ensurePythonDeps: check passes
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // buildAntoraSite: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());

        const result = await generateDocs(rootDir);
        expect(result).toBe(true);
        expect(mockRunCommand).toHaveBeenCalledTimes(2);
    });

    it('should return false when YAML parsing fails', async () => {
        mockExistsSync.mockReturnValue(true);
        // ensurePythonDeps: check passes
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // generatePagesFromYaml: fails
        mockRunCommand.mockResolvedValueOnce(makeResult({ success: false, exitCode: 1, stderr: 'parse error' }));

        const result = await generateDocs(rootDir);
        expect(result).toBe(false);
    });

    it('should skip Antora build if playbook does not exist', async () => {
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            const s = String(p);
            if (s.includes('local-antora-playbook.yml')) return false;
            return true;
        });
        // ensurePythonDeps: check passes
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // generatePagesFromYaml: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());

        const result = await generateDocs(rootDir);
        expect(result).toBe(true);
    });

    it('should return false when Antora build fails', async () => {
        mockExistsSync.mockReturnValue(true);
        // ensurePythonDeps: check passes
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // generatePagesFromYaml: succeeds
        mockRunCommand.mockResolvedValueOnce(makeResult());
        // buildAntoraSite: fails
        mockRunCommand.mockResolvedValueOnce(makeResult({ success: false, exitCode: 1, stderr: 'antora error' }));

        const result = await generateDocs(rootDir);
        expect(result).toBe(false);
    });

    it('should pass correct arguments to generatePagesFromYaml', async () => {
        mockExistsSync.mockReturnValue(true);
        mockRunCommand.mockResolvedValueOnce(makeResult());
        mockRunCommand.mockResolvedValueOnce(makeResult());
        mockRunCommand.mockResolvedValueOnce(makeResult());

        await generateDocs(rootDir);

        // Second call is generatePagesFromYaml
        const parseCall = mockRunCommand.mock.calls[1];
        expect(parseCall[0]).toBe('python3');
        expect(parseCall[1][0]).toContain('parse_actions.py');
        expect(parseCall[2]?.cwd).toBe(rootDir);
        expect(parseCall[2]?.timeout).toBe(120000);
    });

    it('should pass correct arguments to buildAntoraSite', async () => {
        mockExistsSync.mockReturnValue(true);
        mockRunCommand.mockResolvedValueOnce(makeResult());
        mockRunCommand.mockResolvedValueOnce(makeResult());
        mockRunCommand.mockResolvedValueOnce(makeResult());

        await generateDocs(rootDir);

        // Third call is buildAntoraSite
        const antoraCall = mockRunCommand.mock.calls[2];
        expect(antoraCall[0]).toBe('npx');
        expect(antoraCall[1]).toContain('antora');
        expect(antoraCall[1]).toContain('--fetch');
        expect(antoraCall[1]).toContain('local-antora-playbook.yml');
        expect(antoraCall[2]?.timeout).toBe(300000);
    });

    it('should pass PYTHONPATH with existing env value', async () => {
        const origPythonPath = process.env.PYTHONPATH;
        process.env.PYTHONPATH = '/existing/path';
        try {
            mockExistsSync.mockReturnValue(true);
            // ensurePythonDeps: check passes
            mockRunCommand.mockResolvedValueOnce(makeResult());
            // generatePagesFromYaml: succeeds
            mockRunCommand.mockResolvedValueOnce(makeResult());
            // buildAntoraSite: succeeds
            mockRunCommand.mockResolvedValueOnce(makeResult());

            await generateDocs(rootDir);

            // Check that PYTHONPATH includes the existing value
            const firstCallEnv = mockRunCommand.mock.calls[0][2]?.env;
            expect(firstCallEnv?.PYTHONPATH).toContain('/existing/path');
        } finally {
            if (origPythonPath === undefined) {
                delete process.env.PYTHONPATH;
            } else {
                process.env.PYTHONPATH = origPythonPath;
            }
        }
    });
});
