// 以新的房屋租賃糾紛規則重新檢查 MySQL judicialFileset 內已入庫的判決。
//
// 預設只輸出報告（dry-run），不會修改資料：
//   npm run reclassify
//   npm run reclassify -- --output=reclassify-report-2026-11.json（檔名以 reclassify-report 開頭才會被 git 忽略）
// 確認報告後，先備份資料庫，再加上 --apply 刪除不符合的判決：
//   npm run reclassify -- --apply
// 有會員留言或按讚的判決不會被刪除，會列在報告的 protectedIds。
import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as knex from '../db/knex';
import { createKnexJudgmentStore } from '../db/knex-judgment-store';
import { buildMysqlConfig } from '../db/mysql-config';
import {
    classifyRows,
    JudgmentRow,
    partitionDeletable,
    ReclassifiedJudgment,
    summarizeReclassification,
} from '../reclassify/reclassify';
import { assertKnownArgs, hasFlag, readOption } from '../sync/cli-options';
import { describeError } from '../utils/describe-error';

const READ_BATCH_SIZE = 500;
const TOP_TITLE_COUNT = 20;
const DEFAULT_OUTPUT = 'reclassify-report.json';

const countTitles = (rejected: ReclassifiedJudgment[]): [string, number][] => {
    const counts: Record<string, number> = {};
    rejected.forEach(({ title }) => {
        counts[title] = (counts[title] ?? 0) + 1;
    });
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_TITLE_COUNT);
};

(async () => {
    const argv = process.argv.slice(2);
    assertKnownArgs(argv, { flags: ['apply'], options: ['output'] });
    const shouldApply = hasFlag(argv, 'apply');
    const outputPath = readOption(argv, 'output') ?? DEFAULT_OUTPUT;
    const client = await knex.init(buildMysqlConfig(process.env));

    try {
        const results: ReclassifiedJudgment[] = [];
        let lastId = '';
        for (;;) {
            const rows: JudgmentRow[] = await client('judicialFileset')
                .select('id', 'jtitle', 'jfull')
                .where('id', '>', lastId)
                .orderBy('id')
                .limit(READ_BATCH_SIZE);
            if (rows.length === 0) {
                break;
            }
            results.push(...classifyRows(rows));
            lastId = rows[rows.length - 1].id;
        }

        const summary = summarizeReclassification(results);
        const referenced: { filesetId: string }[] = await client
            .select('filesetId')
            .from('comments')
            .union((query) => query.select('filesetId').from('likes'));
        const { deletable, protectedIds } = partitionDeletable(
            summary.rejected.map(({ id }) => id),
            new Set(referenced.map(({ filesetId }) => filesetId))
        );

        console.log(`總數 ${summary.total}，保留 ${summary.kept}，不符合 ${summary.rejected.length}`);
        console.log('判斷理由：', summary.byReason);
        console.log('不符合的案由（前 20 名）：', countTitles(summary.rejected));
        console.log(`有留言或按讚而保留：${protectedIds.length}`);

        fs.writeFileSync(
            outputPath,
            JSON.stringify({ ...summary, deletable, protectedIds }, null, 2)
        );
        console.log(`完整清單已寫入 ${outputPath}`);

        if (!shouldApply) {
            console.log('dry-run：沒有修改資料。確認報告並備份後，加上 --apply 才會刪除。');
            return;
        }

        // 刪除時再排除一次有留言或按讚的判決，避免產生報告後才新增的留言變成孤兒資料
        const { deleted } = await createKnexJudgmentStore(client).deleteIfUnreferenced(deletable);
        console.log(`已刪除 ${deleted} 筆`);
    } finally {
        await client.destroy();
    }
})().catch((error) => {
    console.error(describeError(error));
    process.exit(1);
});
