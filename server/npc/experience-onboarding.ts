import type {DatabaseSync} from 'node:sqlite';
import {OpeningService} from './opening-service';

/** Successful new registration only. Existing and legacy owners never get v2 replay. */
export function initializeNewAccountOpening(db: DatabaseSync, root: string, owner: string, now: number, claimedLegacy = false): boolean {
  return new OpeningService(db, root, () => now).initializeRegistration(owner, claimedLegacy);
}
