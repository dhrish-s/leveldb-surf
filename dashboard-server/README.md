# LevelDB Metrics Server

Backend server for the LevelDB observability dashboard.

## Features

- Reads JSONL metrics files from db_bench
- Parses and aggregates filter performance metrics
- Serves REST API for dashboard UI
- Handles missing/malformed data gracefully
- Supports filtering by filter type, query type, benchmark name

## Installation

```bash
npm install
```

## Configuration

Set environment variables:

- `METRICS_FILE`: Path to the metrics JSONL file (default: `../metrics/sample_metrics.jsonl`)
- `METRICS_FILE_BLOOM`: Path to the Bloom metrics JSONL file
- `METRICS_FILE_SURF`: Path to the SuRF metrics JSONL file
- `PORT`: Server port (default: `3001`)

Example (Linux/macOS):

```bash
export METRICS_FILE_BLOOM="../metrics/bloom_fixcheck.jsonl"
export METRICS_FILE_SURF="../metrics/surf_fixcheck.jsonl"
export PORT=3001
npm start
```

Example (PowerShell):

```powershell
$env:METRICS_FILE_BLOOM="../metrics/bloom_fixcheck.jsonl"
$env:METRICS_FILE_SURF="../metrics/surf_fixcheck.jsonl"
$env:PORT="3001"
npm start
```

## Running

```bash
npm start
```

Server will start on `http://localhost:3001`

## API Endpoints

### GET /api/health
Health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-04-13T10:00:00.000Z"
}
```

### GET /api/meta
Metrics file metadata and available filter/query types.

**Response:**
```json
{
  "metrics_file": "/path/to/metrics.jsonl",
  "total_lines_read": 1000,
  "malformed_lines_skipped": 0,
  "total_events": 1000,
  "server_time": "2024-04-13T10:00:00.000Z",
  "available_filter_types": ["bloom", "surf"],
  "available_query_types": ["point_get", "range_scan"],
  "available_benchmark_names": ["readrandom", "surfscan50"]
}
```

### GET /api/summary
Aggregated metrics summary.

**Response:**
```json
{
  "total_events": 1000,
  "avg_latency_us": 150,
  "p95_latency_us": 250,
  "false_positive_rate": 0.05,
  "actual_match_rate": 0.8,
  "filter_may_match_rate": 0.85,
  "total_considered": 5000,
  "total_pruned": 2000,
  "total_opened": 3000,
  "count_by_filter_type": {
    "bloom": 500,
    "surf": 500
  },
  ...
}
```

### GET /api/events
Events with optional filtering.

**Query Parameters:**
- `filter_type`: "bloom", "surf", or "all" (default: "all")
- `query_type`: "point_get", "range_scan", etc. (default: "all")
- `benchmark_name`: benchmark name (default: "all")
- `limit`: max events to return (default: all)

**Response:**
```json
{
  "events": [...],
  "count": 100
}
```

## Testing

### Test health endpoint
```bash
curl http://localhost:3001/api/health
```

### Test meta endpoint
```bash
curl http://localhost:3001/api/meta
```

### Test events with filtering
```bash
curl "http://localhost:3001/api/events?filter_type=bloom&limit=10"
```

### Test summary
```bash
curl http://localhost:3001/api/summary
```

## Troubleshooting

**Metrics file not found:**
- Set `METRICS_FILE` environment variable to the correct path
- Server will start anyway but with 0 events

**Malformed JSONL:**
- Server skips malformed lines and logs them
- Check stderr for details

**Port already in use:**
- Set `PORT` to a different value: `PORT=3002 npm start`
