export type WeaponId = 'fist' | 'pistol' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;        // 单弹丸伤害
  pellets: number;       // 每次开火弹丸数
  magSize: number;       // Infinity = 无弹匣
  fireInterval: number;  // 秒
  reloadTime: number;    // 秒
  spreadDeg: number;     // 散布半角
  range: number;         // 米
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'fist', name: '拳头', damage: 20, pellets: 1, magSize: Infinity,
    fireInterval: 0.5, reloadTime: 0, spreadDeg: 0, range: 2,
  },
  {
    id: 'pistol', name: '手枪', damage: 25, pellets: 1, magSize: 12,
    fireInterval: 0.35, reloadTime: 1.2, spreadDeg: 0.3, range: 180,
  },
  {
    id: 'smg', name: '冲锋枪', damage: 12, pellets: 1, magSize: 30,
    fireInterval: 0.09, reloadTime: 1.6, spreadDeg: 1.2, range: 140,
  },
  {
    id: 'shotgun', name: '霓虹霰弹', damage: 8, pellets: 8, magSize: 6,
    fireInterval: 0.9, reloadTime: 1.8, spreadDeg: 5, range: 15,
  },
];

/** 开火/换弹/切枪状态机（时间由调用方注入，纯逻辑可测） */
export class WeaponState {
  index = 1; // 默认手枪
  private mags = WEAPONS.map((w) => w.magSize);
  private lastFire = -Infinity;
  private reloadEnds = -Infinity;
  private reloadingIdx = -1;

  current(): WeaponDef {
    return WEAPONS[this.index];
  }

  ammo(): number {
    return this.mags[this.index];
  }

  isReloading(now: number): boolean {
    return this.reloadingIdx === this.index && now < this.reloadEnds;
  }

  select(i: number, now: number): void {
    if (i < 0 || i >= WEAPONS.length || i === this.index) return;
    void now;
    this.reloadingIdx = -1; // 切枪打断换弹
    this.index = i;
  }

  canFire(now: number): boolean {
    if (this.isReloading(now)) return false;
    if (now - this.lastFire < this.current().fireInterval) return false;
    return this.mags[this.index] > 0;
  }

  /** 尝试开火：成功则扣弹并返回 true */
  fire(now: number): boolean {
    this.tick(now);
    if (!this.canFire(now)) return false;
    this.lastFire = now;
    if (Number.isFinite(this.mags[this.index])) this.mags[this.index]--;
    return true;
  }

  startReload(now: number): boolean {
    const def = this.current();
    if (!Number.isFinite(def.magSize)) return false;
    if (this.mags[this.index] >= def.magSize) return false;
    if (this.isReloading(now)) return false;
    this.reloadingIdx = this.index;
    this.reloadEnds = now + def.reloadTime;
    return true;
  }

  /** 推进时间：完成到点的换弹 */
  tick(now: number): void {
    if (this.reloadingIdx === this.index && now >= this.reloadEnds
      && this.reloadingIdx >= 0) {
      this.mags[this.index] = this.current().magSize;
      this.reloadingIdx = -1;
    }
  }
}
