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
import sys
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
    parser.add_argument('-o', '--output', help="output file", default='combined-traces.md')
    parser.add_argument('--verbose', action='store_true', help="Verbose mode")
    args = parser.parse_args()

    source_dir = os.path.abspath(args.source_dir)
    build_dir = os.path.abspath(args.build_dir)
    output = os.path.join(build_dir, args.output)
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

        for event in trace['traceEvents']:
            # Filter out very short events to reduce data size
            event_is_too_short = event['ph'] == 'M' or event['name'].startswith('Total') or event['dur'] < 5000
            if event_is_too_short:
                continue

            log('Event:', event)

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

    with open(output, 'w') as f:
        json.dump({'traceEvents': sorted(combined_data, key=lambda k: k['ts'])}, f)
        log('Saved to ', os.path.abspath(output))
