export function extractEnvironmentSetters(script: string): Record<string, string> {
    const regex = /pm\.environment\.set\(['"`](.+?)['"`], ['"`](.+?)['"`]\)/g;
    const vars: Record<string, string> = {};
  
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [, key, value] = match;
      vars[key.toUpperCase()] = value;
    }
  
    return vars;
  }
  