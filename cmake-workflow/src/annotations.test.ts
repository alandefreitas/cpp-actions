import * as path from 'path';
import * as core from '@actions/core';

import {
    createCMakeConfigureAnnotations,
    createCMakeBuildAnnotations,
    createAnnotationsFromMessage,
    createCMakeTestAnnotations,
    type Message
} from './annotations';
import { type ResolvedInputs } from './types';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    getInput: jest.fn(),
    getBooleanInput: jest.fn(),
    getMultilineInput: jest.fn(),
    setOutput: jest.fn()
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

const mockedCore = core as jest.Mocked<typeof core>;

/**
 * Creates a minimal ResolvedInputs for annotation tests.
 *
 * @param overrides - Partial overrides for default inputs
 * @returns ResolvedInputs with sensible defaults
 */
function makeInputs(overrides: Partial<ResolvedInputs> = {}): ResolvedInputs {
    return {
        cmakePath: 'cmake',
        cmakeVersion: '*',
        sourceDir: '/home/user/project',
        url: '',
        gitRepository: '',
        gitTag: '',
        downloadDir: '',
        patches: [],
        buildDir: 'build',
        preset: '',
        cc: '',
        ccflags: '',
        cxx: '/usr/bin/g++',
        cxxflags: '',
        ldflags: '',
        cxxstd: null,
        shared: undefined,
        toolchain: '',
        generator: 'Ninja',
        generatorToolset: '',
        generatorArchitecture: '',
        arch: '',
        buildType: 'Release',
        buildTarget: [],
        extraArgs: [],
        exportCompileCommands: undefined,
        jobs: 4,
        runTests: undefined,
        configureTestsFlag: 'BUILD_TESTING',
        ctestTimeout: undefined,
        install: undefined,
        installPrefix: '',
        package: undefined,
        packageName: '',
        packageDir: '',
        packageVendor: '',
        packageGenerators: [],
        packageArtifact: undefined,
        packageRetentionDays: 10,
        createAnnotations: true,
        refSourceDir: '/home/user/project',
        traceCommands: false,
        is_main_entry: true,
        testAllCxxstd: false,
        installAllCxxstd: undefined,
        packageAllCxxstd: false,
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('createAnnotationsFromMessage', () => {
    it('creates error annotation for error severity', () => {
        const messages: Message[] = [{
            title: 'Build Error',
            file: 'src/main.cpp',
            line: 10,
            column: 5,
            severity: 'Error',
            message: 'undefined reference'
        }];
        createAnnotationsFromMessage(messages);
        expect(mockedCore.error).toHaveBeenCalledWith('undefined reference', {
            title: 'Build Error',
            file: 'src/main.cpp',
            startLine: 10,
            endLine: 10,
            startColumn: 5,
            endColumn: 5
        });
    });

    it('creates warning annotation for warning severity', () => {
        const messages: Message[] = [{
            title: 'Build Warning',
            file: 'src/main.cpp',
            line: 20,
            column: undefined,
            severity: 'Warning',
            message: 'unused variable'
        }];
        createAnnotationsFromMessage(messages);
        expect(mockedCore.warning).toHaveBeenCalledWith('unused variable', {
            title: 'Build Warning',
            file: 'src/main.cpp',
            startLine: 20,
            endLine: 20,
            startColumn: 0,
            endColumn: 0
        });
    });

    it('handles messages without file or title', () => {
        const messages: Message[] = [{
            title: '',
            file: undefined,
            line: undefined,
            column: undefined,
            severity: 'warning',
            message: 'some warning'
        }];
        createAnnotationsFromMessage(messages);
        expect(mockedCore.warning).toHaveBeenCalledWith('some warning', {
            title: undefined,
            file: undefined,
            startLine: undefined,
            endLine: undefined,
            startColumn: 0,
            endColumn: 0
        });
    });

    it('handles multiple messages', () => {
        const messages: Message[] = [
            { title: 'Error 1', file: 'a.cpp', line: 1, column: undefined, severity: 'error', message: 'msg1' },
            { title: 'Warning 1', file: 'b.cpp', line: 2, column: 3, severity: 'Warning', message: 'msg2' }
        ];
        createAnnotationsFromMessage(messages);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
    });

    it('handles empty messages array', () => {
        createAnnotationsFromMessage([]);
        expect(mockedCore.error).not.toHaveBeenCalled();
        expect(mockedCore.warning).not.toHaveBeenCalled();
    });
});

describe('createCMakeConfigureAnnotations', () => {
    it('parses CMake warning with file and line', () => {
        const output = 'CMake Warning at CMakeLists.txt:10 (message):\n  Some warning message\n';
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.stringContaining('Some warning message'),
            expect.objectContaining({ startLine: 10 })
        );
    });

    it('parses CMake error with file and line', () => {
        const output = 'CMake Error at src/CMakeLists.txt:25 (find_package):\n  Could not find package Foo\n';
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
        expect(mockedCore.error).toHaveBeenCalledWith(
            expect.stringContaining('Could not find package Foo'),
            expect.objectContaining({ startLine: 25 })
        );
    });

    it('parses CMake warning without file (global warning)', () => {
        const output = 'CMake Warning:\n  Unused variable\n';
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
    });

    it('handles multi-line messages', () => {
        const output = [
            'CMake Warning at CMakeLists.txt:5 (message):',
            '  First line of warning',
            '  Second line of warning',
            'non-empty line ends the message',
            ''
        ].join('\n');
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        // The message gets appended until a non-empty line triggers push
        expect(mockedCore.warning).toHaveBeenCalled();
    });

    it('handles output with no CMake messages', () => {
        const output = '-- Configuring done\n-- Generating done\n-- Build files written\n';
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        expect(mockedCore.warning).not.toHaveBeenCalled();
        expect(mockedCore.error).not.toHaveBeenCalled();
    });

    it('handles multiple warnings in sequence', () => {
        const output = [
            'CMake Warning at CMakeLists.txt:1 (message):',
            '  Warning one',
            'non-empty',
            'CMake Warning at CMakeLists.txt:5 (message):',
            '  Warning two',
            'non-empty',
            ''
        ].join('\n');
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(2);
    });

    it('pushes pending message when a new match starts', () => {
        const output = [
            'CMake Warning at CMakeLists.txt:1 (message):',
            '  First warning text',
            'CMake Error at CMakeLists.txt:10 (find_package):',
            '  Error text',
            'non-empty'
        ].join('\n');
        const inputs = makeInputs();
        createCMakeConfigureAnnotations(output, inputs);
        // First warning pushed when second match encountered, second pushed at non-empty line
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
    });

    it('resolves file paths relative to source and ref directories', () => {
        const inputs = makeInputs({
            sourceDir: '/workspace/src',
            refSourceDir: '/workspace'
        });
        const output = 'CMake Warning at CMakeLists.txt:3 (message):\n  test\nend\n';
        createCMakeConfigureAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                file: path.join('src', 'CMakeLists.txt')
            })
        );
    });
});

