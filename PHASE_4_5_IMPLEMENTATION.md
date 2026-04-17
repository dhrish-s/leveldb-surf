# Phase 4-5 Implementation Summary

## Overview

Phase 4 and Phase 5 implement a complete observability dashboard for visualizing LevelDB Bloom vs SuRF filter performance metrics. The system consists of two independent components:

1. **Phase 4 Backend** (Node.js + Express): Parses JSONL metrics files and exposes REST APIs
2. **Phase 5 Frontend** (React + Vite): Interactive dashboard with visualizations and drill-down

This document is the source of truth for the Phase 4-5 implementation.

## Project Structure

```
dashboard-server/                 # Phase 4: Backend metrics server
├── index.js                      # Entry point
├── package.json                  # Dependencies: express, cors
├── README.md                     # Backend documentation
├── src/
│   ├── server.js               # Express app initialization
│   ├── metrics-parser.js       # JSONL file parsing and loading
│   ├── summary-calculator.js   # Aggregation and percentile calculations
│   └── routes.js               # REST API endpoint definitions
└── [implementation notes below]

dashboard-ui/                      # Phase 5: Frontend dashboard
├── index.html                    # HTML root container
├── package.json                  # Dependencies: react, vite, tailwindcss, recharts
├── postcss.config.js             # Tailwind CSS processor
├── tailwind.config.js            # Tailwind theme
├── tsconfig.json                 # TypeScript configuration
├── vite.config.ts                # Vite build config + API proxy
├── README.md                     # Frontend documentation
├── src/
│   ├── main.tsx                # React entry point with StrictMode
│   ├── App.tsx                 # Main app component with data loading
│   ├── index.css               # Tailwind directives + custom card/badge styles
│   ├── types/
│   │   └── metrics.ts          # TypeScript interfaces (MetricsEvent, Summary, Meta, FilterState)
│   ├── lib/
│   │   ├── api.ts              # Backend API client functions
│   │   └── metrics.ts          # Utility functions (formatLatency, colors, stats)
│   └── components/
│       ├── Header.tsx          # Dashboard title and metadata
│       ├── FilterBar.tsx       # Filter dropdowns (filter_type, query_type, benchmark_name, limit)
│       ├── SummaryCards.tsx    # Aggregate stats and Bloom vs SuRF comparison
│       ├── ComparisonCharts.tsx # 5 Recharts visualizations
│       ├── EventTable.tsx      # Per-query table with expandable details
│       ├── EventInspector.tsx  # JSON detail view
│       └── LoadingState.tsx    # Loading/error/empty states
└── [implementation notes below]
```

## Backend (Phase 4): Metrics Server

### Architecture

```
JSONL File (from db_bench)
    ↓
metrics-parser.js (parseJsonlFile)
    ↓
MetricsEvent[] in memory
    ↓
summary-calculator.js (computeSummary)
    ↓
Summary object (aggregates)
    ↓
routes.js (setupRoutes)
    ↓
REST API (/api/health, /api/meta, /api/summary, /api/events)
    ↓
Express.js listening on PORT (default 3001)
```

### Key Components

#### src/server.js
- Initializes Express app with CORS
- Loads metrics file on startup from `METRICS_FILE` env var
- Binds to `PORT` env var (default 3001)
- Calls `setupRoutes(app, state)` to register API endpoints

#### src/metrics-parser.js
- `parseJsonlFile(filePath)`: Reads file line-by-line, parses JSON, skips malformed lines
- Returns `{ events: MetricsEvent[], metadata: { dates, filterTypes, queryTypes, benchmarkNames } }`
- Graceful error handling: logs skipped lines, continues parsing
- Called once on server startup, result cached in memory

#### src/summary-calculator.js
- `computeSummary(events)`: Calculates aggregations over all events
- Returns Summary object with:
  - `total_events`: Count of all events
  - `avg_latency_us`, `p95_latency_us`: Latency statistics
  - `false_positive_rate`: (false positives / point gets) * 100
  - `actual_match_rate`: (actual matches / all queries) * 100
  - `filter_may_match_rate`: (filter may match results / all queries) * 100
  - `count_by_filter_type`: Event count per filter (bloom, surf)
  - `count_by_query_type`: Event count per query type (point_get, range_scan)
  - `count_by_benchmark_name`: Event count per benchmark
  - `avg_latency_by_filter_type`: Per-filter latency average
  - `total_considered`, `total_pruned`, `total_opened`: SSTable aggregate counts
