// ═══════════════════════════════════════════════════════════════════
// @llm-telemetry/react-native — App State Listener
// ═══════════════════════════════════════════════════════════════════
// Listens to React Native AppState changes to flush telemetry
// on background and retry on foreground.

type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

interface AppStateSubscription {
    remove: () => void;
}

/**
 * Monitors React Native AppState to trigger flush/retry operations.
 * Flushes all pending spans when app goes to background.
 * Retries offline buffer when app returns to foreground.
 */
export class AppStateListener {
    private onBackground: () => Promise<void>;
    private onForeground: () => Promise<void>;
    private subscription: AppStateSubscription | null = null;
    private lastState: AppStateStatus = 'active';

    constructor(
        onBackground: () => Promise<void>,
        onForeground: () => Promise<void>
    ) {
        this.onBackground = onBackground;
        this.onForeground = onForeground;
    }

    /**
     * Start listening to AppState changes.
     */
    start(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { AppState } = require('react-native') as {
                AppState: {
                    currentState: AppStateStatus;
                    addEventListener: (type: string, handler: (state: AppStateStatus) => void) => AppStateSubscription;
                };
            };

            this.lastState = AppState.currentState;

            this.subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
                this.handleStateChange(nextState);
            });
        } catch {
            // In non-RN environments (tests), silently skip
        }
    }

    /**
     * Stop listening to AppState changes.
     */
    stop(): void {
        if (this.subscription) {
            this.subscription.remove();
            this.subscription = null;
        }
    }

    /**
     * Handle app state transitions.
     */
    private handleStateChange(nextState: AppStateStatus): void {
        if (nextState === 'background' || nextState === 'inactive') {
            // App going to background — flush pending spans
            void this.onBackground().catch(() => {
                // Silently handle — telemetry must never crash
            });
        } else if (nextState === 'active' && this.lastState !== 'active') {
            // Returning from background — retry offline buffer
            void this.onForeground().catch(() => {
                // Silently handle
            });
        }

        this.lastState = nextState;
    }
}
