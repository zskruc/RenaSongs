import { create } from 'zustand';
export interface RepeatSection { profile: string; songId: string; start: number; end: number; }
export const useRepeatSection = create<{ section: RepeatSection | null }>(() => ({ section: null }));
export function validRepeatSection(start: number, end: number, duration?: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end - start >= 1 && (!duration || end <= duration + .01);
}
export function playbackClock(value: string): number | undefined {
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value.trim())) return undefined;
  const parts=value.trim().split(':').map(Number);if(parts.length>1&&parts.slice(1).some(part=>part>=60))return undefined;
  const seconds=parts.reduce((total,part)=>total*60+part,0);return Number.isFinite(seconds)?seconds:undefined;
}