- `percentile(values, p)`: Calculates p-th percentile (p95 = 95th percentile)
- `getDefaultSummary()`: Returns all-zeros summary for empty data

#### src/routes.js
- `setupRoutes(app, state)`: Registers 4 GET endpoints
- **GET /api/health**
  - Response: `{ status: "ok" }`
  - Used to verify backend is running

- **GET /api/meta**
  - Response: Metadata about loaded data
  - Fields: total_events, filter_types[], query_types[], benchmark_names[], timestamp
  - Used by frontend to populate filter dropdowns

- **GET /api/summary**
  - Response: Aggregated Summary object (see computeSummary above)
  - Query params: None (always returns full dataset summary)
  - Used for aggregate stat cards

- **GET /api/events**
  - Query params: `filter_type`, `query_type`, `benchmark_name`, `limit`
  - Query example: `/api/events?filter_type=bloom&limit=500`
  - Response: Filtered MetricsEvent[] array
  - Filtering logic: inclusively require matching query params (AND logic)
  - Limit defaults to 500 if not specified
  - Used for EventTable and charts

### Deployment

```bash
# Development
npm install
npm start

# Production
npm install --production
METRICS_FILE=/path/to/metrics.jsonl PORT=3001 npm start
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_FILE` | `../metrics/sample_metrics.jsonl` | Path to JSONL metrics file |
| `PORT` | `3001` | HTTP server port |

## Frontend (Phase 5): Dashboard UI

### Architecture

```
React App (App.tsx with state management)
    ├-> Header (displays meta info)
    ├-> FilterBar (dropdown controls)
    ├-> SummaryCards (aggregate stats)
    ├-> ComparisonCharts (5 Recharts)
    ├-> EventTable (query trace)
    ├-> EventInspector (selected event detail)
    └-> LoadingState (UX overlay)

Data Flow:
App.tsx (useEffect)
    ↓
lib/api.ts (fetch functions)
    ↓
Vite Proxy -> http://localhost:3001/api
    ↓
Backend REST API
    ↓
Response cached in App state
    ↓
Re-render components with new data
    ↓
useEffect polls every 2 seconds
```

### Key Components

#### types/metrics.ts
TypeScript interfaces for type safety:
- `MetricsEvent`: Single query record (15+ fields, some optional)
- `Summary`: Aggregated metrics object
- `Meta`: Available filter values and metadata
- `FilterState`: Current filter selections

#### lib/api.ts
Backend API client with error handling:
- `fetchHealth()`: Check if backend is running
- `fetchMeta()`: Get available filters and counts
- `fetchSummary()`: Get aggregated metrics
- `fetchEvents(filters)`: Get filtered events
All functions have try-catch and sensible defaults for failures

#### lib/metrics.ts
Formatting and utility functions:
- `formatLatency(us)`: Format microseconds to readable time (µs/ms/s)
- `formatPercent(n)`: Format number as percentage (null -> "-")
- `formatNumber(n)`: Format with K/M abbreviations
- `getFilterColor()`: Return CSS class for badge based on filter type
- `getQueryTypeColor()`: Return CSS class for badge based on query type
- `computeFilterTypeStats()`: Calculate aggregates for specific filter type

#### components/Header.tsx
Displays dashboard metadata:
- Title, subtitle
- Metrics file path (from meta)
- Total event count (from meta)
- Server timestamp

#### components/FilterBar.tsx
Filter control dropdowns:
- Filter Type (all, Bloom, SuRF) - dropdown populated from meta.filter_types
- Query Type (all + dynamic) - dropdown populated from meta.query_types
- Benchmark Name (all + dynamic) - dropdown populated from meta.benchmark_names
- Limit (100, 500, 1000, 10000, all) - fixed list
- onChange handler updates App state and triggers re-fetch

