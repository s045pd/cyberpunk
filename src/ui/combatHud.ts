export class CombatHud {
  private root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private hpEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private starsEl: HTMLDivElement;
  private flatEl: HTMLDivElement;
  private markerTimer = 0;

  constructor(overlay: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'chud';
    this.root.innerHTML = `
      <div class="chud-crosshair"></div>
      <div class="chud-ammo"></div>
      <div class="chud-hp"><div class="chud-hp-fill"></div></div>
      <div class="chud-stars"></div>
      <div class="chud-flatlined">FLATLINED<span>// 重新接入中…</span></div>
    `;
    overlay.appendChild(this.root);
    this.crosshair = this.root.querySelector<HTMLDivElement>('.chud-crosshair')!;
    this.ammoEl = this.root.querySelector<HTMLDivElement>('.chud-ammo')!;
    this.hpEl = this.root.querySelector<HTMLDivElement>('.chud-hp')!;
    this.hpFill = this.root.querySelector<HTMLDivElement>('.chud-hp-fill')!;
    this.starsEl = this.root.querySelector<HTMLDivElement>('.chud-stars')!;
    this.flatEl = this.root.querySelector<HTMLDivElement>('.chud-flatlined')!;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? 'block' : 'none';
  }

  setAmmo(name: string, cur: number, reloading: boolean): void {
    this.ammoEl.textContent = Number.isFinite(cur)
      ? `${name} ${reloading ? '换弹…' : `${cur}/∞`}`
      : name;
  }

  setHp(hp: number): void {
    this.hpFill.style.width = `${Math.max(hp, 0)}%`;
    this.hpEl.classList.toggle('low', hp < 35);
  }

  setWanted(stars: number): void {
    const text = '★'.repeat(stars);
    if (this.starsEl.textContent !== text) this.starsEl.textContent = text;
  }

  hitMarker(killed: boolean): void {
    this.crosshair.classList.remove('hit', 'kill');
    void this.crosshair.offsetWidth; // 重启动画
    this.crosshair.classList.add(killed ? 'kill' : 'hit');
    this.markerTimer = 0.2;
  }

  showFlatlined(on: boolean): void {
    this.flatEl.classList.toggle('on', on);
  }

  update(dt: number): void {
    if (this.markerTimer > 0) {
      this.markerTimer -= dt;
      if (this.markerTimer <= 0) this.crosshair.classList.remove('hit', 'kill');
    }
  }
}
