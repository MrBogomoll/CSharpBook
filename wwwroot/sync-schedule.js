export const syncIntervals = [1, 5, 15, 30, 60];

export function syncPreferences(value) {
  return {
    onChange: value?.onChange !== false,
    timer: value?.timer === true,
    minutes: syncIntervals.includes(value?.minutes) ? value.minutes : 5
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
    this.period = connected && preferences.timer ? preferences.minutes * 60000
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
