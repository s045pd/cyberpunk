// rAF 在后台标签页会被冻结，用 setTimeout 兜底保证 boot 不被卡死
const nextFrame = () => new Promise<void>((resolve) => {
  const to = setTimeout(() => { cancelAnimationFrame(id); resolve(); }, 120);
  const id = requestAnimationFrame(() => { clearTimeout(to); resolve(); });
});

export class BootScreen {
  private root: HTMLDivElement;
  private barEl: HTMLDivElement;
  private labelEl: HTMLDivElement;
  private button: HTMLButtonElement;
  private done = 0;

  constructor(overlay: HTMLElement, private totalSteps: number) {
    this.root = document.createElement('div');
    this.root.className = 'boot';
    this.root.innerHTML = `
      <div class="boot-title" data-text="NIGHT CITY">NIGHT CITY</div>
      <div class="boot-sub">夜之城 // 全尺寸重建 · 非官方粉丝作品</div>
      <div class="boot-bar"><div class="boot-bar-fill"></div></div>
      <div class="boot-label">INITIALIZING…</div>
      <button class="boot-start" disabled>JACK IN</button>
    `;
    overlay.appendChild(this.root);
    this.barEl = this.root.querySelector<HTMLDivElement>('.boot-bar-fill')!;
    this.labelEl = this.root.querySelector<HTMLDivElement>('.boot-label')!;
    this.button = this.root.querySelector<HTMLButtonElement>('.boot-start')!;
  }

  /** 执行一个生成步骤并推进进度条（步骤间让出两帧渲染进度） */
  async step<T>(label: string, fn: () => T): Promise<T> {
    this.labelEl.textContent = label;
    await nextFrame();
    await nextFrame();
    const result = fn();
    this.done++;
    this.barEl.style.width = `${(this.done / this.totalSteps) * 100}%`;
    return result;
  }

  waitForStart(): Promise<void> {
    this.labelEl.textContent = 'READY';
    this.button.disabled = false;
    return new Promise((resolve) => {
      this.button.addEventListener('click', () => {
        this.root.classList.add('boot-out');
        setTimeout(() => this.root.remove(), 700);
        resolve();
      }, { once: true });
    });
  }
}
