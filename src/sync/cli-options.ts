// 同步腳本共用的命令列參數解析（純函式，方便測試）。
export const DEFAULT_DELAY_MS = 300;
const MONTHS_PER_YEAR = 12;
// 只接受 1900–2099 年，避免「000001」這類輸入展開成上萬個月份
const MONTH_PATTERN = /^((?:19|20)\d{2})(0[1-9]|1[0-2])$/;

export const hasFlag = (argv: string[], name: string): boolean => argv.includes(`--${name}`);

export const readOption = (argv: string[], name: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

export interface KnownArgs {
    /** 不帶值的旗標，例如 dry-run（--dry-run） */
    flags: string[];
    /** 以 --name=value 指定的參數，例如 month（--month=202609） */
    options: string[];
}

/**
 * 拒絕未知的參數。打錯字的 --dryrun 或 --dry-run=true 若被忽略，會讓 dry-run 變成真的寫入或刪除。
 */
export const assertKnownArgs = (argv: string[], known: KnownArgs): void => {
    const isKnown = (arg: string): boolean =>
        known.flags.some((flag) => arg === `--${flag}`) ||
        known.options.some((option) => arg.startsWith(`--${option}=`));
    const unknown = argv.find((arg) => !isKnown(arg));
    if (unknown !== undefined) {
        const accepted = [...known.flags.map((flag) => `--${flag}`), ...known.options.map((option) => `--${option}=`)];
        throw new Error(`未知的參數：${unknown}（可用：${accepted.join(' ') || '無'}）`);
    }
};

export const parseDelayMs = (value: string | undefined): number => {
    if (value === undefined) {
        return DEFAULT_DELAY_MS;
    }
    if (!/^\d+$/.test(value)) {
        throw new Error('--delay-ms 必須是非負整數（毫秒）');
    }
    return Number(value);
};

const assertMonth = (value: string, name: string): void => {
    if (!MONTH_PATTERN.test(value)) {
        throw new Error(`--${name} 必須是 YYYYMM，例如 202212`);
    }
};

const toMonthIndex = (month: string): number =>
    Number(month.slice(0, 4)) * MONTHS_PER_YEAR + Number(month.slice(4, 6)) - 1;

const fromMonthIndex = (index: number): string =>
    `${Math.floor(index / MONTHS_PER_YEAR)}${String((index % MONTHS_PER_YEAR) + 1).padStart(2, '0')}`;

/** from、to 皆含 */
export const monthRange = (from: string, to: string): string[] => {
    assertMonth(from, 'from');
    assertMonth(to, 'to');
    const start = toMonthIndex(from);
    const end = toMonthIndex(to);
    if (start > end) {
        throw new Error('--from 不可晚於 --to');
    }
    return Array.from({ length: end - start + 1 }, (_, offset) => fromMonthIndex(start + offset));
};

/** --month=YYYYMM，或 --from=YYYYMM --to=YYYYMM */
export const parseMonths = (argv: string[]): string[] => {
    const month = readOption(argv, 'month');
    const from = readOption(argv, 'from');
    const to = readOption(argv, 'to');
    if (month !== undefined) {
        if (from !== undefined || to !== undefined) {
            throw new Error('--month 不可與 --from、--to 同時使用');
        }
        assertMonth(month, 'month');
        return [month];
    }
    if (from === undefined || to === undefined) {
        throw new Error('請指定 --month=YYYYMM，或同時指定 --from=YYYYMM --to=YYYYMM');
    }
    return monthRange(from, to);
};
