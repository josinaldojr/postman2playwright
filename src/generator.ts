import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from './utils';
import { extractEnvGetterVariables, extractVariablesFromString, replaceVariablesWithEnv } from './parser/variablesParser';
import { extractEnvironmentSetters } from './parser/preRequestParser';

type TestGroup = {
  method: string;
  url: string;
  headers: Record<string, string>;
  tests: {
    name: string;
    body: string;
    parsedBody: Record<string, any>;
  }[];
};

function groupByTestData(items: any[]): TestGroup[] {
  const groups: Record<string, TestGroup> = {};

  for (const item of items) {
    const req = item.request;
    if (!req || !req.body?.raw) continue;

    const method = req.method.toUpperCase();
    const url = req.url.raw;
    const headers = Object.fromEntries((req.header || []).map((h: any) => [h.key, h.value]));
    const body = req.body.raw;

    const key = `${method}_${url}_${JSON.stringify(headers)}`;

    if (!groups[key]) {
      groups[key] = { method, url, headers, tests: [] };
    }

    try {
      groups[key].tests.push({
        name: item.name,
        body,
        parsedBody: JSON.parse(body)
      });
    } catch {
      console.warn(`⚠️ JSON inválido em "${item.name}"`);
    }
  }

  return Object.values(groups).filter(g => g.tests.length > 1); // só se tiver mais de um teste
}

function generateTestEachBlock(group: TestGroup): string {
  const rows = group.tests.map(t => JSON.stringify(t.parsedBody)).join(',\n  ');
  const method = group.method.toLowerCase();
  const url = replaceVariablesWithEnv(group.url);
  const headers = JSON.stringify(group.headers, null, 2);

  return `
test.each([
  ${rows}
])("Request com %o", async (data) => {
  const response = await request.${method}(\`${url}\`, {
    headers: ${headers},
    data
  });

  expect(response.ok()).toBeTruthy();
});
`.trim();
}



