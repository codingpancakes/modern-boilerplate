#!/usr/bin/env node

/**
 * Migration script that handles unknown types in Drizzle schema
 * This script temporarily replaces unknown types for Drizzle Kit operations
 * while preserving the original schema for runtime use.
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SCHEMA_PATH = 'src/node/db/schema.ts';
const BACKUP_PATH = 'src/node/db/schema.ts.backup';

function backupSchema() {
  console.log('📦 Backing up original schema...');
  fs.copyFileSync(SCHEMA_PATH, BACKUP_PATH);
}

function restoreSchema() {
  console.log('🔄 Restoring original schema...');
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, SCHEMA_PATH);
    fs.unlinkSync(BACKUP_PATH);
  }
}

function makeSchemaCompatible() {
  console.log('🔧 Making schema compatible with Drizzle Kit...');
  let content = fs.readFileSync(SCHEMA_PATH, 'utf8');
  
  // Replace unknown types with text for migration compatibility
  content = content.replace(/unknown\(/g, 'text(');
  content = content.replace(/txid_current\(\)/g, '0');
  
  fs.writeFileSync(SCHEMA_PATH, content);
}

function runDrizzleCommand(command) {
  console.log(`🚀 Running: npx drizzle-kit ${command}`);
  try {
    const output = execSync(`npx drizzle-kit ${command}`, { 
      stdio: 'inherit',
      encoding: 'utf8'
    });
    return true;
  } catch (error) {
    console.error(`❌ Command failed: ${error.message}`);
    return false;
  }
}

function main() {
  const command = process.argv[2];
  
  if (!command) {
    console.log(`
Usage: node scripts/drizzle-migrate.js <command>

Available commands:
  generate:pg  - Generate migration files
  push:pg      - Push schema changes to database
  
Examples:
  node scripts/drizzle-migrate.js generate:pg
  node scripts/drizzle-migrate.js push:pg
`);
    process.exit(1);
  }

  try {
    // Backup original schema
    backupSchema();
    
    // Make schema compatible
    makeSchemaCompatible();
    
    // Run the drizzle command
    const success = runDrizzleCommand(command);
    
    if (!success) {
      console.error('❌ Migration command failed');
      process.exit(1);
    }
    
    console.log('✅ Migration command completed successfully');
    
  } catch (error) {
    console.error('❌ Error during migration:', error.message);
    process.exit(1);
  } finally {
    // Always restore the original schema
    restoreSchema();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Process interrupted, restoring schema...');
  restoreSchema();
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Process terminated, restoring schema...');
  restoreSchema();
  process.exit(1);
});

main();
