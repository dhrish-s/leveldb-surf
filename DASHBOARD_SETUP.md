# LevelDB Metrics Dashboard - Complete Setup Guide

This guide walks through setting up and running both the backend metrics server and frontend dashboard to visualize LevelDB Bloom vs SuRF filter performance.

## Project Structure

```
.
├── project/                    # LevelDB source code with filter instrumentation
├── benchmarks/                 # Benchmark scripts and results
├── dashboard-server/           # Node.js + Express metrics API backend
│   ├── src/
│   │   ├── server.js          # Express app
│   │   ├── metrics-parser.js  # JSONL parser
│   │   ├── summary-calculator.js
│   │   └── routes.js          # API endpoints
│   ├── index.js               # Entry point
│   ├── package.json
│   └── README.md
└── dashboard-ui/              # React + Vite frontend dashboard
    ├── src/
    │   ├── components/
    │   ├── lib/
    │   ├── types/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── index.css
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── README.md
```

## Prerequisites

- Node.js 14+ and npm
- Metrics JSONL file from running db_bench with `--metrics_out` flag

## Step 1: Generate Metrics Data

Run the LevelDB benchmark with metrics output:

```bash
cd project
./db_bench --db=/tmp/testdb --benchmarks=fillrandom,readrandom,readseq \
  --num=1000000 --metrics_out=/tmp/metrics.jsonl
```

This generates a JSONL metrics file with all query events and their performance characteristics.

## Step 2: Start Backend Server

The backend reads the metrics file and serves REST APIs.

```bash
cd dashboard-server
npm install
METRICS_FILE=/tmp/metrics.jsonl PORT=3001 npm start
```

Verify the backend is running:

```bash
curl http://localhost:3001/api/health
# Should return: {"status":"ok"}
```

### Backend API Endpoints

- `GET /api/health` - Server health check
- `GET /api/meta` - Available filter types, query types, benchmarks, event count
- `GET /api/summary` - Aggregated metrics (avg latency, false positive rate, etc.)
- `GET /api/events?filter_type=bloom&limit=500` - Individual query events with optional filters

Query parameters for `/api/events`:
- `filter_type` (bloom, surf, or omit for all)
- `query_type` (point_get, range_scan, etc., or omit)
- `benchmark_name` (fillrandom, readrandom, etc., or omit)
- `limit` (default 500)

## Step 3: Start Frontend Dashboard

The frontend connects to the backend and displays interactive visualizations.

```bash
cd dashboard-ui
npm install
npm run dev
```

Open browser: `http://localhost:5173`

The frontend will display:
- **Summary Cards**: Total events, avg/p95 latency, false positive rate, Bloom vs SuRF comparison
- **Charts**: Latency trends, filter type comparison, query type distribution, SSTable pruning stats
- **Query Trace Table**: Individual query events with detailed metrics
- **Event Inspector**: JSON view of selected query event

## Restart Workflow from Scratch

Assume all commands are run from the repository root directory.

### Terminal 1 - inside container
- Start in repo root on host machine:
  ```bash
  cd <repo-root>
  ```
- Start container with mounts:
  ```bash
  docker run -it --rm -v "${PWD}\project:/workspace/project" -v "${PWD}\benchmarks:/workspace/benchmarks" -v "${PWD}\metrics:/workspace/metrics" leveldb-surf-leveldb-surf
  ```
- If C++ source changed, rebuild inside container:
  ```bash
  cd /workspace/leveldb
  bash /workspace/benchmarks/rebuild.sh
  cd /workspace/leveldb/build
  cmake ..
  make -j
  ```
- If C++ source did not change, skip rebuild and go directly to:
  ```bash
  cd /workspace/leveldb/build
  ```
- Generate Bloom metrics:
  ```bash
  ./db_bench --benchmarks=fillrandom,readrandom --num=1000 --filter=bloom --metrics_out=/workspace/metrics/bloom_fixcheck.jsonl
  ```
- Generate SuRF metrics:
  ```bash
  ./db_bench --benchmarks=fillrandom,surfscan50 --num=1000 --filter=surf --metrics_out=/workspace/metrics/surf_fixcheck.jsonl
  ```
- Confirm files:
  ```bash
  ls /workspace/metrics
  ```

### Terminal 2 - backend outside Docker
- Go to repo root on host machine:
  ```bash
  cd <repo-root>
  ```
- Start backend with Bloom metrics:
  ```powershell
  cd dashboard-server
  $env:METRICS_FILE="../metrics/bloom_fixcheck.jsonl"
  $env:PORT="3001"
  npm start
  ```
- To switch to SuRF later:
  ```powershell
  stop backend with Ctrl + C
  cd <repo-root>/dashboard-server
  $env:METRICS_FILE="../metrics/surf_fixcheck.jsonl"
  $env:PORT="3001"
  npm start
  ```