export async function generateTestsFromCollection(inputPath: string, outputDir: string) {
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const collection = JSON.parse(raw);

  if (!collection.item || !Array.isArray(collection.item)) {
    console.error('Collection inválida.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const allVariables: Set<string> = new Set();

  for (const item of collection.item) {
    if (item.item && Array.isArray(item.item)) {
      await processFolder(item.name, item.item, outputDir, allVariables);
    } else {
      await processSingleItem(item, outputDir, allVariables);
    }
  }

  if (allVariables.size > 0) {
    const exampleEnv = [...allVariables].map(v => `${v.toUpperCase()}=`).join('\n');
    const envPath = path.join(outputDir, '..', '.env.example');
    fs.writeFileSync(envPath, exampleEnv, 'utf-8');
    console.log(`📄 .env.example gerado com variáveis: ${[...allVariables].join(', ')}`);
  }
}

async function processFolder(folderName: string, items: any[], outputDir: string, allVars: Set<string>) {
  const folderSafe = sanitizeFilename(folderName);
  const lines: string[] = [
    `import { test, expect, request } from '@playwright/test';`,
    ``,
    `describe('${folderName}', () => {`
  ];

  const grouped = groupByTestData(items);
  const groupedItems = new Set<string>();

  for (const group of grouped) {
    const eachBlock = generateTestEachBlock(group);
    lines.push(eachBlock);
    group.tests.forEach(t => groupedItems.add(t.name));
  }

  for (const item of items) {
    if (groupedItems.has(item.name)) continue; // já incluído no test.each
    const testCode = generateTestBlock(item, allVars);
    lines.push(testCode);
  }

  lines.push(`});`);

  const content = lines.join('\n\n');
  const filename = path.join(outputDir, `${folderSafe}.spec.ts`);
  fs.writeFileSync(filename, content, 'utf-8');
  console.log(`📁 Arquivo de pasta gerado: ${filename}`);
}

async function processSingleItem(item: any, outputDir: string, allVars: Set<string>) {
  const name = sanitizeFilename(item.name || 'unnamed');
  const testCode = `import { test, expect, request } from '@playwright/test';\n\n` +
    generateTestBlock(item, allVars);

  const filename = path.join(outputDir, `${name}.spec.ts`);
  fs.writeFileSync(filename, testCode, 'utf-8');
  console.log(`✔️  Teste gerado: ${filename}`);
}

function generateTestBlock(item: any, allVars: Set<string>): string {
  const name = sanitizeFilename(item.name || 'unnamed');
  const request = item.request;
  const testName = item.name || 'Unnamed Test';

  if (!request?.url?.raw || !request.method) return '';

  const method = request.method.toLowerCase();
  const url = collectVariables(request.url.raw, 'url', allVars);
  const headers = Object.fromEntries(
    (request.header || []).map((h: any) => [h.key, collectVariables(h.value, 'header', allVars)])
  );
  const bodyRaw = collectVariables(request.body?.raw, 'body', allVars);

  // Extrair pre-request script
  const preScriptRaw = item.event?.find((e: any) => e.listen === 'prerequest')?.script?.exec?.join('\n') ?? '';
  const envSetters = extractEnvironmentSetters(preScriptRaw);

  // Extrair testes
  const testScriptRaw = item.event?.find((e: any) => e.listen === 'test')?.script?.exec?.join('\n') ?? '';
  collectEnvVarsFromScript(testScriptRaw, allVars);

  const mappedTests = mapPostmanTestsToPlaywright(testScriptRaw || '');

  const tokenVars = Object.entries(envSetters)
    .map(([key, val]) => `const ${key} = "${val}";`)
    .join('\n');

  return `${tokenVars ? '  ' + tokenVars.split('\n').join('\n  ') + '\n' : ''}
  test('${testName}', async ({ request }) => {
    const response = await request.${method}(\`${url}\`, {
      headers: ${JSON.stringify(headers, null, 2)},
      ${bodyRaw ? `data: ${bodyRaw},` : ''}
    });

    expect(response.ok()).toBeTruthy();

    ${mappedTests.split('\n').map(line => '    ' + line).join('\n')}
  });`;
}

function collectVariables(input: string | undefined, context: string, allVars: Set<string>): string {
  if (!input) return '';

  const vars = extractVariablesFromString(input, context);
  vars.forEach(v => allVars.add(v.name));
  return replaceVariablesWithEnv(input);
}

function collectEnvVarsFromScript(script: string, allVars: Set<string>) {
  const vars = extractEnvGetterVariables(script);
  vars.forEach(v => allVars.add(v.name));
}

function mapPostmanTestsToPlaywright(script: string): string {
  const lines = script.split('\n');
  const mapped: string[] = [];
  const inlineProps: Record<string, any> = {};
  let usesBody = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Status
    if (/pm\.response\.to\.have\.status\((\d+)\)/.test(trimmed)) {
      const status = trimmed.match(/\((\d+)\)/)?.[1];
      mapped.push(`expect(response.status()).toBe(${status});`);
      continue;
    }

    // .to.have.property("key", value)
    if (/pm\.expect\((.+?)\)\.to\.have\.property\(['"`](.+?)['"`], (.+?)\)/.test(trimmed)) {
      const [, obj, key, value] = trimmed.match(/pm\.expect\((.+?)\)\.to\.have\.property\(['"`](.+?)['"`], (.+?)\)/)!;
      if (/json(Data)?/.test(obj)) {
        inlineProps[key] = value;
        usesBody = true;
      } else {
        mapped.push(`expect(${obj}).toMatchObject({ ${key}: ${value} });`);
      }
      continue;
    }

    // .to.have.property("key") - sem valor
    if (/pm\.expect\((.+?)\)\.to\.have\.property\(['"`](.+?)['"`]\)/.test(trimmed)) {
      const [, obj, key] = trimmed.match(/pm\.expect\((.+?)\)\.to\.have\.property\(['"`](.+?)['"`]\)/)!;
      mapped.push(`expect(${obj.replace(/json(Data)?/, 'body')}).toHaveProperty("${key}");`);
      usesBody = true;
      continue;
    }

    // .to.exist
    if (/pm\.expect\((.+?)\)\.to\.exist/.test(trimmed)) {
      const [, expr] = trimmed.match(/pm\.expect\((.+?)\)\.to\.exist/) || [];
      mapped.push(`expect(${expr.replace(/json(Data)?/, 'body')}).toBeDefined();`);
      usesBody = true;
      continue;
    }

    // .to.not.eql
    if (/pm\.expect\((.+?)\)\.to\.not\.eql\((.+?)\)/.test(trimmed)) {
      const [, left, right] = trimmed.match(/pm\.expect\((.+?)\)\.to\.not\.eql\((.+?)\)/)!;
      mapped.push(`expect(${left.replace(/json(Data)?/, 'body')}).not.toBe(${right});`);
      usesBody = true;
      continue;
    }

    // .to.eql
    if (/pm\.expect\((.+?)\)\.to\.eql\((.+?)\)/.test(trimmed)) {
      const [, left, right] = trimmed.match(/pm\.expect\((.+?)\)\.to\.eql\((.+?)\)/)!;
      mapped.push(`expect(${left.replace(/json(Data)?/, 'body')}).toBe(${right});`);
      usesBody = true;
      continue;
    }

    // .to.be.null
    if (/pm\.expect\((.+?)\)\.to\.be\.null/.test(trimmed)) {
      const [, expr] = trimmed.match(/pm\.expect\((.+?)\)\.to\.be\.null/) || [];
      mapped.push(`expect(${expr.replace(/json(Data)?/, 'body')}).toBeNull();`);
      usesBody = true;
      continue;
    }

    // .to.be.an('array')
    if (/pm\.expect\((.+?)\)\.to\.be\.an\(['"](.+)['"]\)/.test(trimmed)) {
      const [, variable, type] = trimmed.match(/pm\.expect\((.+?)\)\.to\.be\.an\(['"](.+)['"]\)/) || [];
      const varName = variable.replace(/json(Data)?/, 'body');
      if (type === 'array') {
        mapped.push(`expect(Array.isArray(${varName})).toBe(true);`);
      } else {
        mapped.push(`expect(typeof ${varName}).toBe("${type}");`);
      }
      usesBody = true;
      continue;
    }

    // .length.to.be.above(n)
    if (/pm\.expect\((.+?)\.length\)\.to\.be\.above\((\d+)\)/.test(trimmed)) {
      const [, variable, value] = trimmed.match(/pm\.expect\((.+?)\.length\)\.to\.be\.above\((\d+)\)/) || [];
      mapped.push(`expect(${variable.replace(/json(Data)?/, 'body')}.length).toBeGreaterThan(${value});`);
      usesBody = true;
      continue;
    }

    // .to.include(pm.response.code)
    if (/pm\.expect\(\[.*\]\)\.to\.include\(pm\.response\.code\)/.test(trimmed)) {
      const list = trimmed.match(/\[(.*)\]/)?.[1];
      mapped.push(`expect([${list}]).toContain(response.status());`);
      continue;
    }

    // fallback
    if (trimmed && !trimmed.startsWith('//')) {
      mapped.push(`// ⚠️ Não convertido: ${trimmed}`);
    }
  }

  // Agrupar .to.have.property(key, value)
  if (Object.keys(inlineProps).length > 0) {
    const obj = Object.entries(inlineProps)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    mapped.push(`expect(body).toMatchObject({ ${obj} });`);
  }

  if (usesBody) {
    mapped.unshift(`const body = await response.json();`);
  }

  return mapped.map(line => '  ' + line).join('\n');
}