describe('createCMakeBuildAnnotations', () => {
    it('parses GCC/Clang warning format', () => {
        const output = '/home/user/project/src/main.cpp:42:10: warning: unused variable [-Wunused-variable]';
        const inputs = makeInputs();
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.stringContaining('unused variable'),
            expect.objectContaining({
                startLine: 42
            })
        );
    });

    it('parses GCC/Clang error format', () => {
        const output = '/home/user/project/src/main.cpp:10:5: error: undeclared identifier';
        const inputs = makeInputs();
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
    });

    it('parses MSVC warning format', () => {
        const output = 'C:\\project\\src\\main.cpp(42): warning C4996: deprecated function';
        const inputs = makeInputs({
            sourceDir: 'C:\\project',
            refSourceDir: 'C:\\project'
        });
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.stringContaining('deprecated function'),
            expect.objectContaining({
                startLine: 42
            })
        );
    });

    it('parses MSVC error format', () => {
        const output = 'C:\\project\\src\\main.cpp(10): error C2065: undeclared identifier';
        const inputs = makeInputs({
            sourceDir: 'C:\\project',
            refSourceDir: 'C:\\project'
        });
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
    });

    it('handles GCC warning without error code', () => {
        const output = '/home/user/project/src/main.cpp:5:1: warning: some warning message ';
        const inputs = makeInputs();
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
    });

    it('handles output with no compiler messages', () => {
        const output = '[100%] Built target mylib\nLinking CXX shared library libfoo.so\n';
        const inputs = makeInputs();
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).not.toHaveBeenCalled();
        expect(mockedCore.error).not.toHaveBeenCalled();
    });

    it('handles mixed GCC and MSVC messages', () => {
        const output = [
            '/home/user/project/src/a.cpp:1:1: warning: msg1 [-Wfoo]',
            'C:\\project\\src\\b.cpp(2): error C1234: msg2'
        ].join('\n');
        const inputs = makeInputs();
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledTimes(1);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
    });

    it('includes compiler name in title and message when cxx is set', () => {
        const output = '/home/user/project/src/main.cpp:1:1: warning: some warning [-Wtest]';
        const inputs = makeInputs({ cxx: '/usr/bin/g++' });
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.stringContaining('g++'),
            expect.objectContaining({
                title: expect.stringContaining('g++')
            })
        );
    });

    it('builds title without compiler when cxx is empty', () => {
        const output = '/home/user/project/src/main.cpp:1:1: warning: some warning [-Wtest]';
        const inputs = makeInputs({ cxx: '' });
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                title: expect.stringContaining('Build Warning')
            })
        );
    });

    it('includes error code in title and message', () => {
        const output = '/home/user/project/src/main.cpp:1:1: warning: deprecated function [-Wdeprecated]';
        const inputs = makeInputs({ cxx: '/usr/bin/g++' });
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.stringContaining('[-Wdeprecated]'),
            expect.objectContaining({
                title: expect.stringContaining('[-Wdeprecated]')
            })
        );
    });

    it('resolves file paths relative to ref source dir', () => {
        const inputs = makeInputs({
            sourceDir: '/workspace/src',
            refSourceDir: '/workspace'
        });
        const output = 'main.cpp:1:1: warning: test message ';
        createCMakeBuildAnnotations(output, inputs);
        expect(mockedCore.warning).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                file: expect.stringContaining('main.cpp')
            })
        );
    });

    it('handles GCC warning without column', () => {
        const output = '/home/user/project/src/main.cpp:5:: warning: some warning message ';
        const inputs = makeInputs();
        createCMakeBuildAnnotations(output, inputs);
        // This won't match the gcc/clang regex because the column part (:digit:) is empty with extra ':'
        // The behavior depends on the regex — should not crash
    });
});

