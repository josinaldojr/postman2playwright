export type VariableReference = {
    name: string;
    usedIn: string; // url | header | body | script
  };
  
  const variableRegex = /\{\{(\w+)\}\}/g;
  const envGetterRegex = /pm\.environment\.get\(['"`](\w+)['"`]\)/g;
  
  export function extractVariablesFromString(input: string, usedIn: string): VariableReference[] {
    const matches = [...input.matchAll(variableRegex)];
    return matches.map(match => ({ name: match[1], usedIn }));
  }
  
  export function extractEnvGetterVariables(script: string): VariableReference[] {
    const matches = [...script.matchAll(envGetterRegex)];
    return matches.map(match => ({ name: match[1], usedIn: 'script' }));
  }
  
  export function replaceVariablesWithEnv(input: string): string {
    return input.replace(variableRegex, (_, name) => `\${process.env.${name.toUpperCase()}}`);
  }
  