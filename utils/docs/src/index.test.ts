describe('index.ts main entry point', () => {
    let mockExit: jest.SpyInstance;
    let mockConsoleLog: jest.SpyInstance;
    let mockConsoleError: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should exit with code 1 when generateDocs returns false', async () => {
        jest.doMock('update-data', () => ({
            runCommand: jest.fn()
        }));
        jest.doMock('./docs', () => ({
            generateDocs: jest.fn().mockResolvedValue(false)
        }));

        await jest.isolateModulesAsync(async () => {
            await import('./index');
        });
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockConsoleError).toHaveBeenCalledWith('Documentation generation failed');
        expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should log success when generateDocs returns true', async () => {
        jest.doMock('update-data', () => ({
            runCommand: jest.fn()
        }));
        jest.doMock('./docs', () => ({
            generateDocs: jest.fn().mockResolvedValue(true)
        }));

        await jest.isolateModulesAsync(async () => {
            await import('./index');
        });
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Documentation generated successfully'));
        expect(mockExit).not.toHaveBeenCalled();
    });

    it('should exit with code 1 when generateDocs throws', async () => {
        jest.doMock('update-data', () => ({
            runCommand: jest.fn()
        }));
        jest.doMock('./docs', () => ({
            generateDocs: jest.fn().mockRejectedValue(new Error('unexpected error'))
        }));

        await jest.isolateModulesAsync(async () => {
            await import('./index');
        });
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockConsoleError).toHaveBeenCalledWith('docs failed:', expect.any(Error));
        expect(mockExit).toHaveBeenCalledWith(1);
    });
});
