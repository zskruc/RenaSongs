/** One lease per mounted menu owner. Closing still owns its window until the
 * matching native/fallback completion; an old completion cannot release a new
 * presentation or a different overlapping menu. */
export class MenuPresentationRegistry {
  private readonly owners = new Map<object, number>();
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): boolean => this.owners.size > 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  begin(owner: object, sessionId: number): void {
    if (this.owners.get(owner) === sessionId) return;
    const wasActive = this.getSnapshot();
    this.owners.set(owner, sessionId);
    if (!wasActive) this.emit();
  }

  end(owner: object, sessionId: number): boolean {
    if (this.owners.get(owner) !== sessionId) return false;
    this.owners.delete(owner);
    if (!this.getSnapshot()) this.emit();
    return true;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const menuPresentations = new MenuPresentationRegistry();
