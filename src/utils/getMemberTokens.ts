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

// 使用範例
async function getMemberTokens() {
    const requestBody: MemberTokenRequestBody = {
        memberAccount: process.env.JUDICIAL_ACCOUNT!,
        pwd: process.env.JUDICIAL_PWD!,
    };

    const token = await getMemberToken(requestBody);
    return token;
}

export default getMemberTokens;
