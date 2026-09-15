#!/bin/bash
# start_all.sh - Starts all 4 Quality Control services in a single terminal

# Function to kill all background processes when the script exits
cleanup() {
    echo ""
    echo "Stopping all services..."
    # Kill all child processes of this script
    pkill -P $$ 2>/dev/null
    exit
}

# Trap Ctrl+C (SIGINT) and terminal close (SIGTERM)
trap cleanup SIGINT SIGTERM

echo "Starting Node Backend (port 3000)..."
cd node_backend && node server.js &
NODE_PID=$!

echo "Starting Frontend (port 5173)..."
cd frontend && npm run dev &
VITE_PID=$!

echo "Starting ASR Worker (port 8000)..."
cd asr_backend && source venv/bin/activate && uvicorn api.api_webhook:app --reload --port 8000 &
ASR_PID=$!

echo ""
echo "========================================================="
echo "✅ All 3 services started successfully!"
echo "📡 Frontend is running at http://localhost:5173"
echo "📡 Unified Node Backend: http://localhost:3000"
echo "📡 ASR Worker:       http://localhost:8000"
echo "Press Ctrl+C at any time to stop all services at once."
echo "========================================================="
echo ""

# Wait indefinitely until Ctrl+C is pressed
wait

