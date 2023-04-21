import os
import re
import yaml

readme_base = os.path.join('README.base.adoc')
reference_dir = os.path.join('docs', 'reference')
example_path = os.path.join('.github', 'workflows', 'ci.yml')
actions = ['package_install', 'cmake_workflow', 'boost_clone', 'b2_workflow']

# Load the YAML file
toc_output = ''
index_output = ''
for action in actions:
    with open(os.path.join(action, 'action.yml'), 'r') as f:
        data = yaml.load(f, Loader=yaml.FullLoader)

    # Extract the data from the YAML file
    action_name = data['name']
    action_description = data['description']
    inputs = data['inputs']
    outputs = data['outputs'] if 'outputs' in data else []

    output = f'== {action_name} [[{action}]]\n\n{action_description}\n\n'
    toc_output += f'- <<{action}>>\n'

    examples = []
    with open(example_path, 'r') as file:
        example = ''
        is_action_example = ''
        for line in file:
            if re.match(r'^\s*- name:(.*)$', line):
                if is_action_example:
                    examples.append(example)
                is_action_example = False
                example = line
            else:
                if re.match(f'^\\s*uses:\\s*\\./{action}\\s*$', line):
                    is_action_example = True
                    line = line.replace(f'./{action}', f'alandefreitas/cpp-actions/{action}')
                example += line

    if examples:
        if len(examples) > 1:
            output += f'=== Examples\n\n'
        else:
            output += f'=== Example\n\n'
        for i in range(len(examples)):
            example = examples[i]
            if len(examples) > 1:
                output += f'Example {i + 1}:\n\n'
            output += f'[source,yml]\n----\n{example}----\n\n'

    output += f'=== Input Parameters\n\n'
    output += f'|===\n|Parameter |Description |Default\n'
    for parameter, details in inputs.items():
        description = details['description']
        if not description.endswith('.'):
            description += '.'
        required = details['required']
        if required == 'True':
            description += ' ⚠️ This parameter is required.'
        default = details['default']
        default = '(empty)' if not default else f'`{default}`'
        output += f'|`{parameter}` |{description} |{default}\n'
    output += '|===\n\n'

    if outputs:
        output += f'=== Outputs\n\n'
        output += f'|===\n|Output |Description\n'
        for parameter, details in outputs.items():
            description = details['description']
            output += f'|`{parameter}` |{description}\n'
        output += '|===\n'

    # Write the output to a file
    action_readme_path = os.path.join(action, 'README.adoc')
    with open(action_readme_path, 'w') as f:
        f.write(output)

    # Update index content
    index_output += f'include::{os.path.relpath(action_readme_path, reference_dir)}[]\n'

if not os.path.exists(reference_dir):
    os.makedirs(reference_dir)
with open(os.path.join(reference_dir, 'INDEX.adoc'), 'w') as f:
    f.write('= Actions\n\n')
    f.write(toc_output)
    f.write('\n')
    f.write(index_output)


# Render includes in README.adoc so that github can render it
def render_include(fout, path, leveloffset):
    with open(path, 'r') as fin:
        for line in fin:
            m = re.match(r'^( *)(=+) (.*)$', line)
            if m:
                fout.write(f'{m.group(1)}{m.group(2)}{"=" * leveloffset} {m.group(3)}\n')
                continue

            m = re.match(r'^ *include::([^\[]+)(\[[^]]+])?.*$', line)
            if m:
                offset = 0
                if m.group(2):
                    m2 = re.match(r'\[.*leveloffset=\+?(\d+).*]', m.group(2))
                    if m2:
                        offset = int(m2.group(1))
                render_include(fout, os.path.join(os.path.dirname(path), m.group(1)), leveloffset + offset)
                continue

            fout.write(line)


readme_base = 'README.base.adoc'
readme_target = 'README.adoc'
with open(readme_target, 'w') as fout:
    with open(readme_base, 'r') as fin:
        for line in fin:
            m = re.match(r'^ *include::([^\[]+)(\[[^]]+])?.*$', line)
            if m:
                offset = 0
                if m.group(2):
                    m2 = re.match(r'\[.*leveloffset=\+?(\d+).*]', m.group(2))
                    if m2:
                        offset = int(m2.group(1))
                render_include(fout, os.path.join(os.getcwd(), m.group(1)), offset)
                fout.write('\n')
            else:
                fout.write(line)

