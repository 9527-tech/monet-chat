/**
 * Haptic feedback helper.
 *
 * Uses the native Capacitor Haptics engine on Android/iOS and the Vibration
 * API on the web. Every call is best-effort: missing hardware or denied
 * permission must never break the interaction.
 */

const native = () => !!window.Capacitor?.isNativePlatform?.();
const plugin = () => window.Capacitor?.Plugins?.Haptics;
let enabled = true;

export function setHapticsEnabled(value) {
  enabled = value !== false;
}

function webVibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

export const haptics = {
  /** Light tap: tab switch, chip, small icon button. */
  tap() {
    if (!enabled) return;
    const h = plugin();
    if (native() && h) { h.impact({ style: 'LIGHT' }).catch(() => {}); return; }
    webVibrate(6);
  },

  /** Selection tick: toggles, segmented control, list selection. */
  select() {
    if (!enabled) return;
    const h = plugin();
    if (native() && h) { h.selectionChanged?.().catch?.(() => {}); return; }
    webVibrate(8);
  },

  /** Medium impact: send, attach, accept. */
  medium() {
    if (!enabled) return;
    const h = plugin();
    if (native() && h) { h.impact({ style: 'MEDIUM' }).catch(() => {}); return; }
    webVibrate(14);
  },

  /** Heavy impact: long-press, destructive action. */
  heavy() {
    if (!enabled) return;
    const h = plugin();
    if (native() && h) { h.impact({ style: 'HEAVY' }).catch(() => {}); return; }
    webVibrate([18, 30, 18]);
  },

  /** Success notification: message sent, file complete. */
  success() {
    if (!enabled) return;
    const h = plugin();
    if (native() && h) { h.notification({ type: 'SUCCESS' }).catch(() => {}); return; }
    webVibrate([10, 40, 10]);
  },

  /** Warning/error notification. */
  warn() {
    if (!enabled) return;
    const h = plugin();
    if (native() && h) { h.notification({ type: 'WARNING' }).catch(() => {}); return; }
    webVibrate([20, 40, 20, 40, 20]);
  },
};

export default haptics;
