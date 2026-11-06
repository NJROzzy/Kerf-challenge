import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import { exportMeasurements } from './export';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./api', () => ({ api: { exportCsv: vi.fn() } }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('browser CSV download', () => {
  it('restores a UTF-8 BOM stripped by fetch and releases the blob URL', async () => {
    vi.mocked(api.exportCsv).mockResolvedValue('"Project"\r\n"Café"\r\n');
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => { blob = value; return 'blob:test'; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    await exportMeasurements('metric');
    expect(api.exportCsv).toHaveBeenCalledWith('metric', undefined);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toMatch(/\.csv$/);
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    expect(new TextDecoder().decode(bytes)).toContain('Café');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
  it('propagates export failures so the screen can show an error', async () => {
    vi.mocked(api.exportCsv).mockRejectedValueOnce(new Error('Offline'));
    await expect(exportMeasurements('metric')).rejects.toThrow('Offline');
  });
});
