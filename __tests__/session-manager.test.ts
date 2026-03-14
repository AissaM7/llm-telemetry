// Mock crypto for Node.js test environment
if (typeof globalThis.crypto === 'undefined') {
    const nodeCrypto = require('crypto');
    (globalThis as any).crypto = {
        getRandomValues: (buffer: Uint8Array) => {
            const bytes = nodeCrypto.randomBytes(buffer.length);
            buffer.set(bytes);
            return buffer;
        },
    };
}
if (typeof globalThis.performance === 'undefined') {
    (globalThis as any).performance = { now: () => Date.now() };
}

import { SessionManager } from '../src/session/session-manager';

// Get mock store reference
const AsyncStorageMock = require('@react-native-async-storage/async-storage').default;

describe('SessionManager', () => {
    beforeEach(() => {
        AsyncStorageMock.clear();
        jest.clearAllMocks();
    });

    it('creates new session if none in AsyncStorage', async () => {
        const manager = new SessionManager();
        await manager.init();

        const sessionId = manager.getCurrentSessionId();
        expect(sessionId).toBeDefined();
        expect(sessionId).not.toBe('uninitialized');
        expect(sessionId).toHaveLength(32);
    });

    it('reuses existing session within 4 hours', async () => {
        // Create initial session
        const manager1 = new SessionManager();
        await manager1.init();
        const id1 = manager1.getCurrentSessionId();

        // Create second manager — should reuse
        const manager2 = new SessionManager();
        await manager2.init();
        const id2 = manager2.getCurrentSessionId();

        expect(id2).toBe(id1);
    });

    it('creates new session after 4 hours', async () => {
        // Manually store an old session
        const oldSession = {
            sessionId: 'a'.repeat(32),
            startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
            messageCount: 10,
            lastActiveAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        };
        await AsyncStorageMock.setItem('llm_telemetry_session', JSON.stringify(oldSession));

        const manager = new SessionManager();
        await manager.init();
        const sessionId = manager.getCurrentSessionId();

        // Should NOT be the old session
        expect(sessionId).not.toBe('a'.repeat(32));
        expect(sessionId).toHaveLength(32);
    });

    it('increments message count', async () => {
        const manager = new SessionManager();
        await manager.init();

        expect(manager.getMessageCount()).toBe(0);
        manager.incrementMessageCount();
        expect(manager.getMessageCount()).toBe(1);
        manager.incrementMessageCount();
        expect(manager.getMessageCount()).toBe(2);
    });

    it('persists session to AsyncStorage', async () => {
        const manager = new SessionManager();
        await manager.init();
        await manager.persistSession();

        expect(AsyncStorageMock.setItem).toHaveBeenCalledWith(
            'llm_telemetry_session',
            expect.any(String)
        );
    });

    it('refreshSession generates new ID', async () => {
        const manager = new SessionManager();
        await manager.init();
        const id1 = manager.getCurrentSessionId();

        await manager.refreshSession();
        const id2 = manager.getCurrentSessionId();

        expect(id2).not.toBe(id1);
        expect(id2).toHaveLength(32);
    });
});