#### components/SummaryCards.tsx
Aggregate metric cards:
- 5 primary cards: Total Events, Avg Latency, False Positives, Actual Match, Filter May Match
- 3 SSTable cards: Total Considered, Total Pruned, Total Opened
- 2 comparison cards: Bloom stats card, SuRF stats card
- Each comparison card shows: count, avg latency, p95 latency, false positive rate

#### components/ComparisonCharts.tsx
5 Recharts visualizations (Recharts ResponsiveContainer):
1. **Latency Over Event Index** (LineChart)
   - X: Event index (first 500 events only to avoid crowding)
   - Y: latency_us
   - Shows latency trend across query sequence

2. **Avg Latency by Filter Type** (BarChart)
   - X: filter_type (bloom, surf)
   - Y: avg_latency_us
   - Direct comparison of filter performance

3. **Event Count by Query Type** (BarChart)
   - X: query_type (point_get, range_scan, etc.)
   - Y: event count
   - Distribution of query types in workload

4. **SSTable Filter Results** (BarChart)
   - X: Type (Considered, Pruned, Opened)
   - Y: count (total_considered, total_pruned, total_opened)
   - Shows effectiveness of pruning

5. **Events by Benchmark** (BarChart)
   - X: benchmark_name (fillrandom, readrandom, readseq, etc.)
   - Y: event count
   - Workload distribution

All charts include Tooltips, Legends, properly labeled axes, and custom colors (blue, purple, cyan, green).

#### components/EventTable.tsx
Per-query event table with drill-down:
- Main columns: ID, Benchmark, Filter (badge), Query Type (badge), Latency, Match (badge)
- Expandable row shows detailed fields:
  - filter_may_match (Yes/No or -)
  - false_positive (Yes/No or -)
  - sstables_considered, sstables_pruned, sstables_opened (numbers or -)
  - query_lo, query_hi (range bounds or -)
  - timestamp_us (formatted as time)
- Hover effects, badge styling, click-to-expand chevron

#### components/EventInspector.tsx
Detail view of selected event:
- Shows event in JSON format using `<pre>` block
- Prettified with `JSON.stringify(event, null, 2)`
- Max height with scroll for very large events

#### components/LoadingState.tsx
Multiple UX state components:
- `LoadingState`: Spinner + "Loading metrics..." message
- `ErrorState(message)`: Red error box with message
- `EmptyState()`: Message when no events to display

#### App.tsx
Main application component orchestrating the entire dashboard:
- State management:
  - `health`: Backend connectivity status
  - `meta`: Available filters and counts
  - `summary`: Aggregated metrics
  - `events`: Filtered event list
  - `selectedEvent`: For EventInspector
  - `filters`: Current filter selections (filter_type, query_type, benchmark_name, limit)
  - `loading`: Data fetch in progress
  - `error`: Error message if failed

- useEffect hook for data loading:
  - Runs on component mount
  - Dependency: `filters` (re-runs when user changes filters)
  - Loading sequence:
    1. Fetch health check
    2. If healthy, fetch meta, summary, and events in parallel
    3. Set loading done
  - Sets up 2-second polling interval
  - Cleans up interval on unmount

- Component composition:
  - Always show Header
  - Show health error if backend not responding
  - Show loading spinner during fetch
  - Show error message if fetch failed
  - Show empty state if no events
  - Show full dashboard if data loaded

#### main.tsx
React entry point:
```typescript
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

#### index.css
Tailwind CSS setup + custom classes:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom card class for consistent styling */
.card {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* Custom badge classes */
.badge { /* base badge */ }
.badge-success { /* green */ }
.badge-danger { /* red */ }
.badge-info { /* blue */ }
```

### Deployment

Development:
```bash
npm install
npm run dev
# Open http://localhost:5173
```

Production:
```bash
npm install
npm run build
npm run preview
# Outputs to dist/
```

### Configuration

