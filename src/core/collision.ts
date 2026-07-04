export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** XZ 平面的静态碰撞网格：圆形角色 vs 轴对齐盒（沿最小穿透轴推出，可贴边滑动） */
export class ColliderGrid {
  private cells = new Map<string, AABB[]>();

  constructor(private cellSize = 64) {}

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  add(box: AABB): void {
    const x0 = Math.floor(box.minX / this.cellSize);
    const x1 = Math.floor(box.maxX / this.cellSize);
    const z0 = Math.floor(box.minZ / this.cellSize);
    const z1 = Math.floor(box.maxZ / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        const list = this.cells.get(k) ?? [];
        list.push(box);
        this.cells.set(k, list);
      }
    }
  }

  /** 返回推出后的 [x, z]（两轮迭代处理角落双盒情况） */
  resolve(x: number, z: number, r: number): [number, number] {
    for (let pass = 0; pass < 2; pass++) {
      const cx = Math.floor(x / this.cellSize);
      const cz = Math.floor(z / this.cellSize);
      let moved = false;
      for (let dx = -1; dx <= 1 && !moved; dx++) {
        for (let dz = -1; dz <= 1 && !moved; dz++) {
          const list = this.cells.get(this.key(cx + dx, cz + dz));
          if (!list) continue;
          for (const b of list) {
            const nx = Math.max(b.minX, Math.min(x, b.maxX));
            const nz = Math.max(b.minZ, Math.min(z, b.maxZ));
            const gx = x - nx;
            const gz = z - nz;
            const distSq = gx * gx + gz * gz;
            if (distSq >= r * r) continue;
            if (distSq > 1e-9) {
              // 圆心在盒外：沿接触法线推出
              const dist = Math.sqrt(distSq);
              x = nx + (gx / dist) * r;
              z = nz + (gz / dist) * r;
            } else {
              // 圆心在盒内：沿最小穿透轴推出
              const pushRight = b.maxX - x + r;
              const pushLeft = x - b.minX + r;
              const pushFar = b.maxZ - z + r;
              const pushNear = z - b.minZ + r;
              const m = Math.min(pushRight, pushLeft, pushFar, pushNear);
              if (m === pushRight) x = b.maxX + r;
              else if (m === pushLeft) x = b.minX - r;
              else if (m === pushFar) z = b.maxZ + r;
              else z = b.minZ - r;
            }
            moved = true;
            break;
          }
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }
}
