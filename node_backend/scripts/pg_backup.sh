#!/bin/bash
# ==============================================================================
# Supabase Postgres Nightly Backup Script
# Creates a compressed full backup and keeps the last 7 days.
# ==============================================================================

# Database Connection Info (Must be set in environment or hardcoded here if local)
DB_HOST=${SUPABASE_DB_HOST:-"localhost"}
DB_PORT=${SUPABASE_DB_PORT:-"5432"}
DB_USER=${SUPABASE_DB_USER:-"postgres"}
DB_NAME=${SUPABASE_DB_NAME:-"postgres"}

# Backup directory
BACKUP_DIR="$(dirname "$0")/../../backups"
mkdir -p "$BACKUP_DIR"

# Timestamp for filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/qc_backup_$TIMESTAMP.sql.gz"

echo "[$(date)] Starting backup of $DB_NAME..."

# Run pg_dump and compress
PGPASSWORD=$SUPABASE_DB_PASSWORD pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "[$(date)] Backup completed successfully: $BACKUP_FILE"
else
  echo "[$(date)] ERROR: Backup failed!"
  exit 1
fi

# Cleanup old backups (keep last 7 days)
echo "[$(date)] Cleaning up backups older than 7 days..."
find "$BACKUP_DIR" -type f -name "qc_backup_*.sql.gz" -mtime +7 -exec rm {} \;

echo "[$(date)] Backup process finished."
