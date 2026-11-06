import type { Unit } from '@kerf/shared';
import { Platform } from 'react-native';

import { api } from './api';

export async function exportMeasurements(unit: Unit, projectId?: number) {
  // Fetch text decoding may strip a BOM; restore it for Excel's UTF-8 detection.
  const csv = '\uFEFF' + (await api.exportCsv(unit, projectId)).replace(/^\uFEFF/, '');
  const name = `kerf-measurements-${Date.now()}.csv`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const [{ Directory, File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device. Try the browser dashboard.');
  const folder = new Directory(Paths.cache, 'kerf-exports');
  folder.create({ idempotent: true });
  for (const cached of folder.list()) {
    const timestamp = /^kerf-measurements-(\d+)\.csv$/.exec(cached.name)?.[1];
    if (cached instanceof File && timestamp && Number(timestamp) < Date.now() - 86_400_000) {
      try { cached.delete(); } catch { /* The OS may already have evicted a cache entry. */ }
    }
  }
  const file = new File(folder, name);
  await file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export measurements' });
  // Android's chooser can resolve before the receiving app reads its URI. Keep the
  // cache file available; prune exports older than a day on the next export instead.
}
