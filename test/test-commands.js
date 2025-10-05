#!/usr/bin/env node

/**
 * Command Validation Tests
 * Tests that all commands can be invoked without errors (dry-run style)
 */

const chalk = require('chalk');
const { execSync } = require('child_process');

console.log(chalk.bold.cyan('\n=== Command Validation Tests ===\n'));

const tests = [
  {
    name: 'Version flag',
    command: 'node src/index.js --version',
    shouldSucceed: true
  },
  {
    name: 'Help flag',
    command: 'node src/index.js --help',
    shouldSucceed: true
  },
  {
    name: 'Init help',
    command: 'node src/index.js init --help',
    shouldSucceed: true
  },
  {
    name: 'Deploy help',
    command: 'node src/index.js deploy --help',
    shouldSucceed: true
  },
  {
    name: 'Info help',
    command: 'node src/index.js info --help',
    shouldSucceed: true
  },
  {
    name: 'List-secrets help',
    command: 'node src/index.js list-secrets --help',
    shouldSucceed: true
  },
  {
    name: 'Migrate-domain help',
    command: 'node src/index.js migrate-domain --help',
    shouldSucceed: true
  },
  {
    name: 'Remove help',
    command: 'node src/index.js remove --help',
    shouldSucceed: true
  }
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  process.stdout.write(chalk.gray(`Testing: ${test.name}... `));

  try {
    execSync(test.command, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: require('path').join(__dirname, '..')
    });

    if (test.shouldSucceed) {
      console.log(chalk.green('✓ PASS'));
      passed++;
    } else {
      console.log(chalk.red('✗ FAIL (expected to fail)'));
      failed++;
    }
  } catch (error) {
    if (!test.shouldSucceed) {
      console.log(chalk.green('✓ PASS (correctly failed)'));
      passed++;
    } else {
      console.log(chalk.red('✗ FAIL'));
      console.log(chalk.red(`  Error: ${error.message}`));
      failed++;
    }
  }
});

console.log(chalk.bold(`\n=== Results ===`));
console.log(chalk.green(`Passed: ${passed}`));
console.log(failed > 0 ? chalk.red(`Failed: ${failed}`) : chalk.gray(`Failed: ${failed}`));

if (failed > 0) {
  process.exit(1);
}

console.log(chalk.bold.green('\n✓ All command validation tests passed!\n'));
