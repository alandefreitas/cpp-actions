import {
    round,
    formatTimeStr,
    HTMLEscape,
    convertTemplateString,
    isStdSymbol,
    CountDuration,
    ReportData,
    filterProjectSymbols,
    sectionTable
} from './report-generation';

describe('report-generation', () => {
    describe('round', () => {
        it('should round to the specified precision', () => {
            expect(round(1.2345, 2)).toBe(1.23);
            expect(round(1.2355, 2)).toBe(1.24);
            expect(round(1.5, 0)).toBe(2);
            expect(round(100, 2)).toBe(100);
        });
    });

    describe('formatTimeStr', () => {
        it('should format microseconds', () => {
            expect(formatTimeStr(500)).toBe('500 µs');
            expect(formatTimeStr(0.5)).toBe('0.5 µs');
        });

        it('should format milliseconds', () => {
            expect(formatTimeStr(1500)).toBe('1.5 ms');
            expect(formatTimeStr(500000)).toBe('500 ms');
        });

        it('should format seconds', () => {
            expect(formatTimeStr(1500000)).toBe('1.5 s');
            expect(formatTimeStr(30000000)).toBe('30 s');
        });

        it('should format minutes', () => {
            expect(formatTimeStr(90000000)).toBe('1.5 min');
        });

        it('should format hours', () => {
            expect(formatTimeStr(5400000000)).toBe('1.5 h');
        });
    });

    describe('HTMLEscape', () => {
        it('should escape &, <, and >', () => {
            expect(HTMLEscape('a & b')).toBe('a &amp; b');
            expect(HTMLEscape('<div>')).toBe('&lt;div&gt;');
            expect(HTMLEscape('no special chars')).toBe('no special chars');
        });

        it('should handle multiple special characters', () => {
            expect(HTMLEscape('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
        });
    });

    describe('convertTemplateString', () => {
        it('should replace template parameters with placeholders', () => {
            expect(convertTemplateString('std::vector<int>')).toBe('std::vector<$>');
            expect(convertTemplateString('std::map<string, int>')).toBe('std::map<$>');
        });

        it('should handle nested templates', () => {
            expect(convertTemplateString('std::vector<std::pair<int, int>>')).toBe('std::vector<$>');
        });

        it('should handle no templates', () => {
            expect(convertTemplateString('myFunction')).toBe('myFunction');
        });
    });

    describe('isStdSymbol', () => {
        it('should identify std:: symbols', () => {
            expect(isStdSymbol('std::vector')).toBe(true);
            expect(isStdSymbol('std::map::insert')).toBe(true);
        });

        it('should identify GNU extension symbols', () => {
            expect(isStdSymbol('__gnu_cxx::new_allocator')).toBe(true);
        });

        it('should identify underscore-prefixed symbols', () => {
            expect(isStdSymbol('_M_allocate')).toBe(true);
            expect(isStdSymbol('_mm_set1_ps')).toBe(true);
            expect(isStdSymbol('__builtin_memcpy')).toBe(true);
        });

        it('should not identify project symbols', () => {
            expect(isStdSymbol('myFunction')).toBe(false);
            expect(isStdSymbol('MyClass::method')).toBe(false);
        });
    });

    describe('CountDuration', () => {
        it('should initialize with defaults', () => {
            const cd = new CountDuration();
            expect(cd.count).toBe(0);
            expect(cd.duration).toBe(0);
        });

        it('should update count and duration', () => {
            const cd = new CountDuration(1, 100);
            cd.update(2, 200);
            expect(cd.count).toBe(3);
            expect(cd.duration).toBe(300);
        });

        it('should calculate average duration', () => {
            const cd = new CountDuration(4, 100);
            expect(cd.averageDuration()).toBe(25);
        });
    });

    describe('ReportData', () => {
        it('should add file compile data', () => {
            const rd = new ReportData();
            rd.addFileCompileData('test.cpp', 1, 1000);
            rd.addFileCompileData('test.cpp', 1, 500);
            expect(rd.fileCompile['test.cpp'].count).toBe(2);
            expect(rd.fileCompile['test.cpp'].duration).toBe(1500);
        });

        it('should add file parse data', () => {
            const rd = new ReportData();
            rd.addFileParseData('header.h', 1, 200);
            expect(rd.fileParse['header.h'].count).toBe(1);
            expect(rd.fileParse['header.h'].duration).toBe(200);
        });

        it('should add symbol instantiation data with set tracking', () => {
            const rd = new ReportData();
            rd.addSymbolInstantiateData('std::vector<int>', 1, 100);
            expect(rd.symbolInstantiate['std::vector<int>'].duration).toBe(100);
            expect(rd.symbolSetInstantiate['std::vector<$>'].duration).toBe(100);
        });
    });

    describe('filterProjectSymbols', () => {
        it('should remove std library symbols', () => {
            const symbols: Record<string, CountDuration> = {
                'std::vector': new CountDuration(1, 100),
                'myFunc': new CountDuration(1, 200),
                '__builtin_memcpy': new CountDuration(1, 50)
            };
            const result = filterProjectSymbols(symbols);
            expect(Object.keys(result)).toEqual(['myFunc']);
            expect(result['myFunc'].duration).toBe(200);
        });
    });

    describe('sectionTable', () => {
        it('should generate a markdown table', () => {
            const data: Record<string, CountDuration> = {
                'file1.cpp': new CountDuration(2, 2000000),
                'file2.cpp': new CountDuration(1, 1000000)
            };
            const result = sectionTable('File', data);
            expect(result).toContain('| File |');
            expect(result).toContain('file1.cpp');
            expect(result).toContain('file2.cpp');
            expect(result).toContain('Total Time:');
        });
    });
});
