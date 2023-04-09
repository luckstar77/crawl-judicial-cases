import { getClient as mongodbGetClient } from '../db/mongodb';

import getUpdateData from './getUpdateData';

export default async () => {
    const client = await mongodbGetClient();
    const db = client.db('rental'); // 更改為您的資料庫名稱
    const collection = db.collection('judicialFileset');

    const judicialFilesetsCursor = collection.find({});
    const judicialFilesets = await judicialFilesetsCursor.toArray();

    for (const judicialFileset of judicialFilesets) {
        const lowerKeyFileset: any = keysToLowerCase(judicialFileset);
        const { jid: id, jfull, jtitle, ...fileset } = lowerKeyFileset;

        const updateData: any = getUpdateData({ id, jfull, jtitle });
        if (updateData) {
            delete updateData.id;
            const result = await db
                .collection('judicialFilesetValid')
                .updateOne(
                    { jid: id },
                    { $set: { ...judicialFileset, ...updateData } },
                    { upsert: true }
                );
        }
    }
};
function keysToLowerCase(obj: any) {
    return Object.keys(obj).reduce((accumulator: any, key) => {
        accumulator[key.toLowerCase()] = obj[key];
        return accumulator;
    }, {});
}
