import { parseArgs, printHelp } from './cli';

describe('build CLI', () => {
    describe('parseArgs', () => {
        it('should return all=true by default', () => {
            const args = parseArgs([]);
            expect(args.all).toBe(true);
            expect(args.fetchTags).toBe(false);
            expect(args.prepare).toBe(false);
            expect(args.test).toBe(false);
            expect(args.lint).toBe(false);
            expect(args.docs).toBe(false);
        });

        it('should parse --workspace option', () => {
            const args = parseArgs(['--workspace', 'create-changelog']);
            expect(args.workspace).toBe('create-changelog');
        });

        it('should parse -w shorthand', () => {
            const args = parseArgs(['-w', 'boost-clone']);
            expect(args.workspace).toBe('boost-clone');
        });

        it('should set all=false when specific step is requested', () => {
            const args = parseArgs(['--prepare']);
            expect(args.all).toBe(false);
            expect(args.prepare).toBe(true);
        });

        it('should parse multiple step flags', () => {
            const args = parseArgs(['--prepare', '--test', '--lint']);
            expect(args.all).toBe(false);
            expect(args.prepare).toBe(true);
            expect(args.test).toBe(true);
            expect(args.lint).toBe(true);
            expect(args.docs).toBe(false);
        });

        it('should parse --fetch-tags', () => {
            const args = parseArgs(['--fetch-tags']);
            expect(args.fetchTags).toBe(true);
            expect(args.all).toBe(false);
        });

        it('should parse --docs', () => {
            const args = parseArgs(['--docs']);
            expect(args.docs).toBe(true);
            expect(args.all).toBe(false);
        });

        it('should parse --help', () => {
            const args = parseArgs(['--help']);
            expect(args.help).toBe(true);
        });

        it('should parse -h shorthand', () => {
            const args = parseArgs(['-h']);
            expect(args.help).toBe(true);
        });
    });

    describe('printHelp', () => {
        it('should print help without error', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            printHelp();
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });
});
