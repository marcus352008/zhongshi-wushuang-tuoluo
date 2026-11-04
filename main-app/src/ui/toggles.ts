import type { AppState, Settings } from '../app/state';
import { h } from './dom';

const LABELS: Partial<Record<keyof Settings, string>> = {
  lowGfx: '低畫質',
  muted: '靜音',
  qc: 'QC',
};

/** Global toggles in the top-right corner (graphics, mute, QC). */
export function mountToggles(root: HTMLElement, app: AppState, keys: (keyof Settings)[]): void {
  const render = () => {
    root.replaceChildren(
      ...keys.map((k) =>
        h(
          'button.toggle',
          {
            'aria-pressed': String(app.settings[k]),
            onclick: (e: Event) => {
              (e.currentTarget as HTMLElement).blur();
              app.set(k, !app.settings[k]);
            },
          },
          `${LABELS[k] ?? k}${k === 'qc' ? '' : app.settings[k] ? '：開' : '：關'}`,
        ),
      ),
    );
  };
  app.onChange(render);
  render();
}
