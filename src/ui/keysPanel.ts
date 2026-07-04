interface KeyRow {
  keys: string;
  desc: string;
}

interface KeyGroup {
  title: string;
  rows: KeyRow[];
}

const GROUPS: KeyGroup[] = [
  {
    title: '通用',
    rows: [
      { keys: '点击画面', desc: '锁定鼠标视角（Esc 解锁后才能点按钮）' },
      { keys: 'F', desc: '降落到街道 / 起飞' },
      { keys: 'M', desc: '小地图（场所色点 · 事件红点）' },
      { keys: 'H', desc: '打开 / 关闭本面板' },
    ],
  },
  {
    title: '飞行模式',
    rows: [
      { keys: 'W A S D', desc: '平移' },
      { keys: 'Q / E', desc: '下降 / 上升' },
      { keys: 'Shift', desc: '×5 加速' },
    ],
  },
  {
    title: '漫游模式',
    rows: [
      { keys: 'W A S D', desc: '行走' },
      { keys: 'Shift', desc: '疾跑' },
      { keys: 'E', desc: '大堂电梯位：乘观光电梯上天台 / 返回' },
    ],
  },
  {
    title: '战斗（漫游中）',
    rows: [
      { keys: '鼠标左键', desc: '开火（长按连发）' },
      { keys: '1 / 2 / 3 / 4', desc: '拳头 / 手枪 / 冲锋枪 / 霓虹霰弹' },
      { keys: '滚轮', desc: '切换武器' },
      { keys: 'R', desc: '换弹' },
    ],
  },
];

/** 右下角"按键"按钮 + H 键：开关快捷键速查面板 */
export class KeysPanel {
  private panel: HTMLDivElement;
  private button: HTMLButtonElement;
  private visible = false;

  constructor(overlay: HTMLElement) {
    this.button = document.createElement('button');
    this.button.className = 'keys-btn';
    this.button.textContent = '⌨ 按键 H';
    overlay.appendChild(this.button);

    this.panel = document.createElement('div');
    this.panel.className = 'keys-panel';
    this.panel.innerHTML = `
      <div class="keys-title">操作速查 // CONTROLS</div>
      ${GROUPS.map((g) => `
        <div class="keys-group">
          <div class="keys-group-title">${g.title}</div>
          ${g.rows.map((r) => `
            <div class="keys-row">
              <span class="keys-key">${r.keys}</span>
              <span class="keys-desc">${r.desc}</span>
            </div>`).join('')}
        </div>`).join('')}
      <div class="keys-close">按 H 或点击任意处关闭</div>
    `;
    overlay.appendChild(this.panel);

    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.panel.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('on', this.visible);
  }
}
