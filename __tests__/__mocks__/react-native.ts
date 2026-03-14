// Mock for react-native in test environment
export const Platform = {
    OS: 'ios',
    Version: '17.0',
    select: (obj: Record<string, unknown>) => obj.ios ?? obj.default,
};

export const AppState = {
    currentState: 'active' as string,
    addEventListener: (_type: string, _handler: (state: string) => void) => ({
        remove: () => { },
    }),
};

export default { Platform, AppState };
