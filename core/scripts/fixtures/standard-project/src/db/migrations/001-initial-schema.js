/**
 * Initial Database Schema
 * @implements {D002} PostgreSQL database design
 * @addresses {T006} database schema design task
 */

export async function up(knex) {
  // Users table for {C001} authentication service
  await knex.schema.createTable('users', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('username').unique().notNullable();
    table.string('email').unique().notNullable();
    table.string('password_hash').notNullable();
    table.jsonb('roles').defaultTo('[]');
    table.timestamps(true, true);
    
    // Indexes for performance per {T010}
    table.index('username');
    table.index('email');
  });

  // User profiles for {R002} profile management
  await knex.schema.createTable('profiles', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('display_name');
    table.string('avatar_url');
    table.jsonb('preferences').defaultTo('{}');
    table.jsonb('privacy_settings').defaultTo('{}');
    table.string('locale').defaultTo('en'); // For {R005} i18n support
    table.timestamps(true, true);
    
    table.index('user_id');
  });

  // Audit log for {R001} security requirements
  await knex.schema.createTable('audit_log', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users');
    table.string('action').notNullable();
    table.jsonb('details');
    table.string('ip_address');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexes for {C004} analytics queries
    table.index('user_id');
    table.index('action');
    table.index('created_at');
  });

  // Sessions for {C001} authentication
  await knex.schema.createTable('sessions', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash').unique().notNullable();
    table.timestamp('expires_at').notNullable();
    table.jsonb('metadata');
    table.timestamps(true, true);
    
    table.index('token_hash');
    table.index('expires_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTable('sessions');
  await knex.schema.dropTable('audit_log');
  await knex.schema.dropTable('profiles');
  await knex.schema.dropTable('users');
}
