export const syncIntervals = [1, 5, 15, 30, 60];
const maxCustomMinutes = 99 * 60 + 59;

export function validIntervalPart(value, maximum) {
  return /^\d+$/.test(value) && Number(value) <= maximum;
}

export function parseCustomInterval(hours, minutes) {
  if (!validIntervalPart(hours, 99) || !validIntervalPart(minutes, 59)) return null;
  const total = Number(hours) * 60 + Number(minutes);
  return total || null;
}

export function syncPreferences(value) {
  const customMinutes = value?.customMinutes;
  const hasCustom = Number.isInteger(customMinutes) && customMinutes > 0 && customMinutes <= maxCustomMinutes;
  const preset = syncIntervals.includes(value?.minutes) ? value.minutes : 5;
  return {
    onChange: value?.onChange !== false,
    timer: value?.timer === true,
    minutes: value?.minutes === 'custom' && hasCustom ? 'custom' : preset,
    ...(hasCustom ? {customMinutes} : {})
  };
}

// A single alarm serves local edits and remote checks. Keeping their deadlines
// separate prevents continuous typing from postponing a scheduled exchange.
export class SyncSchedule {
  constructor(run) {
    this.run = run;
    this.changeAt = this.pollAt = Infinity;
    this.period = Infinity;
    this.available = false;
  }

  configure(connected, preferences, lastCheck = Date.now()) {
    this.onChange = connected && preferences.onChange;
    const minutes = preferences.minutes === 'custom' ? preferences.customMinutes : preferences.minutes;
    this.period = connected && preferences.timer ? minutes * 60000
      : this.onChange ? 90000 : Infinity;
    this.changeAt = Infinity;
    this.pollAt = Math.min(lastCheck, Date.now()) + this.period;
    this.arm();
  }

  setAvailable(available) {
    this.available = available;
    this.arm();
  }

  changed(delay = 1800) {
    if (!this.onChange) return;
    this.changeAt = Date.now() + delay;
    this.arm();
  }

  begin() {
    this.changeAt = Infinity;
    this.setAvailable(false);
  }

  finish(retryOnReconnect = false) {
    const delay = retryOnReconnect && Number.isFinite(this.period) ? 0 : this.period;
    this.pollAt = Date.now() + delay;
  }

  arm() {
    clearTimeout(this.alarm);
    const due = Math.min(this.changeAt, this.pollAt);
    if (this.available && Number.isFinite(due)) {
      this.alarm = setTimeout(this.run, Math.max(0, due - Date.now()));
    }
  }
}
