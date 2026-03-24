import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Client } = pg;

export async function checkSupabaseConnection(): Promise<boolean> {
  const connectionString = process.env.SUPABASE_URL;
  if (!connectionString) return false;

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}
