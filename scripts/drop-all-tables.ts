import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function dropAllTables() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const sql = neon(databaseUrl);

  console.log('🗑️  Dropping all tables...');

  try {
    // Drop all tables in correct order (respecting foreign keys)
    await sql`DROP TABLE IF EXISTS session_participants CASCADE`;
    await sql`DROP TABLE IF EXISTS session_external_events CASCADE`;
    await sql`DROP TABLE IF EXISTS session_dialin CASCADE`;
    await sql`DROP TABLE IF EXISTS session_assets CASCADE`;
    await sql`DROP TABLE IF EXISTS sessions CASCADE`;
    await sql`DROP TABLE IF EXISTS appointments CASCADE`;
    await sql`DROP TABLE IF EXISTS calendars CASCADE`;
    await sql`DROP TABLE IF EXISTS external_calendars CASCADE`;
    await sql`DROP TABLE IF EXISTS external_calendar_accounts CASCADE`;
    await sql`DROP TABLE IF EXISTS telephony_numbers CASCADE`;
    await sql`DROP TABLE IF EXISTS rtc_webhook_events CASCADE`;
    await sql`DROP TABLE IF EXISTS property_facets CASCADE`;
    await sql`DROP TABLE IF EXISTS entity_properties CASCADE`;
    await sql`DROP TABLE IF EXISTS property_definitions CASCADE`;
    await sql`DROP TABLE IF EXISTS group_memberships CASCADE`;
    await sql`DROP TABLE IF EXISTS groups CASCADE`;
    await sql`DROP TABLE IF EXISTS org_units CASCADE`;
    await sql`DROP TABLE IF EXISTS profiles CASCADE`;
    await sql`DROP TABLE IF EXISTS auth_identities CASCADE`;
    await sql`DROP TABLE IF EXISTS organizations CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    await sql`DROP TABLE IF EXISTS idempotency_keys CASCADE`;
    
    // Drop Drizzle migrations table
    await sql`DROP TABLE IF EXISTS __drizzle_migrations CASCADE`;
    
    // Drop all custom types
    await sql`DROP TYPE IF EXISTS user_type CASCADE`;
    await sql`DROP TYPE IF EXISTS session_status CASCADE`;
    await sql`DROP TYPE IF EXISTS persona_value_source CASCADE`;
    await sql`DROP TYPE IF EXISTS persona_cardinality CASCADE`;
    await sql`DROP TYPE IF EXISTS persona_attr_type CASCADE`;
    await sql`DROP TYPE IF EXISTS participant_invite_status CASCADE`;
    await sql`DROP TYPE IF EXISTS participant_attendance_status CASCADE`;
    await sql`DROP TYPE IF EXISTS embed_provider CASCADE`;
    await sql`DROP TYPE IF EXISTS assignment_status CASCADE`;
    await sql`DROP TYPE IF EXISTS appointment_status CASCADE`;

    console.log('✅ All tables and types dropped successfully!');
  } catch (error) {
    console.error('❌ Error dropping tables:', error);
    throw error;
  }
}

dropAllTables()
  .then(() => {
    console.log('✅ Database reset complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  });
