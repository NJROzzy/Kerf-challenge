import { formatValue, type Unit } from '@kerf/shared';
import { Router } from 'express';

import type { Db } from '../db';
import { FEED_SELECT, toFeedItem } from './feed';

// Quoting is required for CSV syntax; an apostrophe also neutralizes spreadsheet formulas.
export function csvText(value: string) {
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportRouter(db: Db) {
  const router = Router();
  router.get(['/export.csv', '/projects/:id/export.csv'], (req, res) => {
    const projectId = req.params.id === undefined ? undefined : Number(req.params.id);
    const unit = req.query.unit ?? 'metric';
    if (!['metric', 'decimal', 'fractional'].includes(unit as string)) {
      res.status(400).json({ error: 'Invalid display unit.' });
      return;
    }
    if (projectId !== undefined && (!Number.isSafeInteger(projectId) || !db.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?',
    ).get(projectId, req.userId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const rows = db.prepare(`${FEED_SELECT} ${projectId === undefined ? '' : 'AND p.id = ?'} ORDER BY m.id ASC`)
      .all(...(projectId === undefined ? [req.userId] : [req.userId, projectId]));
    const header = ['Project', 'Group', 'Label', 'Measurement (mm)', 'Measurement (inches)',
      'Display measurement', 'Captured by', 'Device', 'Captured at (UTC)', 'Measurement ID'];
    const lines = [header.map(csvText).join(',')];
    for (const raw of rows) {
      const m = toFeedItem(raw as unknown as Parameters<typeof toFeedItem>[0]);
      lines.push([
        csvText(m.projectName), csvText(m.groupName), csvText(m.label), String(m.value), String(m.value / 25.4),
        csvText(formatValue(m.value, unit as Unit)), csvText(m.capturedBy), csvText(m.deviceId),
        csvText(new Date(m.createdAt).toISOString()), String(m.id),
      ].join(','));
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="kerf-measurements.csv"',
    });
    // UTF-8 BOM and CRLF let Excel recognize Unicode and embedded line breaks.
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  });
  return router;
}
