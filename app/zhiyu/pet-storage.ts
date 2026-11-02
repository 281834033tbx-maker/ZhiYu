export type StoredPet = {
  id: string;
  name: string;
  description: string;
  appearance: number;
  imageSrc?: string;
  limited?: boolean;
  limitedRegion?: string;
  limitedCode?: number;
};

export type StoredPetState = {
  pets: StoredPet[];
  selectedId: string;
  visible: boolean;
};

export type DisplayPet = Pick<StoredPet, 'id' | 'name' | 'imageSrc'>;

export const PET_STATE_CHANGED_EVENT = 'zhiyu-pet-state-changed';
export const petStorageKey = (accountId: string) => `zhiyu-pets-v1:${accountId}`;

export function readDisplayedPet(accountId: string): DisplayPet | null {
  try {
    const raw = localStorage.getItem(petStorageKey(accountId));
    if (!raw) return null;
    const state = JSON.parse(raw) as Partial<StoredPetState>;
    if (state.visible === false || !Array.isArray(state.pets) || typeof state.selectedId !== 'string') return null;
    const selected = state.pets.find(pet => pet?.id === state.selectedId);
    if (!selected || typeof selected.name !== 'string' || typeof selected.imageSrc !== 'string') return null;
    return { id: selected.id, name: selected.name, imageSrc: selected.imageSrc };
  } catch {
    return null;
  }
}
