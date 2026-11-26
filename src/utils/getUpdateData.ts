// 舊流程（MongoDB 同步、全表重算）使用的包裝，擷取規則在 judgment/extract-fields.ts。
// 沿用舊行為：擷取不到每月租金的判決不更新。
import { extractJudgmentFields, JudgmentFields } from '../judgment/extract-fields';

interface JudgmentSource {
    id: string;
    jfull: string;
    jtitle?: string;
}

export default ({ id, jfull }: JudgmentSource): (JudgmentFields & { id: string }) | undefined => {
    const fields = extractJudgmentFields(jfull, id);
    if (fields.rent === undefined) {
        return undefined;
    }
    return { id, ...fields };
};
