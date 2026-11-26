import { describe, expect, it } from 'vitest';
import { loadRemovedJudgmentMatcher, runDeleteInforSync } from './delete-infor-sync';
import { createInMemoryJudgmentStore } from './testing/in-memory-judgment-store';

const STORED = 'NTDV,93,繼,9019,20040115,1';
const STORED_WITH_ENGAGEMENT = 'SLDV,93,重訴,9240,20050630,1';
const CSV =
    '\uFEFF刪除日期,裁判日期年月,法院名稱,裁判ID\r\n' +
    '20210125,200401,臺灣屏東地方法院刑事,"PTDM,93,訴,9017,20040107,1"\r\n' +
    `20210516,200401,臺灣南投地方法院民事,"${STORED}"\r\n` +
    `20210517,200401,臺灣南投地方法院民事,"${STORED}"\r\n` +
    `20210306,200506,臺灣士林地方法院民事,"${STORED_WITH_ENGAGEMENT}"\r\n` +
    '20210306,200506,臺灣士林地方法院民事,\r\n' +
    '20220902,200401,最高法院刑事,"TPSM,93,台上,9326,20040116"\r\n';

const source = (csv = CSV) => async () => ({ fileSetId: '73409', title: 'Delete-Infor裁判書', csv });

const storeWithData = () =>
    createInMemoryJudgmentStore([STORED, STORED_WITH_ENGAGEMENT, 'TPEV,111,北簡,1,20220510,1'], {
        comments: [STORED_WITH_ENGAGEMENT],
        likes: [STORED_WITH_ENGAGEMENT, STORED_WITH_ENGAGEMENT],
    });

describe('runDeleteInforSync', () => {
    it('should delete listed judgments together with their comments and likes', async () => {
        const store = storeWithData();

        const summary = await runDeleteInforSync({ loadCsv: source(), store }, { dryRun: false });

        expect(summary).toEqual({
            dryRun: false,
            fileSetId: '73409',
            title: 'Delete-Infor裁判書',
            rows: 6,
            invalidRows: 1,
            uniqueIds: 4,
            incompleteIds: ['TPSM,93,台上,9326,20040116'],
            present: 2,
            presentIds: [STORED, STORED_WITH_ENGAGEMENT].sort(),
            deletedJudgments: 2,
            deletedComments: 1,
            deletedLikes: 2,
        });
        expect([...store.judgments.keys()]).toEqual(['TPEV,111,北簡,1,20220510,1']);
        expect(store.writes).toEqual(['deleteAuthoritative:2']);
    });

    it('should only report in dry-run', async () => {
        const store = storeWithData();

        const summary = await runDeleteInforSync({ loadCsv: source(), store }, { dryRun: true });

        expect(summary).toMatchObject({ dryRun: true, present: 2, deletedJudgments: 0 });
        expect(store.writes).toEqual([]);
    });

    it('should not write when nothing on the list is stored', async () => {
        const store = createInMemoryJudgmentStore();

        const summary = await runDeleteInforSync({ loadCsv: source(), store }, { dryRun: false });

        expect(summary.present).toBe(0);
        expect(store.writes).toEqual([]);
    });

    it('should fail loudly when the list cannot be parsed', async () => {
        const run = runDeleteInforSync(
            { loadCsv: source('刪除日期,裁判日期年月,法院名稱,裁判ID\r\n'), store: createInMemoryJudgmentStore() },
            { dryRun: false }
        );

        await expect(run).rejects.toThrow('解析不到任何裁判 ID');
    });
});

describe('loadRemovedJudgmentMatcher', () => {
    it('should match ids on the list, including ids missing the check number', async () => {
        const isRemoved = await loadRemovedJudgmentMatcher(source());

        expect(isRemoved(STORED)).toBe(true);
        expect(isRemoved('TPSM,93,台上,9326,20040116,1')).toBe(true);
        expect(isRemoved('TPEV,111,北簡,1,20220510,1')).toBe(false);
    });

    it('should fail loudly when the list cannot be parsed', async () => {
        await expect(loadRemovedJudgmentMatcher(source('<html></html>'))).rejects.toThrow('解析不到任何裁判 ID');
    });
});
