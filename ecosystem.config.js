module.exports = {
  apps: [
    {
      name: 'qc-node-api',
      script: './node_backend/server.js',
      cwd: './',
      instances: 1, // Node is single-threaded, but 1 is fine for now
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'qc-python-worker',
      script: 'uvicorn',
      args: 'api.api_webhook:app --host 127.0.0.1 --port 8000',
      cwd: './asr_backend',
      interpreter: 'python3', // Assumes a global python3 or venv python
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '8G', // ASR + Gemini loads can be heavy on memory
      env: {
        ENVIRONMENT: 'production'
      }
    },
    {
      name: 'qc-db-backup',
      script: './node_backend/scripts/pg_backup.sh',
      cwd: './',
      instances: 1,
      exec_interpreter: 'bash',
      cron_restart: '0 2 * * *', // Run every night at 2:00 AM
      autorestart: false
    }
  ]
};
