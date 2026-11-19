import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
  BatchGetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME || "postula-prod";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const userPk = (addr: string) => `USER#${addr.toLowerCase()}`;
/** Catálogo global de vacantes publicadas por el reclutador (admin). */
export const CATALOG_PK = "CATALOG";

export async function getItem<T = any>(pk: string, sk: string): Promise<T | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }));
  return (r.Item as T) ?? null;
}

export async function putItem(item: Record<string, any>) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function deleteItem(pk: string, sk: string) {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
}

export async function queryPrefix<T = any>(pk: string, prefix: string): Promise<T[]> {
  const out: T[] = [];
  let ExclusiveStartKey: any;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: prefix ? "pk = :pk AND begins_with(sk, :p)" : "pk = :pk",
        ExpressionAttributeValues: prefix ? { ":pk": pk, ":p": prefix } : { ":pk": pk },
        ExclusiveStartKey,
      }),
    );
    out.push(...((r.Items as T[]) ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export async function batchGet(pk: string, sks: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const uniq = [...new Set(sks)];
  for (let i = 0; i < uniq.length; i += 100) {
    let keys: any[] = uniq.slice(i, i + 100).map((sk) => ({ pk, sk }));
    for (let attempt = 0; keys.length && attempt < 5; attempt++) {
      const r = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: keys } } }));
      for (const it of r.Responses?.[TABLE] ?? []) out[it.sk] = it;
      keys = (r.UnprocessedKeys?.[TABLE]?.Keys as any[]) ?? [];
    }
  }
  return out;
}

export async function batchPut(items: Record<string, any>[]) {
  for (let i = 0; i < items.length; i += 25) {
    let reqs: any[] = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; reqs.length && attempt < 5; attempt++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: reqs } }));
      reqs = (r.UnprocessedItems?.[TABLE] as any[]) ?? [];
    }
  }
}

/** Suma atómica a contadores numéricos de nivel superior (p. ej. stats del catálogo). */
export async function addCounters(pk: string, sk: string, inc: Record<string, number>) {
  const keys = Object.keys(inc);
  if (!keys.length) return;
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};
  const parts = keys.map((k, i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = inc[k];
    return `#k${i} :v${i}`;
  });
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk, sk },
    UpdateExpression: `ADD ${parts.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/** Borra TODO lo de un usuario (botón «Borrar mis datos»). */
export async function deleteAllForPk(pk: string): Promise<number> {
  const items = await queryPrefix<{ pk: string; sk: string }>(pk, "");
  for (let i = 0; i < items.length; i += 25) {
    let reqs: any[] = items
      .slice(i, i + 25)
      .map((it) => ({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } }));
    for (let attempt = 0; reqs.length && attempt < 5; attempt++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: reqs } }));
      reqs = (r.UnprocessedItems?.[TABLE] as any[]) ?? [];
    }
  }
  return items.length;
}
