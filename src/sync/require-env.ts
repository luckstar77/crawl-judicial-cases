// 讀取必要的環境變數；錯誤訊息只寫變數名稱，不印出值。
export const requireEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
    const value = env[name];
    if (!value) {
        throw new Error(`缺少環境變數 ${name}`);
    }
    return value;
};
