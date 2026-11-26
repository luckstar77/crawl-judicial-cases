// 裁判書開放 API 只在每日 00:00–06:00（Asia/Taipei）提供服務。
const TAIPEI_UTC_OFFSET_HOURS = 8; // 臺灣不實施日光節約時間
const HOURS_PER_DAY = 24;
export const SERVICE_START_HOUR = 0;
export const SERVICE_END_HOUR = 6;

export const taipeiHour = (now: Date): number =>
    (now.getUTCHours() + TAIPEI_UTC_OFFSET_HOURS) % HOURS_PER_DAY;

/** 不論主機時區（例如 UTC），都以臺北時間判斷 */
export const isWithinServiceWindow = (now: Date): boolean => {
    const hour = taipeiHour(now);
    return hour >= SERVICE_START_HOUR && hour < SERVICE_END_HOUR;
};

/** 以臺北時間顯示，例如 2026-11-26 14:05 */
export const formatTaipeiTime = (now: Date): string =>
    new Date(now.getTime() + TAIPEI_UTC_OFFSET_HOURS * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
