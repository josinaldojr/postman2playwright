# 🧪 Postman2Playwright

Transforme coleções do Postman em testes automatizados com [Playwright](https://playwright.dev)!

> Um CLI em Node.js + TypeScript que converte uma Postman Collection em testes `.spec.ts`, com suporte a validações, variáveis e pré-requisitos.

---

## 🚀 Como usar

### 1. Instale as dependências

```bash
npm install
```

2. Rode o conversor

```bash
npx ts-node bin/cli.ts -i postman-sample.json -o tests/generated
```

Ou após compilar:

```bash
npm run build
npx postman2playwright -i postman-sample.json
```

🧠 Funcionalidades

✅ Conversão de requests para testes Playwright

✅ Conversão automática de pm.test, pm.expect

✅ Geração de arquivos .spec.ts organizados

🚧 Suporte a variáveis ({{token}}, pm.environment.get) → .env.example

🚧 Agrupamento com describe(...) por pasta

🚧 Suporte a test.each

🚧 Execução automatizada (--run)

🧪 Exemplo de uso
Input Postman:

```json
{
  "name": "Login",
  "request": {
    "method": "POST",
    "url": { "raw": "https://api.meusite.com/login" },
    "body": {
      "mode": "raw",
      "raw": "{\"username\": \"admin\", \"password\": \"123456\"}"
    }
  },
  "event": [
    {
      "listen": "test",
      "script": {
        "exec": [
          "pm.test(\"Status 200\", function () {",
          "  pm.response.to.have.status(200);",
          "});"
        ]
      }
    }
  ]
}

```
Teste gerado:

```js
test('Login', async ({ request }) => {
  const response = await request.post('https://api.meusite.com/login', {
    data: { username: 'admin', password: '123456' }
  });

  expect(response.status()).toBe(200);
});

```
📂 Estrutura de Pastas

bin/cli.ts – entrada principal do CLI

src/ – conversor, parser e helpers

tests/generated – saída dos testes Playwright

postman-sample.json – exemplo de collection