const DECAY_SEC = 20;
const ESCALATE_AT = 3;
export const MAX_STARS = 2;

/** NCPD 通缉：0-2 星；每降一星需连续 20s 不被任何警员看到 */
export class WantedSystem {
  stars = 0;
  private crimes = 0;
  private lastSeen = -Infinity;

  onCrime(now: number): void {
    this.crimes++;
    this.stars = this.crimes >= ESCALATE_AT ? MAX_STARS : 1;
    this.lastSeen = now;
  }

  /** 警员视线内命中判定时调用 */
  onSeen(now: number): void {
    if (this.stars > 0) this.lastSeen = now;
  }

  tick(now: number): void {
    while (this.stars > 0 && now - this.lastSeen > DECAY_SEC) {
      this.stars--;
      this.lastSeen += DECAY_SEC;
      if (this.stars === 0) this.crimes = 0;
    }
  }

  clear(): void {
    this.stars = 0;
    this.crimes = 0;
    this.lastSeen = -Infinity;
  }
}
