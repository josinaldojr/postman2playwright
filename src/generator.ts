import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from './utils';

export async function generateTestsFromCollection(inputPath: string, outputDir: string) {
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const collection = JSON.parse(raw);

  if (!collection.item || !Array.isArray(collection.item)) {
    console.error('Collection inválida.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  for (const item of collection.item) {
    const name = sanitizeFilename(item.name || 'unnamed');
    const request = item.request;

    if (!request?.url?.raw || !request.method) continue;

    const url = request.url.raw;
    const method = request.method.toLowerCase();
    const headers = Object.fromEntries(
      (request.header || []).map((h: any) => [h.key, h.value])
    );
    const body = request.body?.raw;

    const testScript = item.event?.find((e: any) => e.listen === 'test')?.script?.exec?.join('\n');

    const content = generatePlaywrightTest(name, method, url, headers, body, testScript);

    const filename = path.join(outputDir, `${name}.spec.ts`);
    fs.writeFileSync(filename, content, 'utf-8');
    console.log(`✔️  Teste gerado: ${filename}`);
  }
}

function generatePlaywrightTest(
  name: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  postmanTestScript: string | undefined
): string {
  const mappedTests = mapPostmanTestsToPlaywright(postmanTestScript || '');

  return `import { test, expect, request } from '@playwright/test';

  test('${name}', async ({ request }) => {
    const response = await request.${method}('${url}', {
      headers: ${JSON.stringify(headers, null, 2)},
      ${body ? `data: ${body},` : ''}
    });

    expect(response.ok()).toBeTruthy();

    ${mappedTests}
  });
  `;
}

function mapPostmanTestsToPlaywright(script: string): string {
  const lines = script.split('\n');
  const mapped: string[] = [];
  const declarations: string[] = [];
  let usesBody = false;

  for (let line of lines) {
    const trimmed = line.trim();

    // Variável que armazena a resposta
    if (/var (json|jsonData) ?= ?pm\.response\.json\(\)/.test(trimmed)) {
      usesBody = true;
      continue; // body será declarado automaticamente depois
    }

    // pm.expect(json).to.be.an('array')
    if (/pm\.expect\((.+?)\)\.to\.be\.an\(['"](.+?)['"]\)/.test(trimmed)) {
      const [, variable, type] = trimmed.match(/pm\.expect\((.+?)\)\.to\.be\.an\(['"](.+?)['"]\)/)!;
      const varName = variable.replace(/json(Data)?/, 'body');
      if (type === 'array') {
        mapped.push(`expect(Array.isArray(${varName})).toBe(true);`);
      } else {
        mapped.push(`expect(typeof ${varName}).toBe("${type}");`);
      }
      continue;
    }

    // pm.expect(...).to.exist
    if (/pm\.expect\((.+?)\)\.to\.exist/.test(trimmed)) {
      const match = trimmed.match(/pm\.expect\((.+?)\)\.to\.exist/);
      const path = match?.[1].replace(/json(Data)?/, 'body');
      mapped.push(`expect(${path}).toBeDefined();`);
      continue;
    }

    // pm.expect(...).to.eql(...)
    if (/pm\.expect\((.+?)\)\.to\.eql\((.+?)\)/.test(trimmed)) {
      const [, left, right] = trimmed.match(/pm\.expect\((.+?)\)\.to\.eql\((.+?)\)/)!;
      mapped.push(`expect(${left.replace(/json(Data)?/, 'body')}).toBe(${right});`);
      continue;
    }

    // pm.expect(...).length.to.be.above(...)
    if (/pm\.expect\((.+?)\.length\)\.to\.be\.above\((\d+)\)/.test(trimmed)) {
      const [, variable, value] = trimmed.match(/pm\.expect\((.+?)\.length\)\.to\.be\.above\((\d+)\)/)!;
      mapped.push(`expect(${variable.replace(/json(Data)?/, 'body')}.length).toBeGreaterThan(${value});`);
      continue;
    }

    // status includes
    if (/pm\.expect\(\[.*\]\)\.to\.include\(pm\.response\.code\)/.test(trimmed)) {
      const list = trimmed.match(/\[(.*)\]/)?.[1];
      mapped.push(`expect([${list}]).toContain(response.status());`);
      continue;
    }

    // pm.response.to.have.status
    if (/pm\.response\.to\.have\.status\((\d+)\)/.test(trimmed)) {
      const status = trimmed.match(/\((\d+)\)/)?.[1];
      mapped.push(`expect(response.status()).toBe(${status});`);
      continue;
    }

    // Fallback: qualquer linha não reconhecida
    if (trimmed && !trimmed.startsWith('//')) {
      declarations.push('// ⚠️ Linha não convertida automaticamente: ' + trimmed);
    }
  }

  const prefix = usesBody ? 'const body = await response.json();' : '';
  return [prefix, ...declarations, ...mapped]
    .filter(Boolean)
    .map(line => '  ' + line)
    .join('\n');
}

