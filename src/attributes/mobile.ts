// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Mobile Attribute Builder
// ═══════════════════════════════════════════════════════════════════
// Collects platform info without requiring any native modules.

import type { LLMSpanAttributes, MobileSystemInfo } from '../types';

/**
 * Builds a flat map of mobile attributes to attach to every span.
 * Skips native module detection to avoid TurboModule errors in dev.
 */
export class MobileAttributeBuilder {
    private readonly system: MobileSystemInfo;

    constructor() {
        this.system = {
            platform: 'ios',
            osVersion: 'unknown',
            appVersion: '',
            deviceModel: '',
        };
    }

    getAttributes(): Partial<LLMSpanAttributes> {
        return {
            'mobile.platform': this.system.platform,
            'mobile.os_version': this.system.osVersion,
        };
    }

    getSystemInfo(): MobileSystemInfo {
        return { ...this.system };
    }
}
