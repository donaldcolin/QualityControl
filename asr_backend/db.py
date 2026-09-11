import sqlite3
import json
from pathlib import Path

DB_PATH = Path("bakeoff.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            folder_path TEXT,
            language TEXT,
            status TEXT,
            total_files INTEGER,
            done_files INTEGER,
            errors TEXT,
            progress_msg TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS calls (
            id TEXT PRIMARY KEY,
            run_id TEXT,
            filename TEXT,
            language TEXT,
            duration_sec REAL,
            rating TEXT,
            notes TEXT,
            segments TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS call_queue (
            id TEXT PRIMARY KEY,
            call_id TEXT,
            audio_url TEXT,
            language TEXT,
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            errors TEXT
        )
    ''')
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS qc_associates (
            emp_number TEXT PRIMARY KEY,
            emp_name TEXT,
            emp_tags TEXT
        )
    ''')
    
    for col in [
        ("emp_number", "TEXT"),
        ("client_number", "TEXT"),
        ("call_type", "TEXT"),
        ("duration", "REAL")
    ]:
        try:
            c.execute(f"ALTER TABLE call_queue ADD COLUMN {col[0]} {col[1]}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()

init_db()
