describe('sourcemap-register', () => {
    afterEach(() => {
        jest.resetModules();
    });

    it('installs source-map-support when loaded', () => {
        const installed = jest.fn();
        jest.isolateModules(() => {
            jest.doMock('source-map-support/register', () => {
                installed();
                return {};
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('./sourcemap-register');
        });
        expect(installed).toHaveBeenCalledTimes(1);
    });

    it('resolves the real source-map-support/register module', () => {
        expect(() => require.resolve('source-map-support/register')).not.toThrow();
    });
});