### Terminal 3 - frontend outside Docker
- Go to repo root on host machine:
  ```bash
  cd <repo-root>
  ```
- Start frontend:
  ```bash
  cd dashboard-ui
  npm run dev
  ```
- Open the URL shown, usually:
  ```text
  http://localhost:5173/
  ```

## Quick Verification

- Backend health check commands:
  ```powershell
  Invoke-RestMethod http://localhost:3001/api/health
  Invoke-RestMethod http://localhost:3001/api/meta
  Invoke-RestMethod http://localhost:3001/api/summary
  Invoke-RestMethod "http://localhost:3001/api/events?limit=5"
  ```
- Frontend check:
  Open http://localhost:5173 and confirm cards, charts, and table load

## Short Version

- Start container
- Generate metrics
- Start backend
- Start frontend

## When rebuild is required

Rebuild is only needed if LevelDB C++ source code changed.

## When rebuild is not required

Rebuild is not needed for regenerating metrics, switching metrics files, or running backend/frontend.

## Data Flow

```
LevelDB db_bench (--metrics_out)
           ↓
     metrics.jsonl
           ↓
  Dashboard Server (Parses JSONL, computes summary)
           ↓
  REST API (:3001)
           ↓
  React Frontend (Fetches and visualizes)
           ↓
     Browser Display (http://localhost:5173)
```

## Filtering and Interaction

1. Use **FilterBar** dropdowns to filter by:
   - Filter type (all, Bloom, SuRF)
   - Query type (all, point_get, range_scan, etc.)
   - Benchmark (all, fillrandom, readrandom, readseq)
   - Result limit (100, 500, 1000, 10000, all)

2. **SummaryCards** auto-update to show filtered metrics

3. **Charts** display visualizations of filtered data:
   - Latency over event index
   - Avg latency by filter type
   - Events by query type
   - SSTable filter results
   - Event count by benchmark

4. **EventTable** shows individual query events
   - Click row chevron to expand and see details
   - Details include: filter_may_match, false_positive, sstables_considered/pruned/opened, query range

5. **EventInspector** shows full JSON of selected event

## Performance Notes

- Backend loads entire JSONL into memory on startup (~50MB for 1M queries)
- Frontend polls backend every 2 seconds for updates
- Adjust polling interval in `dashboard-ui/src/App.tsx` if needed
- Frontend maintains event count limit per filter configuration

## Troubleshooting

### Backend not responding

```bash
# Check port is correct
lsof -i :3001

# Check metrics file exists and is readable
ls -lah /tmp/metrics.jsonl

# Check backend logs for parse errors
npm start
```

### Frontend shows "Backend server not responding"

- Ensure backend is running: `METRICS_FILE=/tmp/metrics.jsonl PORT=3001 npm start`
- Check CORS settings (should be enabled in `dashboard-server/src/server.js`)
- Browser console might show more details (F12)

### No data in metrics file

Ensure db_bench was run with `--metrics_out` flag:

```bash
./db_bench --db=/tmp/testdb --benchmarks=readrandom --num=1000000 \
  --metrics_out=/tmp/metrics.jsonl
```

### Charts not rendering

- Check that events have required fields (latency_us, filter_type, query_type)
- Verify filter is not filtering out all events
- Check browser console for Recharts errors

## Environment Variables

### Backend

- `METRICS_FILE`: Path to JSONL metrics file (default: `../metrics/sample_metrics.jsonl`)
- `PORT`: Server port (default: `3001`)

### Frontend

Configure backend URL in `dashboard-ui/vite.config.ts`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}
```

## Development

### Adding New Metrics

1. Extend `MetricsEvent` interface in `dashboard-ui/src/types/metrics.ts`
2. Update backend parser in `dashboard-server/src/metrics-parser.js`
3. Add new summary aggregations in `summary-calculator.js`
4. Create new components/charts in frontend

### Building for Production

Backend:
```bash
cd dashboard-server
npm install --production
# Run with: METRICS_FILE=path PORT=3001 npm start
```

Frontend:
```bash
cd dashboard-ui
npm install
npm run build
# Outputs to dist/
npm run preview  # Test build locally
```

## See Also

- [Backend README](./dashboard-server/README.md) - Detailed backend API docs
- [Frontend README](./dashboard-ui/README.md) - Frontend component architecture
- `project/notes/Results.md` - Original benchmark notes
- `benchmarks/SUMMARY.txt` - Baseline benchmark results

## Next Steps

1. Run `db_bench` with Bloom and SuRF filters on your dataset
2. Compare metrics in the dashboard
3. Identify bottlenecks using EventTable drill-down
4. Use latency charts to visualize performance differences
5. Export summary statistics for reports

## Support

For metrics collection issues, see Phase 1-3 implementation notes in `project/notes/`.
For dashboard issues, check component files in `dashboard-ui/src/components/`.
