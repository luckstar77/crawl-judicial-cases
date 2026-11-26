// 把清單切成固定大小的批次（批次查詢、刪除與更新共用）。
export const chunk = <T>(items: T[], size: number): T[][] => {
    if (!Number.isInteger(size) || size <= 0) {
        throw new Error('size must be a positive integer');
    }
    const batches: T[][] = [];
    for (let start = 0; start < items.length; start += size) {
        batches.push(items.slice(start, start + size));
    }
    return batches;
};
