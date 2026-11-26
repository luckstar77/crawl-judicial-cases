import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            // 只量測有單元測試的純邏輯；下載、解壓、資料庫存取等 I/O 流程不在範圍內
            include: [
                'src/classifier/**/*.ts',
                'src/reclassify/**/*.ts',
                'src/reextract/**/*.ts',
                'src/judgment/**/*.ts',
                'src/db/mysql-config.ts',
            ],
            exclude: ['src/**/*.test.ts'],
            thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
        },
    },
});
