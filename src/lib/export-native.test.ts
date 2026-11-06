import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import { exportMeasurements } from './export';

const mocks = vi.hoisted(() => ({
  write: vi.fn(async (_text: string) => {}), remove: vi.fn(),
  share: vi.fn(async () => {}), available: vi.fn(async () => true), entries: [] as unknown[],
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./api', () => ({ api: { exportCsv: vi.fn(async () => '"Project"\r\n"Kitchen"\r\n') } }));
vi.mock('expo-file-system', () => ({
  File: class {
    name: string;
    uri: string;
    constructor(_parent: unknown, name: string) { this.name = name; this.uri = `file:///cache/${name}`; }
    write = mocks.write;
    delete = mocks.remove;
  },
  Directory: class {
    create() {}
    list() { return mocks.entries; }
  },
  Paths: { cache: 'file:///cache' },
}));
vi.mock('expo-sharing', () => ({ shareAsync: mocks.share, isAvailableAsync: mocks.available }));

afterEach(() => { vi.clearAllMocks(); mocks.available.mockResolvedValue(true); });
describe('native CSV file handoff', () => {
  it('writes UTF-8 CSV and leaves the shared file readable after the Android chooser resolves', async () => {
    await exportMeasurements('metric');
    expect(api.exportCsv).toHaveBeenCalledWith('metric', undefined);
    expect(mocks.write).toHaveBeenCalledWith('\uFEFF"Project"\r\n"Kitchen"\r\n');
    expect(mocks.share).toHaveBeenCalledWith(expect.stringMatching(/^file:.*\.csv$/), expect.objectContaining({ mimeType: 'text/csv' }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('shows an actionable failure when native sharing is unavailable', async () => {
    mocks.available.mockResolvedValueOnce(false);
    await expect(exportMeasurements('metric')).rejects.toThrow('Try the browser dashboard');
    expect(mocks.share).not.toHaveBeenCalled();
  });
});
