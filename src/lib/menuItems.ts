/** Explicit finite menu options. The native host resolves each tag's current
 * same-window bounds; JavaScript owns actions and retained close lifetimes. */
export interface MenuItemRecord {
  id: string;
  tag: number;
  enabled: boolean;
  selected: boolean;
  keepOpen: boolean;
  fullWidth?: boolean;
}
export interface MenuItemSelection { sessionId: number; rowId: string; gestureId: number }
interface Item extends Omit<MenuItemRecord, 'tag'> { tag: number | null; action: () => void; owner: object }
const EMPTY: readonly MenuItemRecord[] = [];
const MAX_ITEMS = 256;

/** One registry owned by its mounted surface, never a global view/action map.
 * Native drag descriptors are bounded; additional mounted rows keep the same
 * guarded ordinary press path and are removed with their component. */
export class MenuItemRegistry {
  private items = new Map<string, Item>();
  private snapshot: readonly MenuItemRecord[] = EMPTY;
  private listeners = new Set<() => void>();
  private session = 0;
  private open = false;
  private selecting = false;
  private lastGesture = 0;
  private alive = true;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  setSession(session: number, open: boolean) {
    this.alive = true;
    if (session !== this.session) { this.session = session; this.selecting = false; this.lastGesture = 0; }
    this.open = open;
    if (!open) this.selecting = true;
  }
  register(id: string, owner: object, item: Omit<Item, 'id' | 'owner'>) {
    const preceding = this.items.get(id);
    if (preceding && preceding.owner !== owner) return;
    this.items.set(id, { ...item, id, owner });
    if (!preceding || preceding.tag !== item.tag || preceding.enabled !== item.enabled ||
      preceding.selected !== item.selected || preceding.keepOpen !== item.keepOpen || preceding.fullWidth !== item.fullWidth) this.publish();
  }
  unregister(id: string, owner: object) {
    if (this.items.get(id)?.owner !== owner) return;
    this.items.delete(id);
    this.publish();
  }
  /** Normal/accessibility activation shares the exact action and once gate. */
  press(id: string, owner: object) {
    const item = this.items.get(id);
    return item?.owner === owner ? this.activate(item) : false;
  }
  select(event: MenuItemSelection) {
    if (!event || event.sessionId !== this.session || !Number.isSafeInteger(event.gestureId) ||
      event.gestureId <= this.lastGesture || event.gestureId <= 0) return false;
    const item = this.items.get(event.rowId);
    if (!item || !this.canActivate(item)) return false;
    this.lastGesture = event.gestureId;
    return this.activate(item);
  }
  dispose() { this.alive = false; this.open = false; this.items.clear(); this.snapshot = EMPTY; this.listeners.clear(); }
  private canActivate(item: Item) { return this.alive && this.open && !this.selecting && item.enabled; }
  private activate(item: Item) {
    if (!this.canActivate(item)) return false;
    // A submenu/preview explicitly keeps the transaction interactive. Closing
    // actions latch before running user code, including synchronous rerenders.
    if (!item.keepOpen) this.selecting = true;
    item.action();
    return true;
  }
  private publish() {
    const next: MenuItemRecord[] = [];
    for (const { id, tag, enabled, selected, keepOpen, fullWidth } of this.items.values()) {
      if (tag == null || tag <= 0) continue;
      next.push({ id, tag, enabled, selected, keepOpen, fullWidth });
      if (next.length === MAX_ITEMS) break;
    }
    if (next.length === this.snapshot.length && next.every((item, i) => {
      const old = this.snapshot[i];
      return item.id === old.id && item.tag === old.tag && item.enabled === old.enabled &&
        item.selected === old.selected && item.keepOpen === old.keepOpen && item.fullWidth === old.fullWidth;
    })) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
