// Mock for @react-native-async-storage/async-storage
const store = new Map<string, string>();

const AsyncStorage = {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { store.delete(key); }),
    clear: jest.fn(async () => { store.clear(); }),
    getAllKeys: jest.fn(async () => [...store.keys()]),
    _getStore: () => store,
};

export default AsyncStorage;
