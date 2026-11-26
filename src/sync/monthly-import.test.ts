import { describe, expect, it, vi } from 'vitest';
import { ArchiveItem } from '../judicial/monthly-archive';
import { OpenDataResource } from '../judicial/open-data';
import { MonthlyImportDeps, runMonthlyImport } from './monthly-import';
import { createInMemoryJudgmentStore } from './testing/in-memory-judgment-store';
import { LOAN_JID, loanRaw, RENTAL_JID, rentalRaw } from './testing/fixtures';

const resource = (month: string, fileSetId: number): OpenDataResource => ({
    datasetId: fileSetId,
    title: `${month}裁判書--(20261116Update)`,
    categoryName: '裁判書',
    filesets: [{ fileSetId, resourceFormat: 'RAR', resourceDescription: month }],
});

const RESOURCES = [resource('202212', 73363), resource('202301', 73364)];

const ITEMS: ArchiveItem[] = [
    { entryName: `202212/臺北簡易庭民事/${RENTAL_JID}.json`, document: rentalRaw() },
    { entryName: `202212/臺北簡易庭民事/${LOAN_JID}.json`, document: loanRaw() },
    { entryName: '202212/臺北簡易庭民事/bad.json', error: 'Unexpected token' },
    { entryName: '202212/臺北簡易庭民事/nodate.json', document: rentalRaw({ JID: 'TPEV,111,北簡,7,20220510,1', JDATE: '' }) },
];

async function* items(list: ArchiveItem[]): AsyncGenerator<ArchiveItem> {
    for (const item of list) {
        yield item;
    }
}

const createDeps = (overrides: Partial<MonthlyImportDeps> = {}) => {
    const cleanup = vi.fn(async () => undefined);
    const deps: MonthlyImportDeps = {
        listResources: vi.fn(async () => RESOURCES),
        createWorkspace: vi.fn(async (month: string) => ({
            rarPath: `/tmp/${month}/${month}.rar`,
            extractDir: `/tmp/${month}/extracted`,
            cleanup,
        })),
        downloadFileset: vi.fn(async () => undefined),
        readDocuments: vi.fn(() => items(ITEMS)),
        store: createInMemoryJudgmentStore(),
        isRemoved: () => false,
        onMonthDone: vi.fn(),
        ...overrides,
    };
    return { deps, cleanup };
};

describe('runMonthlyImport', () => {
    it('should import rental disputes of each month and clean up', async () => {
        const store = createInMemoryJudgmentStore();
        const { deps, cleanup } = createDeps({ store });

        const [summary] = await runMonthlyImport(['202212'], deps, { dryRun: false });

        expect(summary).toEqual({
            month: '202212',
            dryRun: false,
            title: '202212裁判書--(20261116Update)',
            fileSetId: '73363',
            candidates: 4,
            rental: 1,
            notRental: 1,
            removed: 0,
            upserted: 1,
            invalid: 2,
            failures: [
                { entry: '202212/臺北簡易庭民事/bad.json', message: 'Unexpected token' },
                { entry: '202212/臺北簡易庭民事/nodate.json', message: '裁判日期格式錯誤：' },
            ],
        });
        expect(deps.downloadFileset).toHaveBeenCalledWith('73363', '/tmp/202212/202212.rar');
        expect(deps.readDocuments).toHaveBeenCalledWith('/tmp/202212/202212.rar', '/tmp/202212/extracted');
        expect(store.judgments.get(RENTAL_JID)?.jdate).toBe('2022-05-10');
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(deps.onMonthDone).toHaveBeenCalledWith(summary);
    });

    it('should skip judgments that the Judicial Yuan has removed', async () => {
        const store = createInMemoryJudgmentStore();
        const { deps } = createDeps({ store, isRemoved: (id) => id === RENTAL_JID });

        const [summary] = await runMonthlyImport(['202212'], deps, { dryRun: false });

        expect(summary).toMatchObject({ rental: 0, removed: 1, upserted: 0 });
        expect(store.judgments.has(RENTAL_JID)).toBe(false);
    });

    it('should upsert in batches', async () => {
        const store = createInMemoryJudgmentStore();
        const many = Array.from({ length: 5 }, (_, index): ArchiveItem => {
            const jid = `TPEV,111,北簡,${index + 10},20220510,1`;
            return { entryName: `${jid}.json`, document: rentalRaw({ JID: jid }) };
        });
        const { deps } = createDeps({ store, readDocuments: () => items(many) });

        await runMonthlyImport(['202212'], deps, { dryRun: false, batchSize: 2 });

        expect(store.writes).toEqual(['upsert:2', 'upsert:2', 'upsert:1']);
    });

    it('should not write in dry-run', async () => {
        const store = createInMemoryJudgmentStore();
        const { deps, cleanup } = createDeps({ store });

        const [summary] = await runMonthlyImport(['202212'], deps, { dryRun: true });

        expect(summary).toMatchObject({ dryRun: true, upserted: 1 });
        expect(store.writes).toEqual([]);
        expect(cleanup).toHaveBeenCalled();
    });

    it('should report a missing month and continue with the next one', async () => {
        const { deps } = createDeps();

        const summaries = await runMonthlyImport(['202211', '202301'], deps, { dryRun: false });

        expect(summaries[0]).toMatchObject({ month: '202211', error: '資源清單中找不到這個月份的 RAR 資料集' });
        expect(summaries[1]).toMatchObject({ month: '202301', fileSetId: '73364', upserted: 1 });
        expect(deps.createWorkspace).toHaveBeenCalledTimes(1);
    });

    it('should clean up and continue when a download fails', async () => {
        const downloadFileset = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(undefined);
        const { deps, cleanup } = createDeps({ downloadFileset });

        const summaries = await runMonthlyImport(['202212', '202301'], deps, { dryRun: false });

        expect(summaries[0]).toMatchObject({ error: 'HTTP 500', candidates: 0 });
        expect(summaries[1].error).toBeUndefined();
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it('should clean up when extraction fails midway', async () => {
        async function* broken(): AsyncGenerator<ArchiveItem> {
            yield ITEMS[0];
            throw new Error('ERAR_BAD_DATA');
        }
        const { deps, cleanup } = createDeps({ readDocuments: () => broken() });

        const [summary] = await runMonthlyImport(['202212'], deps, { dryRun: false });

        expect(summary).toMatchObject({ error: 'ERAR_BAD_DATA', candidates: 1, upserted: 0 });
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('should cap the number of reported failures', async () => {
        const broken = Array.from({ length: 60 }, (_, index): ArchiveItem => ({ entryName: `${index}.json`, error: 'x' }));
        const { deps } = createDeps({ readDocuments: () => items(broken) });

        const [summary] = await runMonthlyImport(['202212'], deps, { dryRun: false });

        expect(summary.invalid).toBe(60);
        expect(summary.failures).toHaveLength(50);
    });

    it('should report a non-Error failure', async () => {
        const { deps } = createDeps({
            downloadFileset: vi.fn(async () => {
                throw 'disk full';
            }),
        });

        const [summary] = await runMonthlyImport(['202212'], deps, { dryRun: false });

        expect(summary.error).toBe('disk full');
    });
});
