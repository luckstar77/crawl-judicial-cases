// 把錯誤整理成可以寫進日誌的一行摘要。
// axios 錯誤物件帶有 config.headers.Authorization（Bearer Token）與 config.data（會員帳密），
// 回應內容也可能回傳敏感資料，因此只保留錯誤名稱、HTTP 狀態、錯誤代碼、方法與不含查詢字串的網址。
import axios from 'axios';

/** 只保留 origin + pathname：去掉 user:password@、查詢字串與 #fragment；無法解析就不輸出 */
const toSafeUrl = (url: string | undefined): string | undefined => {
    if (!url) {
        return undefined;
    }
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return undefined;
    }
};

export const describeError = (error: unknown): string => {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const parts = [
            error.name,
            status === undefined ? undefined : `HTTP ${status}`,
            error.code,
            error.config?.method?.toUpperCase(),
            toSafeUrl(error.config?.url),
        ];
        return parts.filter((part): part is string => Boolean(part)).join(' ');
    }
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return `非 Error 例外（${typeof error}）`;
};
