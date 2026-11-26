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

// 第二個參數 jid 供依法院代碼判斷城市；此分支暫不使用，合併時以正式版本為準
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const extractJudgmentFields = (fullText: string, _jid?: string): JudgmentFields => {
    const legacy = getUpdateData({ id: '', jfull: fullText, jtitle: '' }) as
        | JudgmentFields
        | undefined;
    if (!legacy) {
        return {};
    }
    const { plaintiff, defendant, rent, win, city } = legacy;
    return { plaintiff, defendant, rent, win, city };
};
