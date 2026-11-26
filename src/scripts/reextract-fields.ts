// 以新的擷取規則重新計算 MySQL judicialFileset 的原告、被告、租金、勝敗與城市。
//
// 預設只輸出報告（dry-run），不會修改資料：
//   npm run reextract
//   npm run reextract -- --output=reextract-report-2026-11.json（檔名以 reextract-report 開頭才會被 git 忽略）
// 確認報告後，先備份資料庫，再加上 --apply 寫回：
//   npm run reextract -- --apply
// 新規則找不到的欄位會清成 NULL（舊值多半是擷取錯誤的片段）。
import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as knex from '../db/knex';
import { buildMysqlConfig } from '../db/mysql-config';
import { assertKnownArgs, hasFlag, readOption } from '../sync/cli-options';
import { chunk } from '../utils/chunk';
import { diffFields, FieldChange, sampleChanges, StoredJudgment, summarizeChanges } from '../reextract/reextract';
import { describeError } from '../utils/describe-error';

const READ_BATCH_SIZE = 500;
const UPDATE_BATCH_SIZE = 200;
const DEFAULT_OUTPUT = 'reextract-report.json';

const isFieldChange = (change: FieldChange | undefined): change is FieldChange => change !== undefined;

(async () => {
    const argv = process.argv.slice(2);
    assertKnownArgs(argv, { flags: ['apply'], options: ['output'] });
    const shouldApply = hasFlag(argv, 'apply');
    const outputPath = readOption(argv, 'output') ?? DEFAULT_OUTPUT;
    const client = await knex.init(buildMysqlConfig(process.env));

    try {
        const changes: FieldChange[] = [];
        let total = 0;
        let lastId = '';
        for (;;) {
            const rows: StoredJudgment[] = await client('judicialFileset')
                .select('id', 'jfull', 'plaintiff', 'defendant', 'rent', 'win', 'city')
                .where('id', '>', lastId)
                .orderBy('id')
                .limit(READ_BATCH_SIZE);
            if (rows.length === 0) {
                break;
            }
            total += rows.length;
            changes.push(...rows.map(diffFields).filter(isFieldChange));
            lastId = rows[rows.length - 1].id;
        }

        const summary = summarizeChanges(total, changes);
        console.log(`總數 ${summary.total}，有變動 ${summary.changedRows}`);
        console.log('各欄位變動：', summary.byField);

        fs.writeFileSync(
            outputPath,
            JSON.stringify({ summary, samples: sampleChanges(changes), changes }, null, 2)
        );
        console.log(`完整清單已寫入 ${outputPath}`);

        if (!shouldApply) {
            console.log('dry-run：沒有修改資料。確認報告並備份後，加上 --apply 才會寫回。');
            return;
        }

        let updated = 0;
        for (const batch of chunk(changes, UPDATE_BATCH_SIZE)) {
            await client.transaction(async (trx) => {
                for (const change of batch) {
                    await trx('judicialFileset').where({ id: change.id }).update(change.values);
                }
            });
            updated += batch.length;
        }
        console.log(`已更新 ${updated} 筆`);
    } finally {
        await client.destroy();
    }
})().catch((error) => {
    console.error(describeError(error));
    process.exit(1);
});
