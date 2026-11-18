import type { ComponentProps } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import type Animated from 'react-native-reanimated';
import type { MenuOriginRect } from './menuOrigin';
import { menuPresentations, type MenuPresentationRegistry } from './menuPresentation';

export type MenuMorphEvent = NativeSyntheticEvent<{ sessionId: number; open: boolean }>;
export interface MenuMorphController {
  sessionId: number;
  open: boolean;
  ready: boolean;
  sourceRect: MenuOriginRect | null;
  /** Same retained lifecycle on platforms without the Android native host. */
  fallbackStyle?: ComponentProps<typeof Animated.View>['style'];
  onMotionStart: (event: MenuMorphEvent) => void;
  onMotionComplete: (event: MenuMorphEvent) => void;
  onLayoutReady: () => void;
}

let nextSession = 0;
/** Bounded scalar identity, independent of the entity being shown or its title. */
function sessionId() {
  nextSession = nextSession % 0x1ffffffe + 1;
  return nextSession;
}

/** Native completion belongs to one presentation; a late exit cannot close a
 * replacement menu or run its old destructive/navigation callback. */
export class MenuMorphSession {
  id = 0;
  phase: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  private after: (() => void) | undefined;
  private readonly presentations: MenuPresentationRegistry;

  constructor(presentations: MenuPresentationRegistry = menuPresentations) {
    this.presentations = presentations;
  }

  begin(): number {
    this.id = sessionId();
    this.phase = 'opening';
    this.after = undefined;
    this.presentations.begin(this, this.id);
    return this.id;
  }
  close(after?: unknown): boolean {
    if (this.phase === 'closed' || this.phase === 'closing') return false;
    this.after = typeof after === 'function' ? after as () => void : undefined;
    this.phase = 'closing';
    return true;
  }
  complete(id: number, open: boolean): boolean {
    if (id !== this.id) return false;
    if (open) {
      if (this.phase !== 'opening') return false;
      this.phase = 'open';
      return true;
    }
    if (this.phase !== 'closing') return false;
    this.phase = 'closed';
    const after = this.after;
    this.after = undefined;
    this.presentations.end(this, id);
    after?.();
    return true;
  }
  invalidate(): void {
    const previous = this.id;
    this.id = sessionId();
    this.phase = 'closed';
    this.after = undefined;
    this.presentations.end(this, previous);
  }
}
