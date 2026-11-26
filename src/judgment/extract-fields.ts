// 從判決全文擷取原告、被告、每月租金、勝敗方與城市。
// 過渡版本：先沿用舊的 getUpdateData，介面確定後再替換內部實作。
import getUpdateData from '../utils/getUpdateData';

export type WinningParty = 'plaintiff' | 'defendant';

export interface JudgmentFields {
    plaintiff?: string;
    defendant?: string;
    rent?: number;
    win?: WinningParty;
    city?: string;
}

export const extractJudgmentFields = (fullText: string): JudgmentFields => {
    const legacy = getUpdateData({ id: '', jfull: fullText, jtitle: '' }) as
        | JudgmentFields
        | undefined;
    if (!legacy) {
        return {};
    }
    const { plaintiff, defendant, rent, win, city } = legacy;
    return { plaintiff, defendant, rent, win, city };
};
