#!/usr/bin/env ts-node

import { Command } from 'commander';
import { generateTestsFromCollection } from '../src/generator';

const program = new Command();

program
  .name('postman2playwright')
  .description('Converte uma Postman Collection em testes Playwright')
  .version('1.0.0')
  .requiredOption('-i, --input <path>', 'Caminho da collection do Postman (.json)')
  .option('-o, --output <folder>', 'Pasta de saída', 'tests/generated')
  .action(async (options) => {
    await generateTestsFromCollection(options.input, options.output);
  });

program.parse();
