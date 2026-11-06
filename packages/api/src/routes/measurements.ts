import type { Group } from '@kerf/shared';
import { Router } from 'express';

import type { Db } from '../db';
import { type MeasurementRow, toMeasurement } from '../rows';

export function measurementsRouter(db: Db, notify: () => void) {
  const router = Router();

  const findProjectForUser = db.prepare(`
    SELECT p.id FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE p.id = ? AND pm.user_id = ?
  `);
  const listGroups = db.prepare(
    'SELECT id, project_id, name FROM measurement_groups WHERE project_id = ? ORDER BY id',
  );
  const listMeasurements = db.prepare(`
    SELECT m.* FROM measurements m
    JOIN measurement_groups g ON g.id = m.group_id
    WHERE g.project_id = ?
    ORDER BY m.created_at, m.id
  `);
  const findGroupForUser = db.prepare(`
    SELECT g.id FROM measurement_groups g
    JOIN project_members pm ON pm.project_id = g.project_id
    WHERE g.id = ? AND pm.user_id = ?
  `);
  const insertMeasurement = db.prepare(`
    INSERT INTO measurements (group_id, value, label, device_id, created_at, created_by, client_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  router.get('/projects/:id/measurements', (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isSafeInteger(projectId) || !findProjectForUser.get(projectId, req.userId)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const groups = listGroups.all(projectId) as { id: number; project_id: number; name: string }[];
    const rows = listMeasurements.all(projectId) as unknown as MeasurementRow[];
    const result: Group[] = groups.map((g) => ({
      id: g.id,
      projectId: g.project_id,
      name: g.name,
      measurements: rows.filter((r) => r.group_id === g.id).map(toMeasurement),
    }));
    res.json(result);
  });

  router.post('/groups/:id/measurements', (req, res) => {
    const groupId = Number(req.params.id);
    if (!Number.isSafeInteger(groupId) || !findGroupForUser.get(groupId, req.userId)) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const { value, label, deviceId, clientId } = req.body ?? {};
    if (!Number.isSafeInteger(value) || value <= 0) {
      res.status(400).json({ error: 'value must be a positive integer' });
      return;
    }
    if (typeof label !== 'string' || !label.trim() || label.length > 200) {
      res.status(400).json({ error: 'Label must contain 1–200 characters.' });
      return;
    }
    if (deviceId !== undefined && (typeof deviceId !== 'string' || deviceId.length > 128)) {
      res.status(400).json({ error: 'Invalid device ID.' });
      return;
    }
    if (clientId !== undefined && (typeof clientId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(clientId))) {
      res.status(400).json({ error: 'Invalid measurement request ID.' });
      return;
    }
    if (clientId) {
      const existing = db.prepare('SELECT * FROM measurements WHERE created_by = ? AND client_id = ?')
        .get(req.userId, clientId) as unknown as MeasurementRow | undefined;
      if (existing) {
        if (existing.group_id !== groupId || existing.value !== value || existing.label !== label.trim() ||
            existing.device_id !== (deviceId ?? 'unknown')) {
          res.status(409).json({ error: 'This request ID was already used for a different measurement.' });
          return;
        }
        res.json(toMeasurement(existing));
        return;
      }
    }
    const row = insertMeasurement.get(
      groupId,
      value,
      label.trim(),
      typeof deviceId === 'string' ? deviceId : 'unknown',
      Date.now(),
      req.userId,
      clientId ?? null,
    ) as unknown as MeasurementRow;
    notify();
    res.status(201).json(toMeasurement(row));
  });

  return router;
}