**vite.config.ts** routes `/api` requests to backend:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}
```

Change backend URL by updating proxy target.

### Design System

- **Color Scheme**: Slate gray backgrounds, blue/purple highlights, green success, red error
- **Spacing**: 6px base unit (px-6 = 24px padding)
- **Typography**: font-semibold for headers, text-sm for details
- **Responsive**: Mobile-first with md: breakpoints for tablet/desktop
- **Shadows**: Soft card shadows (shadow-sm)
- **Badges**: Inline rounded pills with colored backgrounds

## Data Integration

### JSONL Metrics File Format

Expected format from db_bench with `--metrics_out` flag:

```jsonl
{"query_id":1,"benchmark_name":"fillrandom","filter_type":"bloom","query_type":"put","latency_us":145,"timestamp_us":1000000,"actual_match":true}
{"query_id":2,"benchmark_name":"readrandom","filter_type":"bloom","query_type":"point_get","latency_us":892,"timestamp_us":1010000,"actual_match":true,"filter_may_match":true,"false_positive":false,"sstables_considered":4,"sstables_pruned":2,"sstables_opened":2,"query_lo":"key_123","query_hi":"key_123"}
...
```

Each line is a separate JSON object representing one query event. Backend skips any malformed lines and logs a warning.

### Query Flow Example

User clicks filter dropdown: filter_type = "bloom"
    ↓
FilterBar onChange calls App's handleFilterChange
    ↓
App.state.filters = { filter_type: "bloom", ..., limit: 500 }
    ↓
useEffect dependency triggers (filters changed)
    ↓
App calls fetchEvents(filters)
    ↓
Frontend makes: GET /api/events?filter_type=bloom&limit=500
    ↓
Vite proxy forwards to: http://localhost:3001/api/events?filter_type=bloom&limit=500
    ↓
Backend routes.js handles request, filters events, returns array
    ↓
Frontend receives response, updates state.events
    ↓
All components re-render with filtered data
    ↓
EventTable shows only Bloom filter events
    ↓
SummaryCards recalculates aggregates (via computeFilterTypeStats)
    ↓
ComparisonCharts re-draw with new data

## Testing & Validation

### Backend
- Metrics file parsing: Test with sample JSONL, check event count matches
- API endpoints: `curl http://localhost:3001/api/{health,meta,summary,events}`
- Filtering: Send query strings, verify correct events returned

### Frontend
- Loading state: Stop backend, verify error message
- Filtering: Change dropdowns, verify table/charts update
- Polling: Watch console, verify 2-second API calls
- Charts: Resize browser, verify responsive rendering
- Badges: Verify colors match filter types

## Future Enhancements

1. **Backend**:
   - Add caching/memoization for frequently queried filters
   - Support incremental updates (append-only JSONL file)
   - Add CSV/JSON export of summary or events
   - Add comparison across multiple metrics files

2. **Frontend**:
   - Add date range filters (if timestamp data exists)
   - Export chart images (PNG/SVG)
   - Add custom statistical comparisons (Student's t-test, effect size)
   - Persist filter selections to URL query params
   - Dark mode toggle

3. **Both**:
   - Add WebSocket support for real-time streaming
   - Generate automatic benchmark reports (PDF)
   - Add alert thresholds (e.g., if false positive rate > X%)

## Troubleshooting

### "Backend server not responding"
- Check backend is running: `PORT=3001 && npm start`
- Check metrics file exists: `echo $METRICS_FILE` and verify file path
- Check CORS is enabled (should be in server.js)

### Charts not rendering
- Open browser DevTools (F12) console for Recharts errors
- Verify filtered events exist: Check EventTable has data
- Check events have required fields (latency_us, filter_type, etc.)

### No data appears in table
- Check FilterBar filter values - may be filtering out all events
- Verify metrics file was generated with all benchmarks/filters
- Reset filters to "all" and check if any events appear

### Slow performance with many events
- Reduce limit in FilterBar (max 10000 at a time)
- Frontend throttles polling to 2-second intervals
- Backend loads entire file into memory (OK for <100K events)

## References

- Backend README: `dashboard-server/README.md`
- Frontend README: `dashboard-ui/README.md`
- Setup Guide: `DASHBOARD_SETUP.md`
- Metrics Collection: `project/notes/week_2_surf_filter_implementation.md`