describe('createCMakeTestAnnotations', () => {
    it('parses Boost.Test failure line', () => {
        const output = '#1 /home/user/project/test/main.cpp(42) failed: check a == b has failed [1 != 2]';
        const inputs = makeInputs();
        createCMakeTestAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
        expect(mockedCore.error).toHaveBeenCalledWith(
            expect.stringContaining('Boost.Test'),
            expect.objectContaining({
                title: 'Boost.Test',
                startLine: 42
            })
        );
    });

    it('parses multiple Boost.Test failures', () => {
        const output = [
            '#1 test/a.cpp(10) failed: check x == y [1 != 2]',
            '#2 test/b.cpp(20) failed: check foo [false]'
        ].join('\n');
        const inputs = makeInputs();
        createCMakeTestAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledTimes(2);
    });

    it('handles output with no Boost.Test failures', () => {
        const output = 'Running 10 test cases...\n\n*** No errors detected\n';
        const inputs = makeInputs();
        createCMakeTestAnnotations(output, inputs);
        expect(mockedCore.error).not.toHaveBeenCalled();
    });

    it('resolves file path relative to ref source dir', () => {
        const inputs = makeInputs({
            sourceDir: '/workspace/src',
            refSourceDir: '/workspace'
        });
        const output = '#1 test/main.cpp(5) failed: check a [false]';
        createCMakeTestAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledWith(
            expect.stringContaining('Boost.Test'),
            expect.objectContaining({
                file: expect.stringContaining(path.join('test', 'main.cpp'))
            })
        );
    });

    it('handles test numbers with multiple digits', () => {
        const output = '#123 test/main.cpp(99) failed: some check';
        const inputs = makeInputs();
        createCMakeTestAnnotations(output, inputs);
        expect(mockedCore.error).toHaveBeenCalledTimes(1);
        expect(mockedCore.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ startLine: 99 })
        );
    });
});
