import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            // 量測有單元測試的模組；舊的下載、解壓流程（src/utils）與腳本（src/scripts）不在範圍內
            include: [
                'src/classifier/**/*.ts',
                'src/reclassify/**/*.ts',
                'src/db/mysql-config.ts',
                'src/db/knex-judgment-store.ts',
                'src/judicial/**/*.ts',
                'src/sync/**/*.ts',
            ],
            // 測試用的記憶體 store 與資料不列入；readArchiveDocuments 需要真實 RAR，以實際月份檔案手動驗證
            exclude: ['src/**/*.test.ts', 'src/sync/testing/**'],
            thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
        },
    },
});
