import os
import re
import yaml
from collections import OrderedDict


# Define a subclass of FullLoader that returns an OrderedDict
class OrderedLoader(yaml.FullLoader):
    def construct_mapping(self, node, deep=False):
        if isinstance(node, yaml.MappingNode):
            self.flatten_mapping(node)
        else:
            raise yaml.constructor.ConstructorError(None, None,
                                                    'expected a mapping node, but found %s' % node.id, node.start_mark)
        mapping = OrderedDict()
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            value = self.construct_object(value_node, deep=deep)
            mapping[key] = value
        return mapping


# Define a custom Dumper class that preserves the order of the keys
class OrderedDumper(yaml.Dumper):
    pass


# Add a representer function for OrderedDicts to the OrderedDumper class
def represent_ordereddict(dumper, data):
    value = []
    for item_key, item_value in data.items():
        node_key = dumper.represent_data(item_key)
        node_value = dumper.represent_data(item_value)
        value.append((node_key, node_value))
    return yaml.nodes.MappingNode(u'tag:yaml.org,2002:map', value)


OrderedDumper.add_representer(OrderedDict, represent_ordereddict)


def sort_step(d):
    sorted_dict = OrderedDict()
    priority = ['name', 'uses', 'if', 'id', 'with']
    for key in priority:
        if key in d:
            sorted_dict[key] = d[key]
    for key in d:
        if key not in sorted_dict:
            sorted_dict[key] = d[key]
    return sorted_dict


readme_base = os.path.join('README.base.adoc')
reference_dir = os.path.join('docs', 'modules', 'ROOT', 'pages', 'actions')
example_path = os.path.join('.github', 'workflows', 'ci.yml')
actions = ['setup-cpp', 'package-install', 'cmake-workflow', 'boost-clone', 'b2-workflow', 'create-changelog',
           'setup-cmake', 'setup-gcc', 'setup-clang']

with open(example_path, 'r') as f:
    ci_yml = yaml.load(f, Loader=OrderedLoader)
    matrix = ci_yml['jobs']['build']['strategy']['matrix']['include']
    steps = ci_yml['jobs']['build']['steps']
    steps += ci_yml['jobs']['docs']['steps']

# Load the YAML file
toc_output = ''
index_output = ''


def gha_tokenize(expression):
    tokens = []
    i = 0
    while i < len(expression):
        c = expression[i]
        if c == '(':
            tokens.append(c)
        elif c == ')':
            tokens.append(c)
        elif c == ',':
            tokens.append(c)
        elif c == "'" or c == '"':
            start = i
            i += 1
            while i < len(expression) and expression[i] != c:
                if expression[i] == '\\':
                    i += 1
                i += 1
            tokens.append(expression[start:i + 1])
        elif expression[i:i + 2] == '&&' or expression[i:i + 2] == '||':
            tokens.append(expression[i:i + 2])
            i += 1
        elif c.isspace():
            pass
        else:
            start = i
            while i < len(expression) and (expression[i].isalnum() or expression[i] not in ',() '):
                i += 1
            tokens.append(expression[start:i])
            i -= 1
        i += 1
    return tokens


