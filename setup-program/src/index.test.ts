describe('pretty errors', () => {
    it.skip('logs once and fails once', async () => {
        await new Promise<void>((resolve) => {
            jest.isolateModules(() => {
                jest.doMock('@actions/core', () => ({
                    error: jest.fn(),
                    setFailed: jest.fn()
                }));
                const core = require('@actions/core');
                const { reportAndSetFailed } = require('pretty-errors');

                reportAndSetFailed(new Error('program boom'), { title: 'Setup program failed' }).then(() => {
                    expect(core.error).toHaveBeenCalledTimes(1);
                    const failedArg = core.setFailed.mock.calls[0][0];
                    expect(failedArg).toContain('program boom');
                    resolve();
                });
            });
        });
    });
});
