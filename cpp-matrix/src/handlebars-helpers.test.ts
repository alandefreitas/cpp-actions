import * as Handlebars from 'handlebars';
import { registerHelpers } from './handlebars-helpers';

describe('Handlebars helpers', () => {
    beforeAll(() => {
        registerHelpers();
    });

    describe('string helpers', () => {
        test('lowercase converts to lowercase', () => {
            const template = Handlebars.compile('{{lowercase str}}');
            expect(template({ str: 'HELLO' })).toBe('hello');
        });

        test('uppercase converts to uppercase', () => {
            const template = Handlebars.compile('{{uppercase str}}');
            expect(template({ str: 'hello' })).toBe('HELLO');
        });

        test('contains checks substring presence', () => {
            const template = Handlebars.compile('{{#if (contains str "world")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
            expect(template({ str: 'hello' })).toBe('no');
        });

        test('startsWith checks string prefix', () => {
            const template = Handlebars.compile('{{#if (startsWith str "hello")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
            expect(template({ str: 'world hello' })).toBe('no');
        });

        test('endsWith checks string suffix', () => {
            const template = Handlebars.compile('{{#if (endsWith str "world")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
            expect(template({ str: 'world hello' })).toBe('no');
        });

        test('substr extracts substring', () => {
            const template = Handlebars.compile('{{{substr str 0 5}}}');
            expect(template({ str: 'hello world' })).toBe('hello');
        });

        test('replace replaces all occurrences', () => {
            const template = Handlebars.compile('{{{replace str ":" "-"}}}');
            expect(template({ str: 'ubuntu:24.04' })).toBe('ubuntu-24.04');
            expect(template({ str: 'a:b:c' })).toBe('a-b-c');
        });

        test('replaceFirst replaces first occurrence only', () => {
            const template = Handlebars.compile('{{{replaceFirst str ":" "-"}}}');
            expect(template({ str: 'a:b:c' })).toBe('a-b:c');
        });

        test('indexOf returns substring index', () => {
            const template = Handlebars.compile('{{indexOf str ":"}}');
            expect(template({ str: 'ubuntu:24.04' })).toBe('6');
            expect(template({ str: 'ubuntu' })).toBe('-1');
        });

        test('lastIndexOf returns last substring index', () => {
            const template = Handlebars.compile('{{lastIndexOf str "."}}');
            expect(template({ str: '1.2.3' })).toBe('3');
        });

        test('split splits string into array', () => {
            const template = Handlebars.compile('{{#each (split str ".")}}{{this}},{{/each}}');
            expect(template({ str: '1.2.3' })).toBe('1,2,3,');
        });

        test('trim removes whitespace', () => {
            const template = Handlebars.compile('{{{trim str}}}');
            expect(template({ str: '  hello  ' })).toBe('hello');
        });

        test('trimLeft removes leading whitespace', () => {
            const template = Handlebars.compile('{{{trimLeft str}}}');
            expect(template({ str: '  hello  ' })).toBe('hello  ');
        });

        test('trimRight removes trailing whitespace', () => {
            const template = Handlebars.compile('{{{trimRight str}}}');
            expect(template({ str: '  hello  ' })).toBe('  hello');
        });

        test('capitalize capitalizes first character', () => {
            const template = Handlebars.compile('{{{capitalize str}}}');
            expect(template({ str: 'hello world' })).toBe('Hello world');
        });

        test('titlecase capitalizes each word', () => {
            const template = Handlebars.compile('{{{titlecase str}}}');
            expect(template({ str: 'hello world' })).toBe('Hello World');
        });

        test('camelcase converts to camelCase', () => {
            const template = Handlebars.compile('{{{camelcase str}}}');
            expect(template({ str: 'hello-world' })).toBe('helloWorld');
            expect(template({ str: 'hello_world' })).toBe('helloWorld');
        });

        test('pascalcase converts to PascalCase', () => {
            const template = Handlebars.compile('{{{pascalcase str}}}');
            expect(template({ str: 'hello-world' })).toBe('HelloWorld');
        });

        test('snakecase converts to snake_case', () => {
            const template = Handlebars.compile('{{{snakecase str}}}');
            expect(template({ str: 'helloWorld' })).toBe('hello_world');
            expect(template({ str: 'hello-world' })).toBe('hello_world');
        });

        test('kebabcase converts to kebab-case', () => {
            const template = Handlebars.compile('{{{kebabcase str}}}');
            expect(template({ str: 'helloWorld' })).toBe('hello-world');
            expect(template({ str: 'hello_world' })).toBe('hello-world');
        });

        test('reverse reverses string', () => {
            const template = Handlebars.compile('{{{reverse str}}}');
            expect(template({ str: 'hello' })).toBe('olleh');
        });
    });

    describe('case-insensitive string helpers', () => {
        test('icontains checks case-insensitive substring', () => {
            const template = Handlebars.compile('{{#if (icontains str "WORLD")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
        });

        test('istartsWith checks case-insensitive prefix', () => {
            const template = Handlebars.compile('{{#if (istartsWith str "HELLO")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
        });

        test('iendsWith checks case-insensitive suffix', () => {
            const template = Handlebars.compile('{{#if (iendsWith str "WORLD")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
        });
    });

    describe('logical helpers', () => {
        test('and performs logical AND', () => {
            const template = Handlebars.compile('{{#if (and a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: true, b: true })).toBe('yes');
            expect(template({ a: true, b: false })).toBe('no');
        });

        test('or performs logical OR', () => {
            const template = Handlebars.compile('{{#if (or a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: false, b: true })).toBe('yes');
            expect(template({ a: false, b: false })).toBe('no');
        });

        test('not performs logical NOT', () => {
            const template = Handlebars.compile('{{#if (not a)}}yes{{else}}no{{/if}}');
            expect(template({ a: false })).toBe('yes');
            expect(template({ a: true })).toBe('no');
        });

        test('select returns value based on condition', () => {
            const template = Handlebars.compile('{{{select cond "yes" "no"}}}');
            expect(template({ cond: true })).toBe('yes');
            expect(template({ cond: false })).toBe('no');
        });
    });

    describe('comparison helpers', () => {
        test('eq checks equality', () => {
            const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 'x', b: 'x' })).toBe('yes');
            expect(template({ a: 'x', b: 'y' })).toBe('no');
        });

        test('ieq checks case-insensitive equality', () => {
            const template = Handlebars.compile('{{#if (ieq a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 'Hello', b: 'hello' })).toBe('yes');
        });

        test('ne checks inequality', () => {
            const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 'x', b: 'y' })).toBe('yes');
        });

        test('lt checks less than', () => {
            const template = Handlebars.compile('{{#if (lt a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 1, b: 2 })).toBe('yes');
            expect(template({ a: 2, b: 1 })).toBe('no');
        });

        test('le checks less than or equal', () => {
            const template = Handlebars.compile('{{#if (le a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 1, b: 1 })).toBe('yes');
        });

        test('gt checks greater than', () => {
            const template = Handlebars.compile('{{#if (gt a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 2, b: 1 })).toBe('yes');
        });

        test('ge checks greater than or equal', () => {
            const template = Handlebars.compile('{{#if (ge a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 1, b: 1 })).toBe('yes');
        });
    });

    describe('conversion helpers', () => {
        test('toNumber converts string to number', () => {
            const template = Handlebars.compile('{{#if (gt (toNumber str) 5)}}yes{{else}}no{{/if}}');
            expect(template({ str: '10' })).toBe('yes');
            expect(template({ str: '3' })).toBe('no');
        });

        test('toJSON converts value to JSON string', () => {
            const template = Handlebars.compile('{{{toJSON obj}}}');
            expect(template({ obj: { a: 1 } })).toBe('{"a":1}');
        });

        test('fromJSON parses JSON string', () => {
            const template = Handlebars.compile('{{#with (fromJSON str)}}{{a}}{{/with}}');
            expect(template({ str: '{"a":"hello"}' })).toBe('hello');
        });
    });

    describe('math helpers', () => {
        test('add performs addition', () => {
            const template = Handlebars.compile('{{add a b}}');
            expect(template({ a: 5, b: 3 })).toBe('8');
        });

        test('sub performs subtraction', () => {
            const template = Handlebars.compile('{{sub a b}}');
            expect(template({ a: 5, b: 3 })).toBe('2');
        });

        test('mul performs multiplication', () => {
            const template = Handlebars.compile('{{mul a b}}');
            expect(template({ a: 5, b: 3 })).toBe('15');
        });

        test('div performs division', () => {
            const template = Handlebars.compile('{{div a b}}');
            expect(template({ a: 6, b: 2 })).toBe('3');
        });

        test('mod performs modulo', () => {
            const template = Handlebars.compile('{{mod a b}}');
            expect(template({ a: 7, b: 3 })).toBe('1');
        });

        test('abs returns absolute value', () => {
            const template = Handlebars.compile('{{abs n}}');
            expect(template({ n: -5 })).toBe('5');
        });

        test('floor rounds down', () => {
            const template = Handlebars.compile('{{floor n}}');
            expect(template({ n: 3.7 })).toBe('3');
        });

        test('ceil rounds up', () => {
            const template = Handlebars.compile('{{ceil n}}');
            expect(template({ n: 3.2 })).toBe('4');
        });

        test('round rounds to nearest integer', () => {
            const template = Handlebars.compile('{{round n}}');
            expect(template({ n: 3.5 })).toBe('4');
            expect(template({ n: 3.4 })).toBe('3');
        });

        test('min returns minimum value', () => {
            const template = Handlebars.compile('{{min a b c}}');
            expect(template({ a: 5, b: 2, c: 8 })).toBe('2');
        });

        test('max returns maximum value', () => {
            const template = Handlebars.compile('{{max a b c}}');
            expect(template({ a: 5, b: 2, c: 8 })).toBe('8');
        });

        test('pow computes power', () => {
            const template = Handlebars.compile('{{pow base exp}}');
            expect(template({ base: 2, exp: 3 })).toBe('8');
        });
    });

    describe('array helpers', () => {
        test('join joins array elements', () => {
            const template = Handlebars.compile('{{{join arr "-"}}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('a-b-c');
        });

        test('first returns first element', () => {
            const template = Handlebars.compile('{{first arr}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('a');
        });

        test('last returns last element', () => {
            const template = Handlebars.compile('{{last arr}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('c');
        });

        test('nth returns nth element', () => {
            const template = Handlebars.compile('{{nth arr 1}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('b');
        });

        test('length returns array length', () => {
            const template = Handlebars.compile('{{length arr}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('3');
        });

        test('length returns string length', () => {
            const template = Handlebars.compile('{{length str}}');
            expect(template({ str: 'hello' })).toBe('5');
        });

        test('slice extracts portion of array', () => {
            const template = Handlebars.compile('{{#each (slice arr 1 3)}}{{this}},{{/each}}');
            expect(template({ arr: ['a', 'b', 'c', 'd'] })).toBe('b,c,');
        });

        test('sort sorts array', () => {
            const template = Handlebars.compile('{{#each (sort arr)}}{{this}},{{/each}}');
            expect(template({ arr: ['c', 'a', 'b'] })).toBe('a,b,c,');
        });

        test('includes checks array membership', () => {
            const template = Handlebars.compile('{{#if (includes arr "b")}}yes{{else}}no{{/if}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('yes');
            expect(template({ arr: ['a', 'c'] })).toBe('no');
        });

        test('reverse reverses array', () => {
            const template = Handlebars.compile('{{#each (reverse arr)}}{{this}},{{/each}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('c,b,a,');
        });
    });

    describe('type checking helpers', () => {
        test('isString checks for string type', () => {
            const template = Handlebars.compile('{{#if (isString val)}}yes{{else}}no{{/if}}');
            expect(template({ val: 'hello' })).toBe('yes');
            expect(template({ val: 123 })).toBe('no');
        });

        test('isNumber checks for number type', () => {
            const template = Handlebars.compile('{{#if (isNumber val)}}yes{{else}}no{{/if}}');
            expect(template({ val: 123 })).toBe('yes');
            expect(template({ val: 'hello' })).toBe('no');
        });

        test('isArray checks for array type', () => {
            const template = Handlebars.compile('{{#if (isArray val)}}yes{{else}}no{{/if}}');
            expect(template({ val: [1, 2, 3] })).toBe('yes');
            expect(template({ val: 'hello' })).toBe('no');
        });

        test('isEmpty checks for empty values', () => {
            const template = Handlebars.compile('{{#if (isEmpty val)}}yes{{else}}no{{/if}}');
            expect(template({ val: '' })).toBe('yes');
            expect(template({ val: [] })).toBe('yes');
            expect(template({ val: 'hello' })).toBe('no');
            expect(template({ val: [1] })).toBe('no');
        });
    });

    describe('utility helpers', () => {
        test('default provides fallback for falsy values', () => {
            const template = Handlebars.compile('{{{default val "fallback"}}}');
            expect(template({ val: '' })).toBe('fallback');
            expect(template({ val: 'value' })).toBe('value');
        });

        test('coalesce returns first non-null value', () => {
            const template = Handlebars.compile('{{{coalesce a b c}}}');
            expect(template({ a: null, b: undefined, c: 'value' })).toBe('value');
            expect(template({ a: 'first', b: 'second', c: 'third' })).toBe('first');
        });

        test('format substitutes placeholders', () => {
            const template = Handlebars.compile('{{{format "Hello {0} {1}" first last}}}');
            expect(template({ first: 'John', last: 'Doe' })).toBe('Hello John Doe');
        });
    });

    describe('combined usage', () => {
        test('replace container colon for cache key', () => {
            const template = Handlebars.compile('cache-{{{replace container ":" "-"}}}');
            expect(template({ container: 'ubuntu:24.04' })).toBe('cache-ubuntu-24.04');
        });

        test('extract major version with split and first', () => {
            const template = Handlebars.compile('{{first (split version ".")}}');
            expect(template({ version: '14.0.3' })).toBe('14');
        });

        test('dynamic substring with indexOf', () => {
            const template = Handlebars.compile('{{{substr str 0 (indexOf str ":")}}}');
            expect(template({ str: 'ubuntu:24.04' })).toBe('ubuntu');
        });

        test('conditional with math comparison', () => {
            const template = Handlebars.compile('{{#if (ge (toNumber major) 14)}}new{{else}}old{{/if}}');
            expect(template({ major: '14' })).toBe('new');
            expect(template({ major: '12' })).toBe('old');
        });
    });
});
