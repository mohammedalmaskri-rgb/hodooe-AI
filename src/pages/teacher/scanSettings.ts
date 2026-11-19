import type { Resolution } from '../../camera/camera';
import type { DelegateKind, ModelKind } from '../../vision/detector';

// Scan settings belong to the scanning device (the phone), so they are kept in its local storage.

export interface ScanSettings {
  model: ModelKind;
  delegate: DelegateKind;
  resolution: Resolution;
}

const KEY = 'hodoor.scanSettings';
export const DEFAULT_SCAN_SETTINGS: ScanSettings = { model: 'full', delegate: 'CPU', resolution: '720' };

export function loadScanSettings(): ScanSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      model: raw.model === 'short' ? 'short' : raw.model === 'full' ? 'full' : DEFAULT_SCAN_SETTINGS.model,
      delegate: raw.delegate === 'GPU' ? 'GPU' : 'CPU',
      resolution: raw.resolution === '1080' ? '1080' : '720',
    };
  } catch {
    return DEFAULT_SCAN_SETTINGS;
  }
}

export function saveScanSettings(s: ScanSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
