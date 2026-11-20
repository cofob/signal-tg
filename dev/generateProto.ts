/**
 * Generates TypeScript codecs from the Signal `.proto` files in `src/lib/signal/proto/schema`
 * into `src/lib/signal/proto/generated`, one module per schema file.
 *
 * Supports the subset Signal uses: proto2 and proto3 messages and enums, nested types, `oneof`,
 * `optional`/`required`/`repeated` labels, `packed`, imports between schema files, `reserved` and `option`.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SCHEMA_DIR = 'src/lib/signal/proto/schema';
const OUTPUT_DIR = 'src/lib/signal/proto/generated';

const SCALAR_KINDS: Record<string, { kind: string; tsType: string; isPackable: boolean }> = {
  double: { kind: 'Double', tsType: 'number', isPackable: true },
  float: { kind: 'Float', tsType: 'number', isPackable: true },
  int32: { kind: 'Int32', tsType: 'number', isPackable: true },
  int64: { kind: 'Int64', tsType: 'bigint', isPackable: true },
  uint32: { kind: 'Uint32', tsType: 'number', isPackable: true },
  uint64: { kind: 'Uint64', tsType: 'bigint', isPackable: true },
  sint32: { kind: 'Sint32', tsType: 'number', isPackable: true },
  sint64: { kind: 'Sint64', tsType: 'bigint', isPackable: true },
  fixed32: { kind: 'Fixed32', tsType: 'number', isPackable: true },
  fixed64: { kind: 'Fixed64', tsType: 'bigint', isPackable: true },
  sfixed32: { kind: 'Sfixed32', tsType: 'number', isPackable: true },
  sfixed64: { kind: 'Sfixed64', tsType: 'bigint', isPackable: true },
  bool: { kind: 'Bool', tsType: 'boolean', isPackable: true },
  string: { kind: 'String', tsType: 'string', isPackable: false },
  bytes: { kind: 'Bytes', tsType: 'Uint8Array', isPackable: false },
};

type Field = {
  name: string;
  number: number;
  label?: 'optional' | 'required' | 'repeated';
  type: string;
  options: Record<string, string>;
  isOneofMember: boolean;
};

type EnumType = { kind: 'enum'; fullName: string; values: [string, number][] };
type MessageType = { kind: 'message'; fullName: string; fields: Field[] };
type SchemaType = EnumType | MessageType;

type Schema = {
  fileName: string;
  syntax: 'proto2' | 'proto3';
  packageName: string;
  imports: string[];
  types: SchemaType[];
};

main();

function main() {
  const schemas = readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith('.proto'))
    .sort()
    .map((file) => parseSchema(file, readFileSync(join(SCHEMA_DIR, file), 'utf8')));

  const typesByFullName = new Map<string, { type: SchemaType; schema: Schema }>();
  for (const schema of schemas) {
    for (const type of schema.types) typesByFullName.set(type.fullName, { type, schema });
  }

  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const schema of schemas) {
    const moduleName = basename(schema.fileName, '.proto');
    writeFileSync(join(OUTPUT_DIR, `${moduleName}.ts`), generateModule(schema, typesByFullName));
  }
}

function tokenize(source: string) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  return withoutComments.match(/"(?:[^"\\]|\\.)*"|[A-Za-z_.][\w.]*|-?\d+|[{}[\]=;<>,()]/g) ?? [];
}

function parseSchema(fileName: string, source: string): Schema {
  const tokens = tokenize(source);
  let pos = 0;
  const schema: Schema = { fileName, syntax: 'proto2', packageName: '', imports: [], types: [] };

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (token: string) => {
    const actual = next();
    if (actual !== token) throw new Error(`${fileName}: expected "${token}", got "${actual}"`);
  };
  const skipStatement = () => {
    let depth = 0;
    while (pos < tokens.length) {
      const token = next();
      if (token === '{') depth++;
      if (token === '}') depth--;
      if ((token === ';' && depth === 0) || (token === '}' && depth === 0)) return;
    }
  };
  const unquote = (token: string) => token.slice(1, -1);

  function parseOptions(): Record<string, string> {
    const options: Record<string, string> = {};
    if (peek() !== '[') return options;
    next();
    while (peek() !== ']') {
      const name = next();
      expect('=');
      options[name] = next();
      if (peek() === ',') next();
    }
    expect(']');
    return options;
  }

  function parseEnum(scope: string) {
    const fullName = `${scope}.${next()}`;
    const values: [string, number][] = [];
    expect('{');
    while (peek() !== '}') {
      if (peek() === 'option' || peek() === 'reserved') {
        skipStatement();
        continue;
      }
      const name = next();
      expect('=');
      const value = Number(next());
      parseOptions();
      expect(';');
      values.push([name, value]);
    }
    expect('}');
    schema.types.push({ kind: 'enum', fullName, values });
  }

  function parseField(fields: Field[], isOneofMember: boolean) {
    let label: Field['label'];
    if (peek() === 'optional' || peek() === 'required' || peek() === 'repeated') {
      label = next() as Field['label'];
    }
    const type = next();
    const name = next();
    expect('=');
    const number = Number(next());
    const options = parseOptions();
    expect(';');
    fields.push({ name, number, label, type, options, isOneofMember });
  }

  function parseMessage(scope: string) {
    const fullName = `${scope}.${next()}`;
    const message: MessageType = { kind: 'message', fullName, fields: [] };
    schema.types.push(message);
    expect('{');
    while (peek() !== '}') {
      const token = peek();
      if (token === 'message') {
        next();
        parseMessage(fullName);
      } else if (token === 'enum') {
        next();
        parseEnum(fullName);
      } else if (token === 'oneof') {
        next();
        next();
        expect('{');
        while (peek() !== '}') {
          if (peek() === 'option') {
            skipStatement();
            continue;
          }
          parseField(message.fields, true);
        }
        expect('}');
      } else if (token === 'reserved' || token === 'option' || token === 'extensions') {
        skipStatement();
      } else if (token === ';') {
        next();
      } else {
        parseField(message.fields, false);
      }
    }
    expect('}');
  }

  while (pos < tokens.length) {
    const token = next();
    if (token === 'syntax') {
      expect('=');
      schema.syntax = unquote(next()) as Schema['syntax'];
      expect(';');
    } else if (token === 'package') {
      schema.packageName = next();
      expect(';');
    } else if (token === 'import') {
      schema.imports.push(unquote(next()));
      expect(';');
    } else if (token === 'option') {
      skipStatement();
    } else if (token === 'message') {
      parseMessage(schema.packageName);
    } else if (token === 'enum') {
      parseEnum(schema.packageName);
    } else if (token !== ';') {
      throw new Error(`${fileName}: unexpected "${token}"`);
    }
  }

  return schema;
}

function getTsName(fullName: string, packageName: string) {
  return fullName.slice(packageName.length + 1).replace(/\./g, '_');
}

function resolveType(
  reference: string,
  scope: string,
  typesByFullName: Map<string, { type: SchemaType; schema: Schema }>,
) {
  if (reference.startsWith('.')) {
    const found = typesByFullName.get(reference.slice(1));
    if (found) return found;
  }
  const parts = scope.split('.');
  for (let i = parts.length; i >= 0; i--) {
    const candidate = [...parts.slice(0, i), reference].filter(Boolean).join('.');
    const found = typesByFullName.get(candidate);
    if (found) return found;
  }
  throw new Error(`Unknown type "${reference}" in ${scope}`);
}

function generateModule(schema: Schema, typesByFullName: Map<string, { type: SchemaType; schema: Schema }>) {
  const importsByModule = new Map<string, Set<string>>();
  const runtimeImports = new Set(['defineMessage', 'FieldKind']);
  const body: string[] = [];

  for (const type of schema.types) {
    const tsName = getTsName(type.fullName, schema.packageName);

    if (type.kind === 'enum') {
      body.push(`export enum ${tsName} {`);
      for (const [name, value] of type.values) body.push(`  ${name} = ${value},`);
      body.push('}', '');
      continue;
    }

    const typeLines: string[] = [];
    const descriptorLines: string[] = [];
    for (const field of type.fields) {
      const scalar = SCALAR_KINDS[field.type];
      let tsType: string;
      let kind: string;
      let messageRef: string | undefined;

      if (scalar) {
        tsType = scalar.tsType;
        kind = scalar.kind;
      } else {
        const resolved = resolveType(field.type, type.fullName, typesByFullName);
        const refName = getTsName(resolved.type.fullName, resolved.schema.packageName);
        if (resolved.schema !== schema) {
          const moduleName = `./${basename(resolved.schema.fileName, '.proto')}`;
          if (!importsByModule.has(moduleName)) importsByModule.set(moduleName, new Set());
          importsByModule.get(moduleName)!.add(refName);
        }
        tsType = refName;
        kind = resolved.type.kind === 'enum' ? 'Enum' : 'Message';
        if (kind === 'Message') messageRef = refName;
      }

      const isRepeated = field.label === 'repeated';
      const flags: string[] = [];
      if (isRepeated) {
        flags.push('FIELD_REPEATED');
        const isPackable = scalar ? scalar.isPackable : kind === 'Enum';
        const isPacked = field.options.packed !== undefined
          ? field.options.packed === 'true'
          : schema.syntax === 'proto3';
        if (isPackable && isPacked) flags.push('FIELD_PACKED');
      } else if (schema.syntax === 'proto3' && !field.label && !field.isOneofMember && kind !== 'Message') {
        flags.push('FIELD_IMPLICIT');
      }

      flags.forEach((flag) => runtimeImports.add(flag));
      typeLines.push(`  ${field.name}?: ${tsType}${isRepeated ? '[]' : ''};`);
      const descriptor = [String(field.number), `'${field.name}'`, `FieldKind.${kind}`];
      if (flags.length || messageRef) descriptor.push(flags.length ? flags.join(' | ') : '0');
      if (messageRef) descriptor.push(`() => ${messageRef}`);
      descriptorLines.push(`  [${descriptor.join(', ')}],`);
    }

    body.push(`export type ${tsName} = {`, ...typeLines, '  $unknownFields?: Uint8Array[];', '};');
    body.push(
      `export const ${tsName}: MessageCodec<${tsName}> = defineMessage<${tsName}>(() => [`,
      ...descriptorLines,
      ']);',
      '',
    );
  }

  const header = [
    `// Generated by \`npm run signal:proto\` from ${schema.fileName}. Do not edit.`,
    '/* eslint-disable */',
    '',
    `import type { MessageCodec } from '../runtime';`,
    '',
    `import { ${[...runtimeImports].sort().join(', ')} } from '../runtime';`,
  ];
  for (const [moduleName, names] of importsByModule) {
    header.push(`import { ${[...names].sort().join(', ')} } from '${moduleName}';`);
  }
  header.push('');

  return [...header, ...body].join('\n');
}
