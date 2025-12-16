import { parseArgs, printHelp } from './cli';

describe('release CLI', () => {
    describe('parseArgs', () => {
        it('should return default values', () => {
            const args = parseArgs([]);
            expect(args.version).toBeUndefined();
            expect(args.dryRun).toBe(false);
            expect(args.yes).toBe(false);
            expect(args.help).toBe(false);
        });

        it('should parse --version option', () => {
            const args = parseArgs(['--version', '1.2.3']);
            expect(args.version).toBe('1.2.3');
        });

        it('should parse -v shorthand', () => {
            const args = parseArgs(['-v', '2.0.0']);
            expect(args.version).toBe('2.0.0');
        });

        it('should parse positional version argument', () => {
            const args = parseArgs(['1.2.3']);
            expect(args.version).toBe('1.2.3');
        });

        it('should parse --dry-run', () => {
            const args = parseArgs(['--dry-run']);
            expect(args.dryRun).toBe(true);
        });

        it('should parse -n shorthand', () => {
            const args = parseArgs(['-n']);
            expect(args.dryRun).toBe(true);
        });

        it('should parse --yes', () => {
            const args = parseArgs(['--yes']);
            expect(args.yes).toBe(true);
        });

        it('should parse -y shorthand', () => {
            const args = parseArgs(['-y']);
            expect(args.yes).toBe(true);
        });

        it('should parse --help', () => {
            const args = parseArgs(['--help']);
            expect(args.help).toBe(true);
        });

        it('should parse -h shorthand', () => {
            const args = parseArgs(['-h']);
            expect(args.help).toBe(true);
        });

        it('should parse combined options', () => {
            const args = parseArgs(['--dry-run', '--yes', '1.0.0']);
            expect(args.dryRun).toBe(true);
            expect(args.yes).toBe(true);
            expect(args.version).toBe('1.0.0');
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
