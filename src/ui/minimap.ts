import { GANGS } from '../people/gangs';
import { DISTRICTS, CITY_SIZE } from '../city/districts';
import { ViolenceEvent } from '../events/violence';

export interface MinimapVenue {
  x: number;
  z: number;
  color: number;
}

const SIZE = 256;
const RANGE = 420;        // 地图覆盖半径（米）
const REDRAW_HZ = 4;

/** M 键小地图：路网/帮派地盘晕染/场所色点/事件红点/玩家箭头 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  private acc = 0;

  constructor(overlay: HTMLElement, private venues: MinimapVenue[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.className = 'minimap';
    overlay.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.classList.toggle('on', this.visible);
  }

  update(
    dt: number, px: number, pz: number, yaw: number, events: ViolenceEvent[],
  ): void {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 1 / REDRAW_HZ) return;
    this.acc = 0;

    const c = this.ctx;
    const toMap = (wx: number, wz: number): [number, number] => [
      SIZE / 2 + ((wx - px) / RANGE) * (SIZE / 2),
      SIZE / 2 + ((wz - pz) / RANGE) * (SIZE / 2),
    ];

    c.fillStyle = 'rgba(5, 6, 10, 0.88)';
    c.fillRect(0, 0, SIZE, SIZE);

    // 帮派地盘晕染
    for (const g of GANGS) {
      const d = DISTRICTS.find((dd) => dd.id === g.district)!;
      c.fillStyle = `#${g.color.toString(16).padStart(6, '0')}18`;
      c.beginPath();
      d.polygon.forEach(([nx, ny], i) => {
        const [mx, my] = toMap((nx - 0.5) * CITY_SIZE, (ny - 0.5) * CITY_SIZE);
        if (i === 0) c.moveTo(mx, my);
        else c.lineTo(mx, my);
      });
      c.closePath();
      c.fill();
    }

    // 路网
    c.strokeStyle = 'rgba(120, 160, 180, 0.5)';
    c.lineWidth = 1;
    for (let k = -6; k <= 6; k++) {
      const v = k * 480;
      const [x1] = toMap(v, 0);
      const [, y1] = toMap(0, v);
      c.beginPath(); c.moveTo(x1, 0); c.lineTo(x1, SIZE); c.stroke();
      c.beginPath(); c.moveTo(0, y1); c.lineTo(SIZE, y1); c.stroke();
    }

    // 场所色点（范围内）
    for (const v of this.venues) {
      if (Math.abs(v.x - px) > RANGE || Math.abs(v.z - pz) > RANGE) continue;
      const [mx, my] = toMap(v.x, v.z);
      c.fillStyle = `#${v.color.toString(16).padStart(6, '0')}`;
      c.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }

    // 事件红点（闪烁）
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    for (const e of events) {
      const [mx, my] = toMap(e.x, e.z);
      if (mx < 0 || mx > SIZE || my < 0 || my > SIZE) continue;
      c.fillStyle = blink ? '#ff2030' : '#801018';
      c.beginPath();
      c.arc(mx, my, 4, 0, Math.PI * 2);
      c.fill();
    }

    // 玩家箭头
    c.save();
    c.translate(SIZE / 2, SIZE / 2);
    c.rotate(-yaw + Math.PI);
    c.fillStyle = '#fcee0a';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();
  }
}
