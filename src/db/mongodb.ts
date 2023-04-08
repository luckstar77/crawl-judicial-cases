import { MongoClient } from 'mongodb';

// Connection URL
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);

export async function connect() {
    // TODO: error handler

    // Use connect method to connect to the server
    await client.connect();
    console.log('Connected successfully to server');
}

export async function getClient() {
    return client;
}
