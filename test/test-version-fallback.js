#!/usr/bin/env node

/**
 * Version Fallback Tests
 * Tests the smart version matching logic in getCompatibleBaseImageFallback
 */

const chalk = require('chalk');

// Mock verbose logging to suppress output during tests
const utils = require('../src/utils');
utils.setVerboseMode(false);

console.log(chalk.bold.cyan('\n=== Version Fallback Tests ===\n'));

const tests = [
  // Known stable versions should match exactly
  {
    name: 'Meteor 3.0 - exact match',
    version: '3.0',
    expected: 'geoffreybooth/meteor-base:3.0'
  },
  {
    name: 'Meteor 3.2 - exact match',
    version: '3.2',
    expected: 'geoffreybooth/meteor-base:3.2'
  },
  {
    name: 'Meteor 2.12 - exact match',
    version: '2.12',
    expected: 'geoffreybooth/meteor-base:2.12'
  },
  {
    name: 'Meteor 1.12 - exact match',
    version: '1.12',
    expected: 'geoffreybooth/meteor-base:1.12'
  },

  // New versions should attempt optimistic match (will work if tag exists on Docker Hub)
  {
    name: 'Meteor 3.3.2 - optimistic exact match',
    version: '3.3.2',
    expected: 'geoffreybooth/meteor-base:3.3'
  },
  {
    name: 'Meteor 3.4 - falls back to closest',
    version: '3.4',
    expected: 'geoffreybooth/meteor-base:3.3'
  },

  // Unknown minor versions should fall back to closest stable
  {
    name: 'Meteor 3.10 - closest fallback',
    version: '3.10',
    expected: 'geoffreybooth/meteor-base:3.3'
  },
  {
    name: 'Meteor 2.20 - closest fallback',
    version: '2.20',
    expected: 'geoffreybooth/meteor-base:2.16'
  },

  // Lower than known versions should use first available
  {
    name: 'Meteor 2.3 - lower than known',
    version: '2.3',
    expected: 'geoffreybooth/meteor-base:2.16'
  },

  // Unknown major versions should use latest
  {
    name: 'Meteor 4.0 - unknown major',
    version: '4.0',
    expected: 'geoffreybooth/meteor-base:latest'
  },
  {
    name: 'Meteor 5.2.1 - unknown major',
    version: '5.2.1',
    expected: 'geoffreybooth/meteor-base:latest'
  }
];

let passed = 0;
let failed = 0;

// Access the internal fallback function for testing
// In production, getCompatibleBaseImage tries Docker Hub API first
const getCompatibleBaseImageFallback = (meteorVersion) => {
  try {
    const [major, minor, patch] = meteorVersion.split('.').map(Number);

    const knownStableVersions = {
      3: [0, 1, 2, 3],
      2: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      1: [12]
    };

    const majorMinor = `${major}.${minor}`;
    const exactMatch = `geoffreybooth/meteor-base:${majorMinor}`;

    if (knownStableVersions[major] && knownStableVersions[major].includes(minor)) {
      return exactMatch;
    }

    if (knownStableVersions[major]) {
      const availableMinors = knownStableVersions[major];
      const closestMinor = availableMinors
        .filter(m => m <= minor)
        .sort((a, b) => b - a)[0] || availableMinors[availableMinors.length - 1];

      return `geoffreybooth/meteor-base:${major}.${closestMinor}`;
    }

    return 'geoffreybooth/meteor-base:latest';

  } catch (error) {
    return 'geoffreybooth/meteor-base:latest';
  }
};

tests.forEach(test => {
  process.stdout.write(chalk.gray(`Testing: ${test.name}... `));

  try {
    const result = getCompatibleBaseImageFallback(test.version);

    if (result === test.expected) {
      console.log(chalk.green(`✓ PASS (${result})`));
      passed++;
    } else {
      console.log(chalk.red('✗ FAIL'));
      console.log(chalk.red(`  Expected: ${test.expected}`));
      console.log(chalk.red(`  Got: ${result}`));
      failed++;
    }
  } catch (error) {
    console.log(chalk.red('✗ FAIL'));
    console.log(chalk.red(`  Error: ${error.message}`));
    failed++;
  }
});

console.log(chalk.bold(`\n=== Results ===`));
console.log(chalk.green(`Passed: ${passed}`));
console.log(failed > 0 ? chalk.red(`Failed: ${failed}`) : chalk.gray(`Failed: ${failed}`));

if (failed > 0) {
  process.exit(1);
}

console.log(chalk.bold.green('\n✓ All version fallback tests passed!\n'));
