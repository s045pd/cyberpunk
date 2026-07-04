import { ElevatorZone } from './lobbies';
import { WalkControls } from '../controls/walkControls';
import { Hud } from '../ui/hud';

const RIDE_MIN_SPEED = 10;   // 米/秒
const CELL = 64;

type RideState =
  | { phase: 'idle' }
  | { phase: 'riding'; zone: ElevatorZone; targetY: number; speed: number };

/**
 * 玻璃观光电梯：站进大堂电梯位按 E 直达天台（可越过楼体看城市），
 * 天台范围内自由走动，回到电梯位再按 E 返回地面。
 */
export class ElevatorSystem {
  private grid = new Map<string, ElevatorZone[]>();
  private state: RideState = { phase: 'idle' };
  private ePressed = false;

  constructor(
    zones: ElevatorZone[],
    private walk: WalkControls,
    private hud: Hud,
  ) {
    for (const z of zones) {
      const cx = Math.floor((z.aabb.minX + z.aabb.maxX) / 2 / CELL);
      const cz = Math.floor((z.aabb.minZ + z.aabb.maxZ) / 2 / CELL);
      const key = `${cx},${cz}`;
      const list = this.grid.get(key) ?? [];
      list.push(z);
      this.grid.set(key, list);
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') this.ePressed = true;
    });
  }

  private zoneAt(x: number, z: number): ElevatorZone | null {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const zone of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (x >= zone.aabb.minX && x <= zone.aabb.maxX
            && z >= zone.aabb.minZ && z <= zone.aabb.maxZ) return zone;
        }
      }
    }
    return null;
  }

  update(dt: number, camX: number, camZ: number): void {
    const pressed = this.ePressed;
    this.ePressed = false;

    if (!this.walk.enabled) {
      if (this.state.phase === 'idle') this.hud.setHint('');
      return;
    }

    if (this.state.phase === 'riding') {
      const { zone, targetY, speed } = this.state;
      const dy = targetY - this.walk.baseY;
      const step = speed * dt;
      if (Math.abs(dy) <= step) {
        this.walk.baseY = targetY;
        if (targetY > 0) {
          this.walk.bounds = zone.roof;       // 抵达天台
          this.hud.setHint('天台 · 回到电梯位按 E 返回地面');
        } else {
          this.walk.bounds = null;            // 回到地面
          this.hud.setHint('');
        }
        this.state = { phase: 'idle' };
      } else {
        this.walk.baseY += Math.sign(dy) * step;
        this.hud.setHint(dy > 0 ? '电梯上行…' : '电梯下行…');
      }
      return;
    }

    const zone = this.zoneAt(camX, camZ);
    if (!zone) {
      this.hud.setHint('');
      return;
    }
    const onRoof = this.walk.baseY > 0;
    this.hud.setHint(onRoof ? '按 E 下行至大堂' : '按 E 乘观光电梯上天台');
    if (pressed) {
      const targetY = onRoof ? 0 : zone.h;
      this.state = {
        phase: 'riding',
        zone,
        targetY,
        speed: Math.max(RIDE_MIN_SPEED, Math.abs(targetY - this.walk.baseY) / 5),
      };
      this.walk.bounds = zone.aabb;   // 乘梯时锁在轿厢范围
    }
  }
}
