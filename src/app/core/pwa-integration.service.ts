import { Injectable, signal } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class PwaIntegrationService {
  readonly enabled = signal(false);
  readonly loading = signal(true);
  constructor() {
    // Fail closed: this file is enabled only with the complete release configuration.
    void fetch('/pwa-integration.json', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(value => this.enabled.set(value?.enabled === true)).catch(() => this.enabled.set(false)).finally(() => this.loading.set(false));
  }
}
