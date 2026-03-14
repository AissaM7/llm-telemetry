// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — Session Manager
// ═══════════════════════════════════════════════════════════════════
// Manages session ID lifecycle with AsyncStorage persistence.
// Sessions auto-expire after 4 hours of inactivity.

import { generateSessionId } from '../core/id';
import type { SessionData } from '../types';

const STORAGE_KEY = 'llm_telemetry_session';
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

// Static import — Metro handles native module bridge properly.
// If native module isn't linked, the import succeeds but methods throw.
let RNAsyncStorage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
} | null = null;

try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    RNAsyncStorage = mod?.default ?? mod;
} catch {
    // Not available — will use in-memory fallback
}

// In-memory fallback
const memStore = new Map<string, string>();
const fallbackStorage = {
    getItem: async (key: string) => memStore.get(key) ?? null,
    setItem: async (key: string, value: string) => { memStore.set(key, value); },
    removeItem: async (key: string) => { memStore.delete(key); },
};

function getAsyncStorage() {
    return RNAsyncStorage ?? fallbackStorage;
}

/**
 * Manages chat session identity with persistence across app restarts.
 * Sessions expire after 4 hours of inactivity.
 */
export class SessionManager {
    private sessionData: SessionData | null = null;

    /**
     * Initialize session manager. Loads existing session from storage
     * or creates a new one if none exists or the existing one has expired.
     */
    async init(): Promise<void> {
        try {
            const storage = getAsyncStorage();
            const stored = await storage?.getItem(STORAGE_KEY);

            if (stored) {
                const data: SessionData = JSON.parse(stored);
                const lastActive = new Date(data.lastActiveAt).getTime();
                const now = Date.now();

                if (now - lastActive < SESSION_TIMEOUT_MS) {
                    // Session is still valid — reuse it
                    this.sessionData = data;
                    this.sessionData.lastActiveAt = new Date().toISOString();
                    await this.persistSession();
                    return;
                }
            }

            // No valid session found — create a new one
            await this.createNewSession();
        } catch {
            // On any error, create a fresh session in memory
            this.sessionData = {
                sessionId: generateSessionId(),
                startedAt: new Date().toISOString(),
                messageCount: 0,
                lastActiveAt: new Date().toISOString(),
            };
        }
    }

    /**
     * Get the current session ID. Synchronous — session must be loaded at init().
     */
    getCurrentSessionId(): string {
        return this.sessionData?.sessionId ?? 'uninitialized';
    }

    /**
     * Force generate a new session.
     */
    async refreshSession(): Promise<void> {
        await this.createNewSession();
    }

    /**
     * Increment the in-memory message counter and update lastActiveAt.
     */
    incrementMessageCount(): void {
        if (this.sessionData) {
            this.sessionData.messageCount += 1;
            this.sessionData.lastActiveAt = new Date().toISOString();
        }
    }

    /**
     * Get the current message count for this session.
     */
    getMessageCount(): number {
        return this.sessionData?.messageCount ?? 0;
    }

    /**
     * Persist the current session state to AsyncStorage.
     */
    async persistSession(): Promise<void> {
        if (!this.sessionData) return;
        try {
            const storage = getAsyncStorage();
            await storage?.setItem(STORAGE_KEY, JSON.stringify(this.sessionData));
        } catch {
            // Silently fail — telemetry must never crash the app
        }
    }

    /**
     * Create a new session and persist it.
     */
    private async createNewSession(): Promise<void> {
        this.sessionData = {
            sessionId: generateSessionId(),
            startedAt: new Date().toISOString(),
            messageCount: 0,
            lastActiveAt: new Date().toISOString(),
        };
        await this.persistSession();
    }
}
