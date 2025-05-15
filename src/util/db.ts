import pg from "pg";

const user = process.env.PG_USER;
const password = process.env.PG_PASSWORD;
const database = process.env.PG_DATABASE!;
const host = process.env.PG_HOST;
const port = Number(process.env.PG_PORT!);

const pool = new pg.Pool({ database, host, port, password, user });

pool.on('connect', () => {
  console.log("connected to database 😊");
});

pool.on('error', (err) => {
  console.error("cannot connect to database 😢", err);
});

export default pool;