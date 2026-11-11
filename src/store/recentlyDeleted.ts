import { create } from 'zustand';

/** A notification counter only; deleted documents live in the profile database. */
export const useRecentlyDeleted = create(() => ({ revision: 0 }));
export const notifyRecentlyDeleted = () => useRecentlyDeleted.setState((state) => ({ revision: state.revision + 1 }));
