#!/usr/bin/env node

/**
 * Manual Test Suite for meteor-cloud-run
 *
 * This file contains manual test instructions and validation scripts.
 * Run with: npm test
 */

const chalk = require('chalk');
const { execSync } = require('child_process');
const path = require('path');

console.log(chalk.bold.cyan('\n=== meteor-cloud-run Manual Test Suite ===\n'));

// Test 1: CLI is executable
console.log(chalk.bold('Test 1: CLI Executable'));
try {
  const version = execSync('node src/index.js --version', { encoding: 'utf8' }).trim();
  console.log(chalk.green('✓ CLI is executable'));
  console.log(chalk.gray(`  Version: ${version}`));
} catch (error) {
  console.log(chalk.red('✗ CLI failed to execute'));
  console.error(error.message);
  process.exit(1);
}

// Test 2: Help command works
console.log(chalk.bold('\nTest 2: Help Command'));
try {
  execSync('node src/index.js --help', { encoding: 'utf8', stdio: 'pipe' });
  console.log(chalk.green('✓ Help command works'));
} catch (error) {
  console.log(chalk.red('✗ Help command failed'));
  console.error(error.message);
  process.exit(1);
}

// Test 3: All commands are registered
console.log(chalk.bold('\nTest 3: Command Registration'));
const commands = ['init', 'deploy', 'info', 'list-secrets', 'migrate-domain', 'remove'];
const helpOutput = execSync('node src/index.js --help', { encoding: 'utf8' });

let allCommandsRegistered = true;
commands.forEach(cmd => {
  if (helpOutput.includes(cmd)) {
    console.log(chalk.green(`  ✓ ${cmd} command registered`));
  } else {
    console.log(chalk.red(`  ✗ ${cmd} command NOT found`));
    allCommandsRegistered = false;
  }
});

if (!allCommandsRegistered) {
  process.exit(1);
}

// Test 4: Dependencies are installed
console.log(chalk.bold('\nTest 4: Dependencies'));
const requiredDeps = ['chalk', 'commander', 'fs-extra', 'inquirer'];
const packageJson = require('../package.json');

requiredDeps.forEach(dep => {
  if (packageJson.dependencies[dep]) {
    console.log(chalk.green(`  ✓ ${dep} dependency present`));
  } else {
    console.log(chalk.red(`  ✗ ${dep} dependency missing`));
    process.exit(1);
  }
});

// Test 5: Required source files exist
console.log(chalk.bold('\nTest 5: Source Files'));
const fs = require('fs');
const requiredFiles = [
  'src/index.js',
  'src/commands.js',
  'src/auth.js',
  'src/utils.js',
  'src/settings.js',
  'src/fileGeneration.js',
  'src/loadBalancer.js',
  'src/domainMappingMigration.js'
];

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    console.log(chalk.green(`  ✓ ${file} exists`));
  } else {
    console.log(chalk.red(`  ✗ ${file} missing`));
    process.exit(1);
  }
});

// Test 6: Documentation files exist
console.log(chalk.bold('\nTest 6: Documentation'));
const requiredDocs = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'docs/installation.md',
  'docs/commands.md',
  'docs/configuration.md',
  'docs/custom-domains.md',
  'docs/ci-cd.md',
  'docs/troubleshooting.md',
  'docs/resource-management.md',
  'docs/multi-app.md'
];

requiredDocs.forEach(doc => {
  const docPath = path.join(__dirname, '..', doc);
  if (fs.existsSync(docPath)) {
    console.log(chalk.green(`  ✓ ${doc} exists`));
  } else {
    console.log(chalk.red(`  ✗ ${doc} missing`));
    process.exit(1);
  }
});

console.log(chalk.bold.green('\n✓ All automated tests passed!\n'));

console.log(chalk.bold.yellow('=== Manual Testing Instructions ===\n'));
console.log(chalk.yellow('To fully test meteor-cloud-run, perform these manual tests:\n'));

console.log(chalk.bold('1. Test in a Meteor project:'));
console.log(chalk.gray('   cd /path/to/meteor/app'));
console.log(chalk.gray('   meteor-cloud-run init'));
console.log(chalk.gray('   # Verify: .meteor-cloud-run/ directory created with config files\n'));

console.log(chalk.bold('2. Test deployment (requires GCP project):'));
console.log(chalk.gray('   meteor-cloud-run deploy --verbose'));
console.log(chalk.gray('   # Verify: Application deploys successfully to Cloud Run\n'));

console.log(chalk.bold('3. Test info command:'));
console.log(chalk.gray('   meteor-cloud-run info'));
console.log(chalk.gray('   # Verify: Shows correct deployment information\n'));

console.log(chalk.bold('4. Test secrets listing:'));
console.log(chalk.gray('   meteor-cloud-run list-secrets'));
console.log(chalk.gray('   # Verify: Lists secrets correctly\n'));

console.log(chalk.bold('5. Test cleanup:'));
console.log(chalk.gray('   meteor-cloud-run remove --service-only'));
console.log(chalk.gray('   meteor-cloud-run remove'));
console.log(chalk.gray('   # Verify: Resources are properly cleaned up\n'));

console.log(chalk.bold('6. Test with custom domain:'));
console.log(chalk.gray('   meteor-cloud-run init # Answer yes to custom domain'));
console.log(chalk.gray('   meteor-cloud-run deploy'));
console.log(chalk.gray('   meteor-cloud-run migrate-domain'));
console.log(chalk.gray('   # Verify: Load balancer and SSL certificate created\n'));

console.log(chalk.bold.cyan('=== Test Suite Complete ===\n'));
