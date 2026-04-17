# LevelDB Metrics Dashboard UI

A modern React + Vite dashboard for visualizing LevelDB Bloom vs SuRF filter performance metrics.

## Features

- Real-time metrics polling
- Filter by filter type, query type, benchmark name
- Visual comparison charts (Recharts)
- Per-event query trace table
- Event detail inspector
- Responsive design with Tailwind CSS
- Professional UI with lucide-react icons

## Installation

```bash
npm install
```

## Configuration

The dashboard connects to the backend server via proxy configured in `vite.config.ts`:

- Backend API: `http://localhost:3001/api`

If the backend runs on a different port, update `vite.config.ts`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}
```

## Running

Development server:

```bash
npm run dev
```

Dashboard will be available at: `http://localhost:5173`

Build for production:

```bash
npm run build
npm run preview
```

## Usage

1. Ensure backend server is running on `http://localhost:3001`
2. Start the frontend: `npm run dev`
3. Open dashboard in browser: `http://localhost:5173`
4. Use filter controls to drill down into specific metrics
5. Click event rows to expand and view details

## Architecture

```
src/
├── components/       # React components
│   ├── Header.tsx           # Title and metadata
│   ├── FilterBar.tsx        # Filter controls
│   ├── SummaryCards.tsx     # Aggregated metrics
│   ├── ComparisonCharts.tsx # Recharts visualizations
│   ├── EventTable.tsx       # Per-event table
│   ├── EventInspector.tsx   # Selected event details
│   └── LoadingState.tsx     # Loading/error states
├── lib/              # Utilities
│   ├── api.ts              # Backend API calls
│   ├── metrics.ts          # Metric formatting
│   └── utils.ts            # Helper functions
├── types/            # TypeScript types
│   └── metrics.ts          # Data models
├── App.tsx           # Main app component
├── main.tsx          # React entry
└── index.css         # Tailwind + global styles
```

## Components

- **Header**: Displays dashboard title and file metadata
- **FilterBar**: Dropdowns for filtering by filter type, query type, benchmark, and limit
- **SummaryCards**: Shows aggregate metrics and Bloom vs SuRF comparison
- **ComparisonCharts**: Multiple Recharts visualizations (latency, counts, SSTable stats)
- **EventTable**: Scrollable table of per-query events with expandable details
- **EventInspector**: JSON view of selected event
- **LoadingState**: Displays during data fetch

## Data Flow

1. App mounts -> fetch /api/health check
2. Fetch /api/meta (available filters)
3. Fetch /api/summary (aggregated metrics)
4. Fetch /api/events with current filters
5. Poll every 2 seconds for updates
6. On filter change -> fetch new events

## Customization

### Colors

Colors are defined in `src/lib/metrics.ts`:
- `getFilterColor(filter_type)`: Blue for Bloom, Purple for SuRF
- `getQueryTypeColor(query_type)`: Green for point_get, Orange for range_scan, etc.

### Polling Interval

Change polling interval in `src/App.tsx`:

```typescript
const interval = setInterval(loadData, 2000); // 2 seconds
```

### API Endpoints

Add new endpoints in `src/lib/api.ts` as backend grows.

## Troubleshooting

**"Backend server not responding"**
- Ensure backend is running: `npm start` in `dashboard-server/`
- Check port: `PORT=3001 npm start`
- Check METRICS_FILE is set correctly

**No data appears**
- Check browser console for API errors
- Verify metrics file path on backend
- Run backend health check: `curl http://localhost:3001/api/health`

**Build errors**
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Clear Vite cache: `rm -rf .vite`

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires ES2020 support
- Responsive: Desktop, Tablet, Mobile
