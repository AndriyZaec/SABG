#!/bin/sh
set -eu

PGPASSWORD="$POSTGRES_PASSWORD" psql --set=ON_ERROR_STOP=1 \
  --host "${POSTGRES_HOST:-postgres}" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DATABASE_PASSWORD" \
  --set=database="$POSTGRES_DB" \
  --set=migrator="$POSTGRES_USER" <<-'SQL'
	SELECT 'CREATE ROLE arena_app LOGIN PASSWORD ' || quote_literal(:'app_password')
	WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_app') \gexec
	SELECT 'ALTER ROLE arena_app PASSWORD ' || quote_literal(:'app_password') \gexec

	GRANT CONNECT ON DATABASE :"database" TO arena_app;
	GRANT USAGE ON SCHEMA public TO arena_app;
	GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arena_app;
	GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO arena_app;
	ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
	  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arena_app;
	ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
	  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO arena_app;
SQL
