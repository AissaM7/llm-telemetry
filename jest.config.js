/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__'],
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
    },
    moduleNameMapper: {
        '^react-native$': '<rootDir>/__tests__/__mocks__/react-native.ts',
        '^@react-native-async-storage/async-storage$': '<rootDir>/__tests__/__mocks__/async-storage.ts',
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/types/**',
        '!src/index.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 60,
            lines: 60,
            statements: 60,
        },
    },
};
