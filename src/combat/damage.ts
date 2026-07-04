export type BodyPart = 'body' | 'head';

export interface DamageResult {
  hp: number;
  died: boolean;
}

const HEAD_MULT = 2;

/** 全民统一血量表：玩家 / 活性 NPC / 人海行人共用 */
export class HealthRegistry {
  private hp = new Map<string, number>();
  private dead = new Set<string>();

  ensure(id: string, max = 100): void {
    if (!this.hp.has(id)) this.hp.set(id, max);
  }

  damage(id: string, amount: number, part: BodyPart): DamageResult {
    this.ensure(id);
    if (this.dead.has(id)) return { hp: 0, died: false };
    const dealt = part === 'head' ? amount * HEAD_MULT : amount;
    const next = Math.max(0, (this.hp.get(id) ?? 0) - dealt);
    this.hp.set(id, next);
    if (next <= 0) {
      this.dead.add(id);
      return { hp: 0, died: true };
    }
    return { hp: next, died: false };
  }

  isDead(id: string): boolean {
    return this.dead.has(id);
  }

  hpOf(id: string): number {
    return this.hp.get(id) ?? 0;
  }

  revive(id: string, hp = 100): void {
    this.hp.set(id, hp);
    this.dead.delete(id);
  }

  remove(id: string): void {
    this.hp.delete(id);
    this.dead.delete(id);
  }
}
