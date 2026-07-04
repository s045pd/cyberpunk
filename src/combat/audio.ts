import { WeaponId } from './weapons';

/** WebAudio 程序化音效：零外部资产，首次用户手势后惰性解锁 */
export class CombatAudio {
  private ctx: AudioContext | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenLfo: OscillatorNode | null = null;

  /** 需在用户手势回调里调用（点击/按键） */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noiseBurst(
    dur: number, freq: number, gainV: number, type: BiquadFilterType = 'lowpass',
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.max(Math.floor(ctx.sampleRate * dur), 1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = gainV;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  private beep(freq: number, dur: number, gainV: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainV, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  shot(id: WeaponId): void {
    if (id === 'fist') this.noiseBurst(0.06, 500, 0.15);
    else if (id === 'pistol') this.noiseBurst(0.12, 1600, 0.3);
    else if (id === 'smg') this.noiseBurst(0.07, 2200, 0.2, 'bandpass');
    else this.noiseBurst(0.22, 700, 0.4);
  }

  hitFlesh(): void { this.noiseBurst(0.05, 400, 0.18); }
  hitWall(): void { this.noiseBurst(0.04, 3000, 0.1, 'highpass'); }
  reload(): void { this.beep(220, 0.05, 0.12); this.beep(330, 0.05, 0.12); }
  hurt(): void { this.beep(90, 0.25, 0.25); }
  flatline(): void { this.beep(660, 1.2, 0.2); }

  siren(on: boolean): void {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const gain = this.ctx.createGain();
      osc.frequency.value = 700;
      lfo.frequency.value = 0.6;
      lfoGain.gain.value = 250;
      gain.gain.value = 0.03;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      lfo.start();
      this.sirenOsc = osc;
      this.sirenLfo = lfo;
    } else if (!on && this.sirenOsc) {
      this.sirenOsc.stop();
      this.sirenLfo?.stop();
      this.sirenOsc = null;
      this.sirenLfo = null;
    }
  }
}
