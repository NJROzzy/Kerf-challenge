export type Unit = 'fractional' | 'decimal' | 'metric';

export type SyncStatus = 'synced' | 'pending' | 'failed';

export interface User {
  id: number;
  name: string;
}

export interface Project {
  id: number;
  name: string;
  measurementCount: number;
}

export interface Measurement {
  id: number;
  groupId: number;
  value: number;
  label: string;
  deviceId: string;
  createdAt: number;
  createdBy: number;
}

export interface Group {
  id: number;
  projectId: number;
  name: string;
  measurements: Measurement[];
}

export interface NewMeasurement {
  value: number;
  label: string;
  deviceId: string;
  clientId?: string;
}

export interface FeedItem extends Measurement {
  projectId: number;
  projectName: string;
  groupName: string;
  capturedBy: string;
}

export interface Session {
  token: string;
  expiresAt: number;
  user: User;
}

export interface SyncPage {
  items: FeedItem[];
  cursor: number;
  epoch: string;
  reset: boolean;
  hasMore: boolean;
  online: User[];
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'disconnected';
