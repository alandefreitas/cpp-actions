#
# Copyright (c) 2022-2023 Alan de Freitas (alandefreitas@gmail.com)
#
# Distributed under the Boost Software License, Version 1.0.
# See accompanying file LICENSE or copy at http://www.boost.org/LICENSE_1_0.txt
#
# Official repository: https://github.com/alandefreitas/futures
#

"""Combine JSON from multiple -ftime-traces into one.

Run with (e.g.): python combine_traces.py foo.json bar.json.

Adapted from: https://www.snsystems.com/technology/tech-blog/clang-time-trace-feature"""

import argparse
import json
import os
import re

# Logging partial results
verbose = False


def log(*args):
    global verbose
    if verbose:
        print(*args)


def find_trace_files(directory):
    trace_files = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".cpp.json") and os.path.exists(os.path.join(root, file[:-len(".cpp.json")] + '.cpp.o')):
                trace_files.append(os.path.join(root, file))
    return trace_files


def find_compile_commands(directory):
    current_dir = os.path.abspath(directory)

    # Walk up parent paths until reaching the root
    while current_dir != os.path.sep:
        compile_commands_path = os.path.join(current_dir, 'compile_commands.json')
        if os.path.isfile(compile_commands_path):
            return compile_commands_path

        current_dir = os.path.dirname(current_dir)

    return None


def load_compile_commands(directory):
    path = find_compile_commands(directory)
    if path is None:
        return []
    with open(path, 'r') as f:
        return json.load(f)


def is_subpath(child_path, parent_path):
    child_path = os.path.abspath(child_path)
    parent_path = os.path.abspath(parent_path)
    return child_path.startswith(parent_path + '/')


