const fs = require('fs');
const path = require('path');

/**
 * Parse JSONL metrics file with error handling
 */
function parseJsonlFile(filePath) {
  let events = [];
  let totalLines = 0;
  let malformedLines = 0;

  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`Metrics file not found: ${filePath}`);
      return { events, totalLines: 0, malformedLines: 0 };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    for (const line of lines) {
      totalLines++;
      try {
        const event = JSON.parse(line);
        events.push(event);
      } catch (err) {
        malformedLines++;
        // Skip malformed lines silently
      }
    }

    console.log(`Loaded ${events.length} events from ${filePath} (${malformedLines} malformed lines skipped)`);
  } catch (err) {
    console.error(`Error reading metrics file: ${err.message}`);
  }

  return { events, totalLines, malformedLines };
}

/**
 * Reload metrics file (for dynamic file changes)
 */
function reloadMetrics(filePath) {
  return parseJsonlFile(filePath);
}

module.exports = {
  parseJsonlFile,
  reloadMetrics,
};