def gha_evaluate(template: str, context):
    def replace_expression(expression: str):
        tokens = gha_tokenize(expression)
        # Replace matrix variables
        for i in range(len(tokens)):
            if tokens[i].startswith('matrix.'):
                var_name = tokens[i][len('matrix.'):]
                if var_name in context:
                    if type(context[var_name]) is bool:
                        tokens[i] = f"'{'true' if context[var_name] else 'false'}'"
                    elif type(context[var_name]) is not list:
                        tokens[i] = f"'{context[var_name]}'"
                else:
                    tokens[i] = "''"

        # Reduce tokens to a single element
        reduced = True
        while len(tokens) > 1 and reduced:
            reduced = False

            # resolved '()'
            for i in range(len(tokens)):
                if tokens[i] == '(':
                    value = tokens[i + 1]
                    end = tokens[i + 2]
                    if end != ')':
                        continue
                    tokens_pre = tokens[:i]
                    tokens_post = tokens[i + 3:]
                    tokens = tokens_pre + [value] + tokens_post
                    reduced = True
                    break

            # resolved &&
            for i in range(len(tokens)):
                if tokens[i] == '&&':
                    lhs = tokens[i - 1]
                    rhs = tokens[i + 1]
                    if not lhs.startswith("'"):
                        continue
                    if not rhs.startswith("'"):
                        continue
                    if lhs in ["''", "'false'"]:
                        tokens = tokens[:i - 1] + ["''"] + tokens[i + 2:]
                    else:
                        tokens = tokens[:i - 1] + [rhs] + tokens[i + 2:]
                    reduced = True
                    break

            for i in range(len(tokens)):
                if tokens[i] == '||':
                    lhs = tokens[i - 1]
                    rhs = tokens[i + 1]
                    if not lhs.startswith("'"):
                        continue
                    if not rhs.startswith("'"):
                        continue
                    if lhs in ["''", "'false'"]:
                        tokens = tokens[:i - 1] + [rhs] + tokens[i + 2:]
                    else:
                        tokens = tokens[:i - 1] + [lhs] + tokens[i + 2:]
                    reduced = True
                    break

            for i in range(len(tokens)):
                if tokens[i] == '==':
                    lhs = tokens[i - 1]
                    rhs = tokens[i + 1]
                    if not lhs.startswith("'"):
                        continue
                    if not rhs.startswith("'"):
                        continue
                    if lhs == rhs:
                        tokens = tokens[:i - 1] + ["'true'"] + tokens[i + 2:]
                    else:
                        tokens = tokens[:i - 1] + ["'false'"] + tokens[i + 2:]
                    reduced = True
                    break

            # startsWith
            for i in range(len(tokens)):
                if tokens[i] == 'startsWith':
                    start = i + 2
                    end = start + 3
                    if tokens[end] != ')':
                        continue
                    string_value = tokens[start]
                    string_prefix = tokens[start + 2]
                    if not string_value.startswith("'"):
                        continue
                    if not string_prefix.startswith("'"):
                        continue
                    string_value = string_value[1:-1]
                    string_prefix = string_prefix[1:-1]
                    if string_value.startswith(string_prefix):
                        tokens = tokens[:i] + ["'true'"] + tokens[end + 1:]
                    else:
                        tokens = tokens[:i] + ["'false'"] + tokens[end + 1:]
                    reduced = True
                    break

            # join
            for i in range(len(tokens)):
                if tokens[i] == 'join':
                    start = i + 2
                    end = start + 3
                    if tokens[end] != ')':
                        continue
                    array_name = tokens[start]
                    separator = tokens[start + 2]
                    if not separator.startswith("'"):
                        continue
                    separator = separator[1:-1]
                    array_name = array_name[len('matrix.'):]
                    value = "''"
                    if array_name in context:
                        tokens = tokens[:i] + ["'" + separator.join(context[array_name]) + "'"] + tokens[end + 1:]
                    else:
                        tokens = tokens[:i] + ["''"] + tokens[end + 1:]
                    reduced = True
                    break

            for i in range(len(tokens)):
                if tokens[i] == 'format':
                    start = i + 2
                    param = True
                    valid = True
                    end = start
                    for j in range(start, len(tokens)):
                        if tokens[j] == ')':
                            end = j
                            break
                        if param:
                            if not tokens[j].startswith("'"):
                                valid = False
                                break
                            else:
                                param = False
                        else:
                            if tokens[j] != ',':
                                valid = False
                                break
                            else:
                                param = True
                    if not valid:
                        continue
                    if end == len(tokens) or tokens[end] != ')':
                        continue
                    format_string = tokens[start][1:-1]
                    count = 0
                    for j in range(start + 2, end, 2):
                        format_string = format_string.replace(f'{{{count}}}', tokens[j][1:-1])
                        count += 1
                    tokens = tokens[:i] + ["'" + format_string + "'"] + tokens[end + 1:]
                    reduced = True
                    break

        if len(tokens) == 1 and tokens[0].startswith("'"):
            return str(tokens[0][1:-1])
        else:
            return '${{ ' + ' '.join(tokens) + ' }}'

    i = 0
    output_string = ''
    while i < len(template):
        exp_begin = template.find('${{', i)
        if exp_begin != -1:
            output_string += template[i:exp_begin]
            exp_end = template.find('}}', exp_begin + 3)
            subexpression = template[exp_begin + 3: exp_end].strip()
            output_string += replace_expression(subexpression)
            i = exp_end + 2
        else:
            output_string += template[i:]
            break

    output_string = output_string.strip()
    if output_string.startswith("'") and output_string.endswith("'"):
        output_string = output_string[1:-1].strip()

    return output_string


def replace_inputs(template, matrix_entry):
    if type(template) is str:
        return gha_evaluate(template, matrix_entry)
    if type(template) is bool:
        if template:
            return 'true'
        else:
            return 'false'
    if type(template) is float:
        return template
    example = template.copy()
    for [k, v] in example.items():
        example[k] = replace_inputs(v, matrix_entry)
    return example