def extract_include_paths(command):
    include_paths = []

    # Match -isystem options and paths
    isystem_regex = r'-isystem\s+([^\s]+)'
    matches = re.findall(isystem_regex, command)
    include_paths.extend(matches)

    # Match -I options and paths
    i_option_regex = r'-I\s*([^\s]+)'
    matches = re.findall(i_option_regex, command)
    include_paths.extend(matches)

    return include_paths


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Installs the dependencies needed to test a Boost library.')
    parser.add_argument('--source-dir', help="directory to scan", default=os.getcwd())
    parser.add_argument('--build-dir', help="directory to scan", default=os.getcwd())
    parser.add_argument('-o', '--output', help="output file", default='combined-traces.json')
    parser.add_argument('--report-output', help="output file", default='time-trace-report.md')
    parser.add_argument('--verbose', action='store_true', help="Verbose mode")
    args = parser.parse_args()

    source_dir = os.path.abspath(args.source_dir)
    build_dir = os.path.abspath(args.build_dir)
    output_path = os.path.join(build_dir, args.output)
    report_path = os.path.join(build_dir, args.report_output)
    verbose = args.verbose

    # Find trace files
    trace_files = find_trace_files(build_dir)
    log(f'{len(trace_files)} trace files')
    log([os.path.relpath(trace_file, build_dir) for trace_file in trace_files])

    # Open trace files
    traces = []
    for filename in trace_files:
        with open(filename, 'r') as f:
            traces.append((filename, json.load(f)))
    log('Time-trace files loaded')

    # Find CMake compile_commands.json
    compile_commands = load_compile_commands(build_dir)

    # Include dirs used in compilation, so we can determine which are reasonable relative paths for files
    include_paths = []
    for compile_command in compile_commands:
        include_paths += extract_include_paths(compile_command['command'])
    PATH = os.getenv('PATH')
    if PATH:
        include_paths += PATH.split(':')
    include_paths.append('/usr/include')
    include_paths.append('/usr/local/include')
    include_paths.append('/usr/include/c++')

    # Report data
    total_compile: {int} = (0, 0)
    # Frontend: parsing and instantiations
    total_frontend: {int} = (0, 0)
    total_parsing: {int} = (0, 0)
    total_instantiations: {int} = (0, 0)
    # Backend: code generation and optimizations
    total_backend: {int} = (0, 0)
    total_codegen: {int} = (0, 0)
    total_optimize: {int} = (0, 0)
    # Individual files and symbols
    file_compile: {str, tuple} = {}
    file_parse: {str, tuple} = {}
    symbol_parse: {str, tuple} = {}
    symbol_instantiate: {str, tuple} = {}

    # Combine time-trace content
    start_time = 0
    combined_data = []
    file_total_time = 0
    for [filename, trace] in traces:
        # Adjust filename
        filename = os.path.relpath(filename, build_dir)
        filename = filename[:-5]
        for compile_command in compile_commands:
            if compile_command['command'].find(filename) != -1:
                filename = compile_command['file']
                filename = os.path.relpath(filename, source_dir)
                break
        filename = filename.replace('CMakeFiles/', '')
        segments = filename.split('/')
        segments = [f'{{{segment[:-4]}}}' if segment.endswith('.dir') else segment for segment in segments]
        filename = '/'.join(segments)
        if filename.find('../') != -1:
            filename = os.path.abspath(filename)

        # regions already accounted for
        parsing_regions = []
        instantiation_regions = []

        sorted_events = sorted(trace['traceEvents'], key=lambda x: 0 if 'dur' not in x else int(x['dur']), reverse=True)
        for event in sorted_events:
            # Filter out very short events to reduce data size
            event_is_too_short = event['ph'] == 'M' or event['name'].startswith('Total')
            if event_is_too_short:
                continue

            # log('Event:', event)
            # Adjust detail path
            if 'args' in event and 'detail' in event['args']:
                if type(event['args']['detail']) == str:
                    if os.path.exists(event['args']['detail']):
                        event['args']['detail'] = os.path.abspath(event['args']['detail'])
                        if is_subpath(event['args']['detail'], source_dir):
                            event['args']['detail'] = os.path.relpath(event['args']['detail'], source_dir)
                        elif is_subpath(event['args']['detail'], build_dir):
                            event['args']['detail'] = os.path.relpath(event['args']['detail'], build_dir)
                        else:
                            for include_path in include_paths:
                                if is_subpath(event['args']['detail'], include_path):
                                    event['args']['detail'] = os.path.relpath(event['args']['detail'], include_path)
                                    break
                        log(f"Detail Path: {event['args']['detail']}")

            # Store data for the report
            if event['name'] == 'Source':
                # add to total
                ts = int(event['ts'])
                dur = int(event['dur'])
                accounted_for = False
                for parsing_region in parsing_regions:
                    if parsing_region[0] <= ts < parsing_region[1]:
                        accounted_for = True
                        break
                if not accounted_for:
                    total_parsing = (total_parsing[0] + 1, total_parsing[1] + dur)
                    parsing_regions.append((ts, ts + dur))

                # add to files total
                file = event['args']['detail']
                if file not in file_parse:
                    file_parse[file] = (0, 0)
                file_parse[file] = (file_parse[file][0] + 1, file_parse[file][1] + dur)

            elif event['name'].startswith('Parse') and 'args' in event and 'detail' in event['args']:
                # add to symbols total
                dur = int(event['dur'])
                symbol = event['args']['detail']
                if symbol not in symbol_parse:
                    symbol_parse[symbol] = (0, 0)
                symbol_parse[symbol] = (symbol_parse[symbol][0] + 1, symbol_parse[symbol][1] + dur)

            elif event['name'].startswith('Instantiate') and 'args' in event and 'detail' in event['args']:
                # add to total
                ts = int(event['ts'])
                dur = int(event['dur'])
                accounted_for = False
                for instantiation_region in instantiation_regions:
                    if instantiation_region[0] <= ts < instantiation_region[1]:
                        accounted_for = True
                        break
                if not accounted_for:
                    total_instantiations = (total_instantiations[0] + 1, total_instantiations[1] + dur)
                    instantiation_regions.append((ts, ts + dur))

                # add to symbol total
                symbol = event['args']['detail']
                if symbol not in symbol_instantiate:
                    symbol_instantiate[symbol] = (0, 0)
                symbol_instantiate[symbol] = (symbol_instantiate[symbol][0] + 1, symbol_instantiate[symbol][1] + dur)

            elif event['name'] == 'PerformPendingInstantiations':
                ts = int(event['ts'])
                dur = int(event['dur'])
                total_instantiations = (total_instantiations[0] + 1, total_instantiations[1] + dur)
                instantiation_regions.append((ts, ts + dur))

            elif event['name'] == 'Frontend':
                total_frontend = (total_frontend[0] + 1, total_frontend[1] + int(event['dur']))
            elif event['name'] == 'Backend':
                total_backend = (total_backend[0] + 1, total_backend[1] + int(event['dur']))
            elif event['name'] == 'Optimizer':
                total_optimize = (total_optimize[0] + 1, total_optimize[1] + int(event['dur']))
            elif event['name'] == 'CodeGenPasses':
                total_codegen = (total_codegen[0] + 1, total_codegen[1] + int(event['dur']))
            elif event['name'] == 'ExecuteCompiler':
                # add to total
                ts = int(event['ts'])
                dur = int(event['dur'])
                total_compile = (total_compile[0] + 1, total_compile[1] + dur)

                # add to files total
                if filename not in file_compile:
                    file_compile[filename] = (0, 0)
                file_compile[filename] = (file_compile[filename][0] + 1, file_compile[filename][1] + dur)

            # Keep track of the main ExecuteCompiler event, which exists for each file
            # Also adapt this event to include the file name
            if event['name'] == 'ExecuteCompiler':
                # Find how long this compilation took for this file
                # This represents how long the whole object file took
                # and can be used to shift the start time for the next file
                file_total_time = event['dur']
                log(filename, 'took', file_total_time)
                # Set the file name in ExecuteCompiler
                if 'args' not in event:
                    event['args'] = {}
                event['args']['detail'] = filename

            # Replace source event names with filename
            if event['name'] == 'Source':
                if 'args' in event and 'detail' in event['args']:
                    event['name'] = event['args']['detail']
                else:
                    event['name'] = filename
                event['cat'] = 'Source'

            # Offset by start time to make events sequential in a single timeline
            event['ts'] += start_time

            # Put all events in the same pid
            # Different pids tend to be rendered in different tabs in some
            # visualizers, which is not what we want
            event['pid'] = 0
            event['tid'] = 0

            # Add data to combined
            combined_data.append(event)

        # Increase the start time for the next file
        # Add 1 to avoid issues with simultaneous events
        start_time += file_total_time + 1

    with open(output_path, 'w') as f:
        json.dump({'traceEvents': sorted(combined_data, key=lambda k: k['ts'])}, f)
        log('Saved to ', os.path.abspath(output_path))


    # Report
    def format_time(microseconds):
        if microseconds < 1000:
            return f"{round(microseconds, 2)} µs"
        elif microseconds < 1000000:
            milliseconds = round(microseconds / 1000, 2)
            return f"{milliseconds} ms"
        else:
            seconds = round(microseconds / 1000000, 2)
            return f"{seconds} s"


    # Report output
    output = '# Time Trace\n\n'
    output += '## Summary\n\n'
    output += '| Step | %     | Total Time | Avg. | Count |\n'
    output += '| --------- | ----- | ---------- | ------------ | ----- |\n'
    if total_compile[0] != 0:
        output += f'| Compile   | 100%   | {format_time(total_compile[1])} | {format_time(total_compile[1] / total_compile[0])} | {total_compile[0]} |\n'
    if total_frontend[0] != 0:
        output += f'| 1) Frontend   | {round(100 * total_frontend[1] / total_compile[1], 2)}% | {format_time(total_frontend[1])} | {format_time(total_frontend[1] / total_frontend[0])} | {total_frontend[0]} |\n'
    if total_parsing[0] != 0:
        output += f'| 1A) Parsing   | {round(100 * total_parsing[1] / total_compile[1], 2)}% | {format_time(total_parsing[1])} | {format_time(total_parsing[1] / total_parsing[0])} | {total_parsing[0]} |\n'
    if total_instantiations[0] != 0:
        output += f'| 1B) Instantiations   | {round(100 * total_instantiations[1] / total_compile[1], 2)}% | {format_time(total_instantiations[1])} | {format_time(total_instantiations[1] / total_instantiations[0])} | {total_instantiations[0]} |\n'
    if total_backend[0] != 0:
        output += f'| 2) Backend   | {round(100 * total_backend[1] / total_compile[1], 2)}% | {format_time(total_backend[1])} | {format_time(total_backend[1] / total_backend[0])} | {total_backend[0]} |\n'
    if total_codegen[0] != 0:
        output += f'| 2A) Code Generation   | {round(100 * total_codegen[1] / total_compile[1], 2)}% | {format_time(total_codegen[1])} | {format_time(total_codegen[1] / total_codegen[0])} | {total_codegen[0]} |\n'
    if total_optimize[0] != 0:
        output += f'| 2B) Optimization   | {round(100 * total_optimize[1] / total_compile[1], 2)}% | {format_time(total_optimize[1])} | {format_time(total_optimize[1] / total_optimize[0])} | {total_optimize[0]} |\n'
    output += '\n\n'

    output += '## Files\n\n'


    def section_table(column_name, data):
        section_output = f'| {column_name} | %    | Total Time | Avg. | Count |\n'
        section_output += '| --------- | ---------- | ---------- | ------------ | ----- |\n'

        data = dict(sorted(data.items(), key=lambda x: x[1][1], reverse=True))
        acc = 0
        for [_, v] in data.items():
            [_, time] = v
            acc += time

        n = 0
        for [file, v] in data.items():
            [count, time] = v
            section_output += f'| `{file}` | {round(100 * time / acc, 2)} % | {format_time(time)} | {format_time(time / count)} | {count} |\n'
            n += 1
            if n > 7:
                break
        section_output += '\n\n'

        if n > 7:
            section_output += '<details>\n<summary>More...</summary>\n\n'
            section_output += f'| {column_name} | %    | Total Time | Avg. | Count |\n'
            section_output += '| --------- | ---------- | ---------- | ------------ | ----- |\n'
            n = 0
            for [file, v] in data.items():
                [count, time] = v
                section_output += f'| `{file}` | {round(100 * time / acc, 2)} % | {format_time(time)} | {format_time(time / count)} | {count} |\n'
                n += 1
                if n > 100:
                    break
            section_output += '\n\n'
            section_output += '</details>\n\n'
        return section_output


    output += '### Compile\n\n'
    output += section_table('File', file_compile)
    output += '### Parse\n\n'
    output += section_table('File', file_parse)

    output += '## Symbols\n\n'

    output += '### Parse\n\n'
    output += section_table('Symbol', symbol_parse)
    output += '### Instantiate\n\n'
    output += section_table('Symbol', symbol_instantiate)
    output += '### Instantiate Sets\n\n'


    def convert_template_string(input_string):
        l = 0
        output_str = ''
        for c in input_string:
            if l == 0:
                output_str += c
            if c == '<':
                if l == 0:
                    output_str += '$'
                l += 1
            elif c == '>':
                l -= 1
                if l == 0:
                    output_str += c
        return output_str


    symbol_set_instantiate: {str, tuple} = {}
    for [symbol, v] in symbol_instantiate.items():
        [count, time] = v
        symbol_set = convert_template_string(symbol)
        if symbol_set not in symbol_set_instantiate:
            symbol_set_instantiate[symbol_set] = (0, 0)
        symbol_set_instantiate[symbol_set] = (
            symbol_set_instantiate[symbol_set][0] + count, symbol_set_instantiate[symbol_set][1] + time)
    output += section_table('Symbol Set', symbol_set_instantiate)

    log(output)
    with open(report_path, 'w') as f:
        f.write(output)
        log('Report saved to ', os.path.abspath(report_path))
