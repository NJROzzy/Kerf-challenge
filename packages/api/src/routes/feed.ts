import type { FeedItem } from '@kerf/shared';
import { Router } from 'express';

import type { Db } from '../db';
import { type MeasurementRow, toMeasurement } from '../rows';

export const FEED_SELECT = `
  SELECT m.*, g.project_id, g.name AS group_name, p.name AS project_name, u.name AS captured_by
  FROM measurements m
  JOIN measurement_groups g ON g.id = m.group_id
  JOIN projects p ON p.id = g.project_id
  JOIN project_members pm ON pm.project_id = p.id
  JOIN users u ON u.id = m.created_by
  WHERE pm.user_id = ?
`;

type FeedRow = MeasurementRow & {
  project_id: number; project_name: string; group_name: string; captured_by: string;
};

export function toFeedItem(row: FeedRow): FeedItem {
  return {
    ...toMeasurement(row),
    projectId: row.project_id,
    projectName: row.project_name,
    groupName: row.group_name,
    capturedBy: row.captured_by,
  };
}

export function readFeed(db: Db, userId: number, after?: number, limit = 200) {
  const query = after === undefined
    ? `${FEED_SELECT} ORDER BY m.id DESC LIMIT ?`
    : `${FEED_SELECT} AND m.id > ? ORDER BY m.id ASC LIMIT ?`;
  const rows = db.prepare(query).all(...(after === undefined ? [userId, limit] : [userId, after, limit]));
  return (rows as unknown as FeedRow[]).map(toFeedItem);
}

export function feedRouter(db: Db) {
  const router = Router();
  router.get('/feed', (req, res) => res.json(readFeed(db, req.userId, undefined, 20)));
  return router;
}
