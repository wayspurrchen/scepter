/**
 * Filesystem adapter for verification event persistence.
 *
 * Wraps the existing loadVerificationStore/saveVerificationStore functions,
 * capturing the dataDir at construction time instead of passing it to every call.
 *
 * @implements {A002.§3.AC.03} Filesystem adapter for VerificationStorage
 * @implements {DD010.§DC.12} FilesystemVerificationStorage wraps existing functions
 */

import type { VerificationStorage } from '../storage-backend';
import type { VerificationStore } from '../../claims/verification-store';
import {
  loadVerificationStore,
  saveVerificationStore,
} from '../../claims/verification-store';

export class FilesystemVerificationStorage implements VerificationStorage {
  constructor(private dataDir: string) {}

  async load(): Promise<VerificationStore> {
    return loadVerificationStore(this.dataDir);
  }

  async save(store: VerificationStore): Promise<void> {
    return saveVerificationStore(this.dataDir, store);
  }
}