for action in actions:
    with open(os.path.join(action, 'action.yml'), 'r') as f:
        data = yaml.load(f, Loader=yaml.FullLoader)

    # Extract the data from the YAML file
    action_name = data['name']
    action_description = data['description']
    inputs = data['inputs']
    outputs = data['outputs'] if 'outputs' in data else []

    output = f'= {action_name} [[{action}]]\n'
    output += f':reftext: {action_name}\n'
    output += f':navtitle: {action_name} Action\n'
    output += f'// This {action}.adoc file is automatically generated.\n// Edit parse_actions.py instead.\n\n'
    output += f'{action_description}\n\n'
    toc_output += f'- <<{action}>>\n'

    # Look for example templates
    example_templates = []
    for step in steps:
        if 'uses' in step and step['uses'].endswith(action):
            step['uses'] = f'alandefreitas/cpp-actions/{action}@master'
            example_templates.append(sort_step(step))


    def non_empty_keys(example):
        non_empty_keys = [key for key, value in example.items() if
                          not isinstance(value, str) or any(c for c in value if c != ' ')]
        non_empty_with_keys = []
        if 'with' in example:
            non_empty_with_keys = ['with.' + key for key, value in example['with'].items() if
                                   not isinstance(value, str) or any(c for c in value if c != ' ')]
        non_empty_key_set = set(non_empty_keys) | set(non_empty_with_keys)
        return non_empty_key_set


    # Remove constant expressions from template
    examples = []
    for example_template in example_templates:
        covered_keys = set()
        for matrix_entry in matrix:
            example = replace_inputs(example_template, matrix_entry)
            non_empty_key_set = non_empty_keys(example)
            if non_empty_key_set.difference(covered_keys):
                example = OrderedDict(
                    (k, v) for k, v in example.items() if not isinstance(v, str) or any(c for c in v if c != ' '))
                if 'with' in example:
                    example['with'] = OrderedDict((k, v) for k, v in example['with'].items() if
                                                  not isinstance(v, str) or any(c for c in v if c != ' '))
                if 'if' in example and example['if'] in ['true', 'false']:
                    del example['if']
                examples.append(example)
                covered_keys.update(non_empty_key_set)

    if examples:
        covered_keys = set()
        if len(examples) > 1:
            output += f'== Examples\n\n'
        else:
            output += f'== Example\n\n'
        for i in range(len(examples)):
            example = examples[i]
            if len(examples) > 1:
                output += f'Example {i + 1}'
            non_empty_key_set = non_empty_keys(example)
            if i != 0:
                diff = non_empty_key_set.difference(covered_keys)
                diff_keys = [f"`{k.split('.')[-1]}`" for k in diff]
                diff_keys.sort()
                output += f' ({", ".join(diff_keys)})'
            covered_keys.update(non_empty_key_set)
            if len(examples) > 1:
                output += ':\n\n'
            mapping = OrderedDict()
            mapping['steps'] = [example]
            output += f'[source,yml]\n----\n{yaml.dump(mapping, Dumper=OrderedDumper)}----\n\n'

    output += f'== Input Parameters\n\n'
    output += f'|===\n|Parameter |Description |Default\n'
    for parameter, details in inputs.items():
        description = details['description']
        if not description.endswith('.'):
            description += '.'
        required = details['required']
        if required == 'True':
            description += ' ⚠️ This parameter is required.'
        description = description.replace("|", "\\|")
        default = details['default']
        default = '' if not default else f'`{default}`'
        default = default.replace("|", "\\|")
        output += f'|`{parameter}` |{description} |{default}\n'
    output += '|===\n\n'

    if outputs:
        output += f'== Outputs\n\n'
        output += f'|===\n|Output |Description\n'
        for parameter, details in outputs.items():
            description = details['description']
            output += f'|`{parameter}` |{description}\n'
        output += '|===\n'

    # Write the output to a file
    action_readme_path = os.path.join('docs', 'modules', 'ROOT', 'pages', 'actions', f'{action}.adoc')
    with open(action_readme_path, 'w') as f:
        f.write(output)

    # Update index content
    index_output += f'include::{os.path.relpath(action_readme_path, reference_dir)}[leveloffset=+1]\n'

if not os.path.exists(reference_dir):
    os.makedirs(reference_dir)
with open(os.path.join(reference_dir, 'index.adoc'), 'w') as f:
    f.write('= Actions\n:reftext: Actions\n:navtitle: All Actions\n\n')
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
