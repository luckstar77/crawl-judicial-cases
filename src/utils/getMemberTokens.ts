// 以會員帳密交換 API Token（下載檔案時需要）。
import axios from 'axios';

const apiUrl = 'https://opendata.judicial.gov.tw/api/MemberTokens';

interface MemberTokenRequestBody {
    memberAccount: string;
    pwd: string;
}

interface MemberTokenResponseBody {
    token: string;
    expires: string;
}

/** 發送 POST 至 MemberTokens 以取得 Bearer Token。 */
async function getMemberToken(
    requestBody: MemberTokenRequestBody
): Promise<string> {
    try {
        const response = await axios.post<MemberTokenResponseBody>(
            apiUrl,
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data.token;
    } catch (error) {
        console.error(error);
        return '';
    }
}

/**
 * 便捷封裝：使用環境變數 `JUDICIAL_ACCOUNT` 與 `JUDICIAL_PWD` 取得 Token。
 */
async function getMemberTokens() {
    const requestBody: MemberTokenRequestBody = {
        memberAccount: process.env.JUDICIAL_ACCOUNT!,
        pwd: process.env.JUDICIAL_PWD!,
    };

    const token = await getMemberToken(requestBody);
    return token;
}

export default getMemberTokens;
