module.exports = {
  apps: [
    {
      name: 'qc-node-api',
      script: './node_backend/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'qc-python-worker',
      script: 'venv/bin/uvicorn',
      args: 'api.api_webhook:app --host 127.0.0.1 --port 8000',
      cwd: './asr_backend',
      interpreter: 'venv/bin/python3', // Forces the use of the virtual environment
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '8G', // ASR + Gemini loads can be heavy on memory
      kill_timeout: 15000,
      env: {
        ENVIRONMENT: 'production'
      }
    },
    {
      name: 'qc-frontend-serve',
      script: 'npx',
      args: 'serve -s dist -l 5173',
      cwd: './frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
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
